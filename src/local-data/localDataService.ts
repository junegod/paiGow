import type {
  ActiveScoredRound,
  AppSettings,
  LocalDataSnapshot,
  MatchHistory,
  MatchHistorySeatResult,
  ScoreLedger,
  UserProfile,
  UserStats,
} from '@/local-data/types'
import {
  LOCAL_DATA_STORES,
  LOCAL_SETTINGS_ID,
  getAllLocalItems,
  getLocalItem,
  openLocalDatabase,
  putLocalItem,
} from '@/local-data/indexedDb'
import type {
  MatchState,
  RoundState,
  SeatConfig,
  SeatId,
  SeatSettlement,
} from '@/rules-core/types'
import { calculateSettlement } from '@/rules-variants/ji-an-da-suo-zi/scoring'

const DEFAULT_USER_ID = 'default-local-user'
const RECENT_HISTORY_LIMIT = 6
const SYSTEM_RECHARGE_AMOUNT = 100
const ABANDONED_ROUND_PENALTY = 4
const WALLET_VERSION = 3
const DEFAULT_NAMES = [
  '新居阿生',
  '禾水小友',
  '庐陵客',
  '青石玩家',
  '井冈后生',
  '老屋牌友',
]
const AVATAR_KEYS = ['bamboo', 'ember', 'river', 'plum', 'sun', 'jade']

/**
 * 生成本机数据 ID。优先使用 crypto.randomUUID，保证后续云同步时冲突概率足够低。
 */
function createLocalId(prefix: string): string {
  const randomId = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`
  return `${prefix}-${randomId}`
}

/**
 * 从数组里随机取一个元素，用于默认用户昵称和头像。
 */
function pickRandomItem(items: string[]): string {
  return items[Math.floor(Math.random() * items.length)] ?? items[0]
}

/**
 * 统一生成 ISO 时间，避免不同记录里的时间格式不一致。
 */
function nowIsoString(): string {
  return new Date().toISOString()
}

/**
 * 生成对局局唯一键。积分结算、未完成登记和离局扣分都复用这个键，
 * 这样可以稳定判断一局是否已经正常结算过。
 */
function createRoundKey(matchId: string, roundNumber: number): string {
  return `${matchId}:${roundNumber}`
}

/**
 * 清理用户输入的昵称，避免空白昵称或过长昵称撑坏大厅。
 */
function normalizeNickname(nickname: string): string {
  const normalizedNickname = nickname.trim().replace(/\s+/g, ' ')

  if (!normalizedNickname) {
    return `玩家${new Date().getSeconds().toString().padStart(2, '0')}`
  }

  return normalizedNickname.slice(0, 12)
}

/**
 * 创建用户档案对象。当前只做本机 ID，后续服务端同步时可以补 remoteId。
 */
function createUserProfile(nickname: string): UserProfile {
  const createdAt = nowIsoString()

  return {
    id: createLocalId('user'),
    nickname: normalizeNickname(nickname),
    createdAt,
    updatedAt: createdAt,
    avatarKey: pickRandomItem(AVATAR_KEYS),
  }
}

/**
 * 创建固定 ID 的默认用户。React 严格模式可能并发触发初始化，固定 ID 可以避免重复插入两个“我”。
 */
function createDefaultUserProfile(): UserProfile {
  const createdAt = nowIsoString()

  return {
    id: DEFAULT_USER_ID,
    nickname: pickRandomItem(DEFAULT_NAMES),
    createdAt,
    updatedAt: createdAt,
    avatarKey: pickRandomItem(AVATAR_KEYS),
  }
}

/**
 * 给旧版本 IndexedDB 里的用户补齐新增字段，避免升级后头像缺失。
 */
function normalizeUserProfile(user: UserProfile): UserProfile {
  const shouldRefreshDefaultName = user.id === DEFAULT_USER_ID && user.nickname === '我'

  return {
    ...user,
    nickname: shouldRefreshDefaultName ? pickRandomItem(DEFAULT_NAMES) : user.nickname,
    avatarKey: user.avatarKey || pickRandomItem(AVATAR_KEYS),
  }
}

/**
 * 创建默认应用设置。首版只记录当前用户，后续音效、动画偏好可以复用同一条记录。
 */
function createAppSettings(activeUserId: string | null): AppSettings {
  const createdAt = nowIsoString()

  return {
    id: LOCAL_SETTINGS_ID,
    activeUserId,
    createdAt,
    updatedAt: createdAt,
    walletVersion: WALLET_VERSION,
    activeScoredRound: null,
  }
}

/**
 * 确保本机至少有一个用户，并且设置里有有效当前用户。
 */
async function ensureLocalDataReady(database: IDBDatabase): Promise<void> {
  const [users, settings] = await Promise.all([
    getAllLocalItems(database, LOCAL_DATA_STORES.users),
    getLocalItem(database, LOCAL_DATA_STORES.settings, LOCAL_SETTINGS_ID),
  ])

  if (users.length === 0) {
    const defaultUser = createDefaultUserProfile()
    await putLocalItem(database, LOCAL_DATA_STORES.users, defaultUser)
    await putLocalItem(database, LOCAL_DATA_STORES.settings, createAppSettings(defaultUser.id))
    await putLocalItem(database, LOCAL_DATA_STORES.scoreLedger, createRechargeLedger(defaultUser.id, '新用户系统赠送'))
    return
  }

  await Promise.all(
    users
      .filter((user) => !user.avatarKey || (user.id === DEFAULT_USER_ID && user.nickname === '我'))
      .map((user) => putLocalItem(database, LOCAL_DATA_STORES.users, normalizeUserProfile(user))),
  )

  const activeUserExists = users.some((user) => user.id === settings?.activeUserId)

  if (!settings || !activeUserExists) {
    await putLocalItem(database, LOCAL_DATA_STORES.settings, {
      ...(settings ?? createAppSettings(users[0].id)),
      activeUserId: users[0].id,
      updatedAt: nowIsoString(),
      walletVersion: settings?.walletVersion ?? WALLET_VERSION,
    })
  }
}

/**
 * 创建系统充值流水。充值不算对局局数，只进入用户余额。
 */
function createRechargeLedger(
  userId: string,
  summary: string,
  amount = SYSTEM_RECHARGE_AMOUNT,
): ScoreLedger {
  const createdAt = nowIsoString()
  const ledgerId = createLocalId('recharge')

  return {
    id: ledgerId,
    userId,
    matchId: 'system',
    roundNumber: 0,
    roundKey: ledgerId,
    seat: 0,
    delta: amount,
    kind: 'recharge',
    baseDelta: 0,
    rewardDelta: 0,
    wonPierCount: 0,
    isSweep: false,
    summary,
    createdAt,
  }
}

/**
 * 创建固定 ID 的钱包迁移流水。严格模式重复初始化时，put 会覆盖同一条记录，不会重复叠加。
 */
function createWalletMigrationLedger(userId: string, amount: number): ScoreLedger {
  const createdAt = nowIsoString()
  const ledgerId = `${userId}:wallet-migration-v${WALLET_VERSION}`

  return {
    id: ledgerId,
    userId,
    matchId: 'system',
    roundNumber: 0,
    roundKey: ledgerId,
    seat: 0,
    delta: amount,
    kind: 'recharge',
    baseDelta: 0,
    rewardDelta: 0,
    wonPierCount: 0,
    isSweep: false,
    summary: '钱包规则升级，校准初始积分',
    createdAt,
  }
}

/**
 * 创建中途离局扣分流水。它是系统防刷牌分，不算玩法结算，
 * 所以 base/reward/wonPierCount 都保持为 0。
 */
function createAbandonedRoundPenaltyLedger(
  activeRound: ActiveScoredRound,
  delta: number,
): ScoreLedger {
  const createdAt = nowIsoString()

  return {
    id: `${activeRound.userId}:${activeRound.roundKey}:leave-penalty`,
    userId: activeRound.userId,
    matchId: activeRound.matchId,
    roundNumber: activeRound.roundNumber,
    roundKey: `${activeRound.roundKey}:leave-penalty`,
    seat: 0,
    delta,
    kind: 'leave-penalty',
    baseDelta: 0,
    rewardDelta: 0,
    wonPierCount: 0,
    isSweep: false,
    summary: `中途离局，系统扣 ${Math.abs(delta)} 分`,
    createdAt,
  }
}

/**
 * 计算单个用户当前余额，旧版本缺少 kind 的流水仍然纳入余额。
 */
function calculateUserScore(ledgers: ScoreLedger[], userId: string): number {
  return ledgers
    .filter((ledger) => ledger.userId === userId)
    .reduce((total, ledger) => total + ledger.delta, 0)
}

/**
 * 首次进入或扣到 0 分后，系统给用户补 100 分，避免单机版无法继续玩。
 */
async function ensureUsersHavePlayableScore(database: IDBDatabase, users: UserProfile[]): Promise<void> {
  const ledgers = await getAllLocalItems(database, LOCAL_DATA_STORES.scoreLedger)

  await Promise.all(
    users
      .filter((user) => calculateUserScore(ledgers, user.id) <= 0)
      .map((user) => putLocalItem(database, LOCAL_DATA_STORES.scoreLedger, createRechargeLedger(user.id, '余额不足，系统自动充值'))),
  )
}

/**
 * 旧版本本地积分没有“初始 100 钱包”概念。首次升级时统一校准到 100，
 * 之后真实对局的输赢不再反复校准，只有余额用完才自动充值。
 */
async function migrateWalletToOpeningBalance(
  database: IDBDatabase,
  users: UserProfile[],
  settings?: AppSettings,
): Promise<void> {
  if (settings?.walletVersion === WALLET_VERSION) {
    return
  }

  const ledgers = await getAllLocalItems(database, LOCAL_DATA_STORES.scoreLedger)

  await Promise.all(
    users.map((user) => {
      const currentScore = calculateUserScore(ledgers, user.id)
      const missingScore = SYSTEM_RECHARGE_AMOUNT - currentScore

      if (missingScore === 0) {
        return Promise.resolve()
      }

      return putLocalItem(
        database,
        LOCAL_DATA_STORES.scoreLedger,
        createWalletMigrationLedger(user.id, missingScore),
      )
    }),
  )

  await putLocalItem(database, LOCAL_DATA_STORES.settings, {
    ...(settings ?? createAppSettings(users[0]?.id ?? null)),
    walletVersion: WALLET_VERSION,
    updatedAt: nowIsoString(),
  })
}

/**
 * 判断一条未完成积分局是否已经通过正常结算或离局扣分处理过。
 * 正常结算优先级最高，如果已经有对局流水，就只清登记不再扣离局分。
 */
function hasActiveRoundBeenRecorded(
  ledgers: ScoreLedger[],
  activeRound: ActiveScoredRound,
): boolean {
  const roundLedgerId = `${activeRound.userId}:${activeRound.roundKey}`
  const penaltyLedgerId = `${activeRound.userId}:${activeRound.roundKey}:leave-penalty`

  return ledgers.some((ledger) =>
    ledger.id === roundLedgerId || ledger.id === penaltyLedgerId)
}

/**
 * 清空本机设置里的未完成积分局登记。传入 settings 是为了保留其它轻量设置字段。
 */
async function clearActiveScoredRound(
  database: IDBDatabase,
  settings?: AppSettings,
): Promise<void> {
  if (!settings?.activeScoredRound) {
    return
  }

  await putLocalItem(database, LOCAL_DATA_STORES.settings, {
    ...settings,
    activeScoredRound: null,
    updatedAt: nowIsoString(),
  })
}

/**
 * 对一条未完成积分局扣系统离局分。扣分按当前余额封顶，
 * 因此不会把本机积分扣成负数。
 */
async function writeAbandonedRoundPenalty(
  database: IDBDatabase,
  activeRound: ActiveScoredRound,
  ledgers: ScoreLedger[],
): Promise<void> {
  if (hasActiveRoundBeenRecorded(ledgers, activeRound)) {
    return
  }

  const currentScore = Math.max(0, calculateUserScore(ledgers, activeRound.userId))
  const penaltyAmount = Math.min(ABANDONED_ROUND_PENALTY, currentScore)

  if (penaltyAmount <= 0) {
    return
  }

  await putLocalItem(
    database,
    LOCAL_DATA_STORES.scoreLedger,
    createAbandonedRoundPenaltyLedger(activeRound, -penaltyAmount),
  )
}

/**
 * 应用上次刷新、关闭或崩溃留下的未完成积分局。这里在应用启动读快照时执行，
 * 比 beforeunload 里直接异步写库更可靠。
 */
async function applyInterruptedRoundPenalty(database: IDBDatabase): Promise<void> {
  const settings = await getLocalItem(database, LOCAL_DATA_STORES.settings, LOCAL_SETTINGS_ID)
  const activeRound = settings?.activeScoredRound

  if (!settings || !activeRound) {
    return
  }

  const ledgers = await getAllLocalItems(database, LOCAL_DATA_STORES.scoreLedger)
  await writeAbandonedRoundPenalty(database, activeRound, ledgers)
  await clearActiveScoredRound(database, settings)
}

/**
 * 按积分流水计算用户统计。这样总分不会因为某次 UI 写入失败而和流水不一致。
 */
function calculateStatsByUserId(ledgers: ScoreLedger[]): Record<string, UserStats> {
  return ledgers.reduce<Record<string, UserStats>>((statsByUserId, ledger) => {
    const ledgerKind = ledger.kind ?? 'round'
    const isRoundLedger = ledgerKind === 'round'
    const previousStats = statsByUserId[ledger.userId] ?? {
      totalScore: 0,
      roundsPlayed: 0,
      bestRoundDelta: 0,
      sweepCount: 0,
    }

    statsByUserId[ledger.userId] = {
      totalScore: previousStats.totalScore + ledger.delta,
      roundsPlayed: previousStats.roundsPlayed + (isRoundLedger ? 1 : 0),
      bestRoundDelta:
        isRoundLedger
          ? Math.max(previousStats.bestRoundDelta, ledger.delta)
          : previousStats.bestRoundDelta,
      sweepCount: previousStats.sweepCount + (isRoundLedger && ledger.isSweep ? 1 : 0),
    }

    return statsByUserId
  }, {})
}

/**
 * 对本机用户按创建时间排序，当前用户列表会稳定展示。
 */
function sortUsers(users: UserProfile[]): UserProfile[] {
  return [...users].sort((left, right) => left.createdAt.localeCompare(right.createdAt))
}

/**
 * 读取大厅需要的完整本地快照。首次打开时会自动创建“我”这个本机用户。
 */
export async function loadLocalDataSnapshot(): Promise<LocalDataSnapshot> {
  const database = await openLocalDatabase()

  try {
    await ensureLocalDataReady(database)
    const preparedUsers = await getAllLocalItems(database, LOCAL_DATA_STORES.users)
    const preparedSettings = await getLocalItem(database, LOCAL_DATA_STORES.settings, LOCAL_SETTINGS_ID)
    await migrateWalletToOpeningBalance(database, preparedUsers, preparedSettings)
    await applyInterruptedRoundPenalty(database)

    const usersAfterPenalty = await getAllLocalItems(database, LOCAL_DATA_STORES.users)
    await ensureUsersHavePlayableScore(database, usersAfterPenalty)

    const [users, settings, ledgers, histories] = await Promise.all([
      getAllLocalItems(database, LOCAL_DATA_STORES.users),
      getLocalItem(database, LOCAL_DATA_STORES.settings, LOCAL_SETTINGS_ID),
      getAllLocalItems(database, LOCAL_DATA_STORES.scoreLedger),
      getAllLocalItems(database, LOCAL_DATA_STORES.matchHistory),
    ])
    const sortedUsers = sortUsers(users.map(normalizeUserProfile))
    const activeUser =
      sortedUsers.find((user) => user.id === settings?.activeUserId) ?? sortedUsers[0] ?? null
    const recentHistories = histories
      .filter((history) => history.userId === activeUser?.id)
      .sort((left, right) => right.settledAt.localeCompare(left.settledAt))
      .slice(0, RECENT_HISTORY_LIMIT)

    return {
      users: sortedUsers,
      activeUserId: activeUser?.id ?? null,
      activeUser,
      statsByUserId: calculateStatsByUserId(ledgers),
      recentHistories,
    }
  } finally {
    database.close()
  }
}

/**
 * 新建本机用户并立刻切换为当前用户。
 */
export async function createLocalUser(nickname: string): Promise<LocalDataSnapshot> {
  const database = await openLocalDatabase()

  try {
    const user = createUserProfile(nickname)
    const settings =
      await getLocalItem(database, LOCAL_DATA_STORES.settings, LOCAL_SETTINGS_ID) ??
      createAppSettings(user.id)

    await putLocalItem(database, LOCAL_DATA_STORES.users, user)
    await putLocalItem(database, LOCAL_DATA_STORES.scoreLedger, createRechargeLedger(user.id, '新用户系统赠送'))
    await putLocalItem(database, LOCAL_DATA_STORES.settings, {
      ...settings,
      activeUserId: user.id,
      updatedAt: nowIsoString(),
    })
  } finally {
    database.close()
  }

  return loadLocalDataSnapshot()
}

/**
 * 切换当前本机用户。不存在的用户会被忽略，避免 UI 状态和数据库不同步时抛异常。
 */
export async function switchLocalUser(userId: string): Promise<LocalDataSnapshot> {
  const database = await openLocalDatabase()

  try {
    const [user, settings] = await Promise.all([
      getLocalItem(database, LOCAL_DATA_STORES.users, userId),
      getLocalItem(database, LOCAL_DATA_STORES.settings, LOCAL_SETTINGS_ID),
    ])

    if (!user) {
      return loadLocalDataSnapshot()
    }

    await putLocalItem(database, LOCAL_DATA_STORES.settings, {
      ...(settings ?? createAppSettings(user.id)),
      activeUserId: user.id,
      updatedAt: nowIsoString(),
    })
  } finally {
    database.close()
  }

  return loadLocalDataSnapshot()
}

/**
 * 找到当前单机真人座位。当前玩法固定真人在南位，但这里按配置查，方便以后扩展。
 */
function findHumanSeat(seatConfigs: SeatConfig[]): SeatId {
  return seatConfigs.find((seatConfig) => seatConfig.mode === 'human')?.seat ?? 0
}

/**
 * 构造当前积分局登记对象。登记只描述“有一局积分局正在进行”，
 * 不保存任何牌面，避免把系统规则和玩法细节耦合到一起。
 */
function createActiveScoredRound(
  userId: string,
  matchState: MatchState,
  round: RoundState,
): ActiveScoredRound {
  const roundKey = createRoundKey(matchState.matchId, round.roundNumber)

  return {
    userId,
    matchId: matchState.matchId,
    roundNumber: round.roundNumber,
    roundKey,
    startedAt: nowIsoString(),
  }
}

/**
 * 登记正在进行的积分局。只要这条登记还在，刷新或非正常离开后下次加载会补扣离局分。
 */
export async function markActiveScoredRoundForUser(
  userId: string,
  matchState: MatchState,
  round: RoundState,
): Promise<LocalDataSnapshot> {
  if (round.phase === 'settled') {
    return loadLocalDataSnapshot()
  }

  const database = await openLocalDatabase()

  try {
    const settings =
      await getLocalItem(database, LOCAL_DATA_STORES.settings, LOCAL_SETTINGS_ID) ??
      createAppSettings(userId)

    await putLocalItem(database, LOCAL_DATA_STORES.settings, {
      ...settings,
      activeUserId: settings.activeUserId ?? userId,
      activeScoredRound: createActiveScoredRound(userId, matchState, round),
      updatedAt: nowIsoString(),
    })
  } finally {
    database.close()
  }

  return loadLocalDataSnapshot()
}

/**
 * 主动中途离局时立即扣系统分，并清空未完成登记。
 * 这条路径用于菜单“重新开始 / 回到首页”，刷新关闭则由下次加载补扣。
 */
export async function recordAbandonedRoundPenaltyForUser(
  userId: string,
  matchState: MatchState,
  round: RoundState,
): Promise<LocalDataSnapshot> {
  if (round.phase !== 'playing') {
    return loadLocalDataSnapshot()
  }

  const database = await openLocalDatabase()

  try {
    const settings =
      await getLocalItem(database, LOCAL_DATA_STORES.settings, LOCAL_SETTINGS_ID) ??
      createAppSettings(userId)
    const activeRound = settings.activeScoredRound ?? createActiveScoredRound(userId, matchState, round)
    const ledgers = await getAllLocalItems(database, LOCAL_DATA_STORES.scoreLedger)

    await writeAbandonedRoundPenalty(database, activeRound, ledgers)
    await clearActiveScoredRound(database, {
      ...settings,
      activeScoredRound: activeRound,
    })
    await ensureUsersHavePlayableScore(database, [normalizeUserProfile({
      id: userId,
      nickname: '',
      createdAt: activeRound.startedAt,
      updatedAt: activeRound.startedAt,
      avatarKey: '',
    })])
  } finally {
    database.close()
  }

  return loadLocalDataSnapshot()
}

/**
 * 读取结算明细。展示层会热更新重算结算，本地落库也重算一次，避免旧状态污染积分。
 */
function getSettlementForRecord(round: RoundState) {
  if (!round.settlement || round.lastTrickWinner === undefined) {
    return round.settlement
  }

  return calculateSettlement(round)
}

/**
 * 将座位结算转换成本地历史快照。
 */
function createSeatResultSnapshot(
  settlementSeats: SeatSettlement[],
  seatConfigs: SeatConfig[],
): MatchHistorySeatResult[] {
  return settlementSeats.map((seatSettlement) => ({
    seat: seatSettlement.seat,
    name:
      seatConfigs.find((seatConfig) => seatConfig.seat === seatSettlement.seat)?.name ??
      `座位 ${seatSettlement.seat}`,
    wonPierCount: seatSettlement.wonPierCount,
    baseDelta: seatSettlement.baseDelta,
    rewardDelta: seatSettlement.rewardDelta,
    totalDelta: seatSettlement.totalDelta,
  }))
}

/**
 * 记录已结算单局。ID 使用 userId + matchId + roundNumber 去重，
 * 重复调用只补缺历史，不重新计算积分，避免返回首页和自动落账并发时重复扣分。
 */
export async function recordSettledRoundForUser(
  userId: string,
  matchState: MatchState,
  round: RoundState,
): Promise<LocalDataSnapshot> {
  const settlement = getSettlementForRecord(round)

  if (!settlement || round.phase !== 'settled') {
    return loadLocalDataSnapshot()
  }

  const humanSeat = findHumanSeat(matchState.seatConfigs)
  const humanSettlement = settlement.seats.find((seatSettlement) => seatSettlement.seat === humanSeat)

  if (!humanSettlement) {
    return loadLocalDataSnapshot()
  }

  const roundKey = createRoundKey(matchState.matchId, round.roundNumber)
  const recordId = `${userId}:${roundKey}`
  const createdAt = nowIsoString()
  const database = await openLocalDatabase()

  try {
    const [existingLedgers, existingHistories] = await Promise.all([
      getAllLocalItems(database, LOCAL_DATA_STORES.scoreLedger),
      getAllLocalItems(database, LOCAL_DATA_STORES.matchHistory),
    ])
    const existingLedger = existingLedgers.find((ledgerItem) => ledgerItem.id === recordId)
    const existingHistory = existingHistories.find((historyItem) => historyItem.id === recordId)
    const currentScore = Math.max(0, calculateUserScore(existingLedgers, userId))
    const cappedTotalDelta =
      humanSettlement.totalDelta < 0
        ? Math.max(humanSettlement.totalDelta, -currentScore)
        : humanSettlement.totalDelta
    const recordedDelta = existingLedger?.delta ?? cappedTotalDelta
    const ledger: ScoreLedger = {
      id: recordId,
      userId,
      matchId: matchState.matchId,
      roundNumber: round.roundNumber,
      roundKey,
      seat: humanSeat,
      delta: recordedDelta,
      kind: 'round',
      baseDelta: humanSettlement.baseDelta,
      rewardDelta: humanSettlement.rewardDelta,
      wonPierCount: humanSettlement.wonPierCount,
      isSweep: settlement.isSweep && settlement.collector === humanSeat,
      summary: humanSettlement.summary,
      createdAt: existingLedger?.createdAt ?? createdAt,
    }
    const history: MatchHistory = {
      id: recordId,
      userId,
      matchId: matchState.matchId,
      roundNumber: round.roundNumber,
      roundKey,
      seat: humanSeat,
      delta: recordedDelta,
      isSweep: settlement.isSweep && settlement.collector === humanSeat,
      summary: settlement.summary,
      seatResults: createSeatResultSnapshot(settlement.seats, matchState.seatConfigs),
      settledAt: existingHistory?.settledAt ?? createdAt,
    }

    if (!existingLedger) {
      await putLocalItem(database, LOCAL_DATA_STORES.scoreLedger, ledger)
    }

    if (!existingHistory) {
      await putLocalItem(database, LOCAL_DATA_STORES.matchHistory, history)
    }

    if (!existingLedger) {
      await ensureUsersHavePlayableScore(database, [normalizeUserProfile({
        id: userId,
        nickname: '',
        createdAt,
        updatedAt: createdAt,
        avatarKey: '',
      })])
    }

    const settings = await getLocalItem(database, LOCAL_DATA_STORES.settings, LOCAL_SETTINGS_ID)

    if (
      settings?.activeScoredRound?.userId === userId &&
      settings.activeScoredRound.roundKey === roundKey
    ) {
      await clearActiveScoredRound(database, settings)
    }
  } finally {
    database.close()
  }

  return loadLocalDataSnapshot()
}
