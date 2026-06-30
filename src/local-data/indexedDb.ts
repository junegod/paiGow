import type {
  AppSettings,
  MatchHistory,
  ScoreLedger,
  UserProfile,
} from '@/local-data/types'

const DATABASE_NAME = 'da-suo-zi-local-data'
const DATABASE_VERSION = 1

export const LOCAL_SETTINGS_ID = 'default'

/**
 * IndexedDB 里的对象仓库名称。统一常量能减少字符串写错导致的数据迁移问题。
 */
export const LOCAL_DATA_STORES = {
  users: 'userProfiles',
  scoreLedger: 'scoreLedger',
  matchHistory: 'matchHistory',
  settings: 'appSettings',
} as const

type LocalStoreName = typeof LOCAL_DATA_STORES[keyof typeof LOCAL_DATA_STORES]

type LocalStoreValueMap = {
  [LOCAL_DATA_STORES.users]: UserProfile
  [LOCAL_DATA_STORES.scoreLedger]: ScoreLedger
  [LOCAL_DATA_STORES.matchHistory]: MatchHistory
  [LOCAL_DATA_STORES.settings]: AppSettings
}

/**
 * 将 IndexedDB request 转成 Promise，方便上层服务用 async/await 编排。
 */
function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('本地数据读取失败。'))
  })
}

/**
 * 等待事务完成。写入类操作必须等事务完成后再刷新大厅数据，避免读到旧快照。
 */
function waitForTransaction(transaction: IDBTransaction): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error ?? new Error('本地数据事务失败。'))
    transaction.onabort = () => reject(transaction.error ?? new Error('本地数据事务已中断。'))
  })
}

/**
 * 创建首版对象仓库。所有数据都按用户维度建立索引，后续做战绩页或云同步会更轻松。
 */
function upgradeLocalDatabase(database: IDBDatabase): void {
  if (!database.objectStoreNames.contains(LOCAL_DATA_STORES.users)) {
    database.createObjectStore(LOCAL_DATA_STORES.users, { keyPath: 'id' })
  }

  if (!database.objectStoreNames.contains(LOCAL_DATA_STORES.scoreLedger)) {
    const store = database.createObjectStore(LOCAL_DATA_STORES.scoreLedger, { keyPath: 'id' })
    store.createIndex('byUserId', 'userId', { unique: false })
    store.createIndex('byRoundKey', 'roundKey', { unique: false })
  }

  if (!database.objectStoreNames.contains(LOCAL_DATA_STORES.matchHistory)) {
    const store = database.createObjectStore(LOCAL_DATA_STORES.matchHistory, { keyPath: 'id' })
    store.createIndex('byUserId', 'userId', { unique: false })
    store.createIndex('bySettledAt', 'settledAt', { unique: false })
  }

  if (!database.objectStoreNames.contains(LOCAL_DATA_STORES.settings)) {
    database.createObjectStore(LOCAL_DATA_STORES.settings, { keyPath: 'id' })
  }
}

/**
 * 打开本地数据库。这里显式检查 IndexedDB，是为了以后打包 App 时能给出更友好的错误。
 */
export function openLocalDatabase(): Promise<IDBDatabase> {
  if (!globalThis.indexedDB) {
    return Promise.reject(new Error('当前浏览器不支持本地数据库。'))
  }

  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = globalThis.indexedDB.open(DATABASE_NAME, DATABASE_VERSION)

    request.onupgradeneeded = () => {
      upgradeLocalDatabase(request.result)
    }

    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('本地数据库打开失败。'))
  })
}

/**
 * 读取单条记录。
 */
export async function getLocalItem<StoreName extends LocalStoreName>(
  database: IDBDatabase,
  storeName: StoreName,
  key: IDBValidKey,
): Promise<LocalStoreValueMap[StoreName] | undefined> {
  const transaction = database.transaction(storeName, 'readonly')
  const store = transaction.objectStore(storeName)
  const result = await requestToPromise<LocalStoreValueMap[StoreName] | undefined>(store.get(key))
  await waitForTransaction(transaction)
  return result
}

/**
 * 读取仓库里的所有记录。
 */
export async function getAllLocalItems<StoreName extends LocalStoreName>(
  database: IDBDatabase,
  storeName: StoreName,
): Promise<LocalStoreValueMap[StoreName][]> {
  const transaction = database.transaction(storeName, 'readonly')
  const store = transaction.objectStore(storeName)
  const result = await requestToPromise<LocalStoreValueMap[StoreName][]>(store.getAll())
  await waitForTransaction(transaction)
  return result
}

/**
 * 写入或覆盖单条记录。
 */
export async function putLocalItem<StoreName extends LocalStoreName>(
  database: IDBDatabase,
  storeName: StoreName,
  value: LocalStoreValueMap[StoreName],
): Promise<void> {
  const transaction = database.transaction(storeName, 'readwrite')
  const store = transaction.objectStore(storeName)
  await requestToPromise(store.put(value))
  await waitForTransaction(transaction)
}

