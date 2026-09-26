import type { BotDifficulty, SeatId } from '@/rules-core/types'

/**
 * 本机积分局的未完成登记。它属于系统防刷牌机制，
 * 不参与任何玩法规则；当前只在用户确认强制离开时临时构造，
 * 旧版本遗留到设置里的登记会在启动时清理但不会自动扣分。
 */
export interface ActiveScoredRound {
  /** 归属用户 ID，避免切换用户后误扣到别人账上。 */
  userId: string
  /** 当前 mock 对局 ID。 */
  matchId: string
  /** 当前局号。 */
  roundNumber: number
  /** 去重用的局唯一键。 */
  roundKey: string
  /** 开始时间，用于后续展示离局记录或排查本地数据。 */
  startedAt: string
}

/**
 * 本机用户档案。首版只保留昵称与创建时间，后续接服务器时可以补头像、绑定设备等字段。
 */
export interface UserProfile {
  /** 本机生成的稳定用户 ID。 */
  id: string
  /** 大厅、结算和积分统计里展示的昵称。 */
  nickname: string
  /** 用户创建时间，使用 ISO 字符串方便 IndexedDB 与未来服务端直接传输。 */
  createdAt: string
  /** 最近一次修改时间，当前创建和切换不会改昵称，先为后续编辑资料预留。 */
  updatedAt: string
  /** 本机随机头像编号，只影响首页展示，不参与规则。 */
  avatarKey: string
}

/**
 * 积分流水。每局结算只给当前本机用户落一条，避免总分只能覆盖不能追溯。
 */
export interface ScoreLedger {
  /** 流水 ID，同时也是去重键，确保同一用户同一局不会重复记账。 */
  id: string
  /** 归属用户 ID。 */
  userId: string
  /** 当前 mock 对局 ID，后续服务端可映射为房间或牌局 ID。 */
  matchId: string
  /** 局号。 */
  roundNumber: number
  /** 去重用的局唯一键。 */
  roundKey: string
  /** 当前用户所在座位，当前单机版固定为真人座位。 */
  seat: SeatId
  /** 本局总积分变化，正数为进分，负数为出分。 */
  delta: number
  /** 流水类型：对局积分、系统免费补分或中途离局扣分。 */
  kind: 'round' | 'recharge' | 'leave-penalty'
  /** 基础分变化。 */
  baseDelta: number
  /** 奖励分变化。 */
  rewardDelta: number
  /** 当前用户本局赢到的墩数。 */
  wonPierCount: number
  /** 是否满 8 墩。 */
  isSweep: boolean
  /** 结算摘要，方便积分明细直接展示。 */
  summary: string
  /** 结算落库时间。 */
  createdAt: string
}

/**
 * 一局历史摘要。它比积分流水更偏复盘展示，保存四家分数和结算说明。
 */
export interface MatchHistory {
  /** 历史记录 ID，和积分流水一样按用户与局去重。 */
  id: string
  /** 归属用户 ID。 */
  userId: string
  /** 对局 ID。 */
  matchId: string
  /** 局号。 */
  roundNumber: number
  /** 去重用的局唯一键。 */
  roundKey: string
  /** 当前用户所在座位。 */
  seat: SeatId
  /** 当前用户本局积分变化。 */
  delta: number
  /** 是否满 8 墩。 */
  isSweep: boolean
  /** 结算总说明。 */
  summary: string
  /** 四个座位的结算快照，用于后续战绩页或云同步。 */
  seatResults: MatchHistorySeatResult[]
  /** 结算时间。 */
  settledAt: string
}

/**
 * 历史记录里的座位结算快照。
 */
export interface MatchHistorySeatResult {
  /** 座位编号。 */
  seat: SeatId
  /** 结算时的座位名称。 */
  name: string
  /** 赢到的墩数。 */
  wonPierCount: number
  /** 基础分变化。 */
  baseDelta: number
  /** 奖励分变化。 */
  rewardDelta: number
  /** 总积分变化。 */
  totalDelta: number
}

/**
 * 本机应用设置。现在只保存当前用户，后续可继续放音效、跳过动画等轻量设置。
 */
export interface AppSettings {
  /** 固定主键，IndexedDB 里只维护一条设置记录。 */
  id: 'default'
  /** 当前选中的本机用户。 */
  activeUserId: string | null
  /** 创建时间。 */
  createdAt: string
  /** 更新时间。 */
  updatedAt: string
  /** 钱包规则版本，用于旧本地数据一次性补齐默认 100 积分。 */
  walletVersion: number
  /** 单机机器人难度；三个机器人共用同一档位，默认标准。 */
  botDifficulty: BotDifficulty
  /** 是否播放洗牌、落牌、骰子和结算等游戏音效。 */
  soundEffectsEnabled: boolean
  /** 游戏音效总音量，取值范围为 0 到 1。 */
  soundEffectsVolume: number
  /** 是否播放四个座位各自的出牌喊声。 */
  voiceCallsEnabled: boolean
  /** 人物喊声总音量，取值范围为 0 到 1。 */
  voiceCallsVolume: number
  /** 是否跳过每局开场的洗牌、定庄和抓牌演出。 */
  skipOpeningCeremony: boolean
  /** 旧版本保留字段。新版不再开局预登记，启动时会清理旧值。 */
  activeScoredRound?: ActiveScoredRound | null
}

/**
 * 按积分流水实时计算的用户统计。
 */
export interface UserStats {
  /** 总积分。 */
  totalScore: number
  /** 已记录局数。 */
  roundsPlayed: number
  /** 单局最高进分。 */
  bestRoundDelta: number
  /** 满 8 墩次数。 */
  sweepCount: number
}

/**
 * 大厅一次性消费的本地数据快照。
 */
export interface LocalDataSnapshot {
  /** 所有本机用户。 */
  users: UserProfile[]
  /** 当前用户 ID。 */
  activeUserId: string | null
  /** 当前用户档案。 */
  activeUser: UserProfile | null
  /** 当前保存的机器人难度，首页和下一局共用。 */
  botDifficulty: BotDifficulty
  /** 当前设备保存的游戏声音偏好。 */
  audioPreferences: AudioPreferences
  /** 是否跳过每局开场的抓牌动画。 */
  skipOpeningCeremony: boolean
  /** 每个用户的积分统计。 */
  statsByUserId: Record<string, UserStats>
  /** 当前用户最近几局历史。 */
  recentHistories: MatchHistory[]
}

/**
 * 游戏声音偏好。音效和人物喊声分成两个通道，方便玩家独立关闭或调节音量。
 */
export interface AudioPreferences {
  /** 是否播放普通游戏音效。 */
  soundEffectsEnabled: boolean
  /** 普通游戏音效音量，取值范围为 0 到 1。 */
  soundEffectsVolume: number
  /** 是否播放人物喊声。 */
  voiceCallsEnabled: boolean
  /** 人物喊声音量，取值范围为 0 到 1。 */
  voiceCallsVolume: number
}
