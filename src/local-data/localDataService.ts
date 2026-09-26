import type {
  ActiveScoredRound,
  AudioPreferences,
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
  BotDifficulty,
  MatchState,
  RoundState,
  SeatConfig,
  SeatId,
  SeatSettlement,
} from '@/rules-core/types'
import {
  DEFAULT_BOT_DIFFICULTY,
  normalizeBotDifficulty,
} from '@/app/botDifficulty'
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
    botDifficulty: DEFAULT_BOT_DIFFICULTY,
    soundEffectsEnabled: true,
    soundEffectsVolume: 0.86,
    voiceCallsEnabled: true,
    voiceCallsVolume: 0.92,
    skipOpeningCeremony: false,
    activeScoredRound: null,
  }
}

/**
 * 把旧版本或异常数据中的音量限制到合法范围，避免播放器因非法音量抛错。
 *
 * @param value IndexedDB 中读取到的未知音量值。
 * @param fallback 字段缺失或非法时采用的默认值。
 * @returns 0 到 1 之间的有效音量。
 */
function normalizeVolume(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback
  }

  return Math.min(1, Math.max(0, value))
}

/**
 * 兼容旧版本设置并生成完整声音偏好。布尔字段只有明确为 false 时才关闭，
 * 避免应用升级后因为旧数据缺少字段而意外静音。
 *
 * @param settings 本机保存的应用设置，首次启动时可能不存在。
 * @returns 可直接供音频管理器使用的声音偏好。
 */
function normalizeAudioPreferences(settings?: Partial<AppSettings> | null): AudioPreferences {
  return {
    soundEffectsEnabled: settings?.soundEffectsEnabled !== false,
    soundEffectsVolume: normalizeVolume(settings?.soundEffectsVolume, 0.86),
    voiceCallsEnabled: settings?.voiceCallsEnabled !== false,
    voiceCallsVolume: normalizeVolume(settings?.voiceCallsVolume, 0.92),
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
  const normalizedBotDifficulty = normalizeBotDifficulty(settings?.botDifficulty)
  const normalizedAudioPreferences = normalizeAudioPreferences(settings)
  const shouldRepairSettings =
    !settings ||
    !activeUserExists ||
    settings.botDifficulty !== normalizedBotDifficulty ||
    settings.soundEffectsEnabled !== normalizedAudioPreferences.soundEffectsEnabled ||
    settings.soundEffectsVolume !== normalizedAudioPreferences.soundEffectsVolume ||
    settings.voiceCallsEnabled !== normalizedAudioPreferences.voiceCallsEnabled ||
    settings.voiceCallsVolume !== normalizedAudioPreferences.voiceCallsVolume ||
    typeof settings.skipOpeningCeremony !== 'boolean'

  if (shouldRepairSettings) {
    await putLocalItem(database, LOCAL_DATA_STORES.settings, {
      ...(settings ?? createAppSettings(users[0].id)),
      activeUserId: activeUserExists ? settings?.activeUserId ?? users[0].id : users[0].id,
      botDifficulty: normalizedBotDifficulty,
      ...normalizedAudioPreferences,
      skipOpeningCeremony: settings?.skipOpeningCeremony === true,
      updatedAt: nowIsoString(),
      walletVersion: settings?.walletVersion ?? WALLET_VERSION,
    })
  }
}

/**
 * 创建系统免费补分流水；积分无货币价值，不计入对局局数。
 * 保留 recharge 类型和旧 ID 前缀，避免升级后旧流水无法识别。
 * @param userId 本机玩家标识。
 * @param summary 免费补分的说明。
 * @param amount 免费补充的练习积分。
 * @returns 与旧版存储兼容的积分流水。
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
 * @param userId 本机玩家标识。
 * @param amount 校准所需的积分变化。
 * @returns 使用固定标识的幂等迁移流水。
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
    summary: '积分规则升级，校准初始积分',
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
 * @param database 已打开的本地数据库。
 * @param users 需要检查积分的本机玩家。
 * @returns 所有必要的免费补分写入完成后返回。
 */
async function ensureUsersHavePlayableScore(database: IDBDatabase, users: UserProfile[]): Promise<void> {
  const ledgers = await getAllLocalItems(database, LOCAL_DATA_STORES.scoreLedger)

  await Promise.all(
    users
      .filter((user) => calculateUserScore(ledgers, user.id) <= 0)
      .map((user) => putLocalItem(database, LOCAL_DATA_STORES.scoreLedger, createRechargeLedger(user.id, '积分不足，系统免费补充练习积分'))),
  )
}

/**
 * 旧版本本地积分没有“初始 100 钱包”概念。首次升级时统一校准到 100，
 * 之后真实对局的积分不再反复校准，只有积分用完才免费补分。
 * @param database 已打开的本地数据库。
 * @param users 待校准的本机玩家。
 * @param settings 旧版设置，缺失时执行首次迁移。
 * @returns 积分校准和版本记录完成后返回。
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
 * 清理旧版本留下的未完成积分局登记。新版不再开局预登记，
 * 因此启动时不能自动补扣，只做兼容性清理，避免旧登记影响当前局扣分。
 */
async function clearInterruptedRoundWithoutPenalty(database: IDBDatabase): Promise<void> {
  const settings = await getLocalItem(database, LOCAL_DATA_STORES.settings, LOCAL_SETTINGS_ID)

  if (!settings?.activeScoredRound) {
    return
  }

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
    await clearInterruptedRoundWithoutPenalty(database)

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
      botDifficulty: normalizeBotDifficulty(settings?.botDifficulty),
      audioPreferences: normalizeAudioPreferences(settings),
      skipOpeningCeremony: settings?.skipOpeningCeremony === true,
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
 * 更新单机机器人难度。难度属于设备级应用设置，不跟随用户切换，
 * 当前牌局不会重建，新的难度会从下一次机器人决策开始生效。
 *
 * @param difficulty 用户在首页选择的入门、标准或专家难度。
 * @returns 写入后的完整本地数据快照。
 */
export async function updateBotDifficultySetting(
  difficulty: BotDifficulty,
): Promise<LocalDataSnapshot> {
  const database = await openLocalDatabase()

  try {
    const settings =
      await getLocalItem(database, LOCAL_DATA_STORES.settings, LOCAL_SETTINGS_ID) ??
      createAppSettings(null)

    await putLocalItem(database, LOCAL_DATA_STORES.settings, {
      ...settings,
      botDifficulty: normalizeBotDifficulty(difficulty),
      updatedAt: nowIsoString(),
    })
  } finally {
    database.close()
  }

  return loadLocalDataSnapshot()
}

/**
 * 更新设备级声音设置。调用方可以只修改其中一个字段，其余字段会保留当前值；
 * 服务层统一做音量边界修正，避免 UI 或旧版本数据写入非法值。
 *
 * @param patch 需要修改的声音设置字段。
 * @returns 写入后的完整本地数据快照。
 */
export async function updateAudioPreferencesSetting(
  patch: Partial<AudioPreferences>,
): Promise<LocalDataSnapshot> {
  const database = await openLocalDatabase()

  try {
    const settings =
      await getLocalItem(database, LOCAL_DATA_STORES.settings, LOCAL_SETTINGS_ID) ??
      createAppSettings(null)
    const nextAudioPreferences = normalizeAudioPreferences({
      ...settings,
      ...patch,
    })

    await putLocalItem(database, LOCAL_DATA_STORES.settings, {
      ...settings,
      ...nextAudioPreferences,
      updatedAt: nowIsoString(),
    })
  } finally {
    database.close()
  }

  return loadLocalDataSnapshot()
}

/**
 * 更新是否跳过开局抓牌演出。该设置只影响动画展示，
 * 发牌、定庄和规则状态仍由引擎完整执行。
 *
 * @param skipOpeningCeremony 是否在开局后直接进入手牌操作。
 * @returns 写入后的完整本地数据快照。
 */
export async function updateSkipOpeningCeremonySetting(
  skipOpeningCeremony: boolean,
): Promise<LocalDataSnapshot> {
  const database = await openLocalDatabase()

  try {
    const settings =
      await getLocalItem(database, LOCAL_DATA_STORES.settings, LOCAL_SETTINGS_ID) ??
      createAppSettings(null)

    await putLocalItem(database, LOCAL_DATA_STORES.settings, {
      ...settings,
      skipOpeningCeremony,
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
 * 主动中途离局时立即扣系统分，并清空未完成登记。
 * 这条路径只用于菜单“重新开始 / 返回首页”的强制离开确认；
 * 普通开局、刷新提示和关闭页面都不会提前或自动扣分。
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
    const activeRound = createActiveScoredRound(userId, matchState, round)
    const ledgers = await getAllLocalItems(database, LOCAL_DATA_STORES.scoreLedger)

    await writeAbandonedRoundPenalty(database, activeRound, ledgers)
    await clearActiveScoredRound(database, settings)
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
