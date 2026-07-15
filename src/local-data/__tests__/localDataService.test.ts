import { beforeEach, describe, expect, it } from 'vitest'
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'

import {
  LOCAL_DATA_STORES,
  LOCAL_SETTINGS_ID,
  openLocalDatabase,
} from '@/local-data/indexedDb'
import {
  loadLocalDataSnapshot,
  updateAudioPreferencesSetting,
  updateBotDifficultySetting,
  updateSkipOpeningCeremonySetting,
} from '@/local-data/localDataService'

/**
 * 为每个用例安装全新的内存 IndexedDB，避免用户、积分或设置在测试之间互相污染。
 */
function installFreshIndexedDb(): void {
  Object.defineProperty(globalThis, 'indexedDB', {
    configurable: true,
    value: new IDBFactory(),
  })
  Object.defineProperty(globalThis, 'IDBKeyRange', {
    configurable: true,
    value: IDBKeyRange,
  })
}

/**
 * 等待一笔原生 IndexedDB 事务结束。
 *
 * @param transaction 当前需要等待的读写事务。
 */
function waitForTransaction(transaction: IDBTransaction): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error)
    transaction.onabort = () => reject(transaction.error)
  })
}

/**
 * 直接读取设置原始记录，用于验证服务层不仅返回兼容值，也确实完成了旧数据回写。
 *
 * @returns IndexedDB 中保存的原始设置字段。
 */
async function readRawSettings(): Promise<Record<string, unknown>> {
  const database = await openLocalDatabase()

  try {
    const transaction = database.transaction(LOCAL_DATA_STORES.settings, 'readonly')
    const request = transaction.objectStore(LOCAL_DATA_STORES.settings).get(LOCAL_SETTINGS_ID)
    const settings = await new Promise<Record<string, unknown>>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result as Record<string, unknown>)
      request.onerror = () => reject(request.error)
    })
    await waitForTransaction(transaction)
    return settings
  } finally {
    database.close()
  }
}

/**
 * 写入缺少新字段的旧版设置记录，模拟真实用户升级前已经存在的浏览器数据。
 *
 * @param settings 需要覆盖到设置仓库的旧版原始记录。
 */
async function writeRawSettings(settings: Record<string, unknown>): Promise<void> {
  const database = await openLocalDatabase()

  try {
    const transaction = database.transaction(LOCAL_DATA_STORES.settings, 'readwrite')
    transaction.objectStore(LOCAL_DATA_STORES.settings).put(settings)
    await waitForTransaction(transaction)
  } finally {
    database.close()
  }
}

describe('本地机器人难度设置', () => {
  beforeEach(() => {
    installFreshIndexedDb()
  })

  it('旧设置缺少难度字段时回落到标准档并回写数据库', async () => {
    await loadLocalDataSnapshot()
    const currentSettings = await readRawSettings()
    const { botDifficulty: _removedDifficulty, ...legacySettings } = currentSettings

    await writeRawSettings(legacySettings)

    const snapshot = await loadLocalDataSnapshot()
    const repairedSettings = await readRawSettings()

    expect(snapshot.botDifficulty).toBe('standard')
    expect(repairedSettings.botDifficulty).toBe('standard')
  })

  it('保存专家难度后重新加载仍保持专家档', async () => {
    await loadLocalDataSnapshot()

    const updatedSnapshot = await updateBotDifficultySetting('expert')
    const reloadedSnapshot = await loadLocalDataSnapshot()

    expect(updatedSnapshot.botDifficulty).toBe('expert')
    expect(reloadedSnapshot.botDifficulty).toBe('expert')
  })
})

describe('本地声音设置', () => {
  beforeEach(() => {
    installFreshIndexedDb()
  })

  it('旧设置缺少声音字段时启用默认音效并回写数据库', async () => {
    await loadLocalDataSnapshot()
    const currentSettings = await readRawSettings()
    const {
      soundEffectsEnabled: _removedEffectSwitch,
      soundEffectsVolume: _removedEffectVolume,
      voiceCallsEnabled: _removedVoiceSwitch,
      voiceCallsVolume: _removedVoiceVolume,
      ...legacySettings
    } = currentSettings

    await writeRawSettings(legacySettings)

    const snapshot = await loadLocalDataSnapshot()
    const repairedSettings = await readRawSettings()

    expect(snapshot.audioPreferences).toEqual({
      soundEffectsEnabled: true,
      soundEffectsVolume: 0.86,
      voiceCallsEnabled: true,
      voiceCallsVolume: 0.92,
    })
    expect(repairedSettings.soundEffectsEnabled).toBe(true)
    expect(repairedSettings.voiceCallsEnabled).toBe(true)
  })

  it('保存声音偏好时会限制音量范围并持久化开关', async () => {
    await loadLocalDataSnapshot()

    const updatedSnapshot = await updateAudioPreferencesSetting({
      soundEffectsEnabled: false,
      soundEffectsVolume: 2,
      voiceCallsEnabled: false,
      voiceCallsVolume: -1,
    })
    const reloadedSnapshot = await loadLocalDataSnapshot()

    expect(updatedSnapshot.audioPreferences).toEqual({
      soundEffectsEnabled: false,
      soundEffectsVolume: 1,
      voiceCallsEnabled: false,
      voiceCallsVolume: 0,
    })
    expect(reloadedSnapshot.audioPreferences).toEqual(updatedSnapshot.audioPreferences)
  })

  it('保存跳过抓牌动画后重新加载仍保持开启', async () => {
    await loadLocalDataSnapshot()

    const updatedSnapshot = await updateSkipOpeningCeremonySetting(true)
    const reloadedSnapshot = await loadLocalDataSnapshot()

    expect(updatedSnapshot.skipOpeningCeremony).toBe(true)
    expect(reloadedSnapshot.skipOpeningCeremony).toBe(true)
  })
})
