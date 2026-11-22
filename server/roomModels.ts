import { SeededRandom } from '@/rules-core/random'
import type { MatchState, PlayedAction, SeatConfig, SeatId } from '@/rules-core/types'
import type { OnlineRoomState, OnlineRoomSummary, OnlineServerMessage } from '@/services/online/types'

/** WebSocket 兼容类型；房间领域层只依赖文本发送与关闭能力。 */
export type RoomSocket = {
  readonly readyState: number
  send: (data: string) => void
  close: (code?: number, reason?: string) => void
}

/** 服务端保存的真人连接和断线保留信息。 */
export interface RoomPlayer {
  token: string
  seat: SeatId
  name: string
  socket: RoomSocket
  online: boolean
  disconnectedAt: number | null
}

/** 一个可重连的联机房间。 */
export interface OnlineRoom {
  roomCode: string
  createdAt: number
  lastActivityAt: number
  hostSeat: SeatId
  players: Map<SeatId, RoomPlayer>
  match: MatchState
  rng: SeededRandom
  botDifficulty: 'standard'
  isPlaying: boolean
  botMoveTimer: NodeJS.Timeout | null
  revision: number
}

/** 房间无真人活动时的最长保留时间。 */
export const ROOM_IDLE_TTL_MS = 6 * 60 * 60 * 1000
/** 断线玩家保留原座位的时间。 */
export const DISCONNECT_RETENTION_MS = 3 * 60 * 1000

/**
 * 判断断线座位是否已超过保留期限，供大厅统计和实际座位清理共用。
 *
 * @param player 真人座位及其当前连接状态。
 * @param now 本次判断使用的服务端时间戳。
 * @returns 已过期且可释放该座位时返回 true。
 */
export function isDisconnectedSeatExpired(player: RoomPlayer, now: number): boolean {
  return !player.online &&
    player.disconnectedAt !== null &&
    now - player.disconnectedAt >= DISCONNECT_RETENTION_MS
}

/** 对纯 JSON 房间状态做兼容 Node 16 的深拷贝。 */
function cloneJsonValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

/** 生成六位纯数字房间码，方便口头分享。 */
export function createRoomCode(): string {
  let code = ''
  for (let index = 0; index < 6; index += 1) {
    code += String(Math.floor(Math.random() * 10))
  }
  return code
}

/** 清洗玩家和机器人昵称，限制为十二个字符。 */
export function sanitizePlayerName(value: unknown): string {
  if (typeof value !== 'string') {
    return '玩家'
  }
  return value.trim().slice(0, 12) || '玩家'
}

/** 创建房间的四个默认座位。 */
export function createDefaultSeatConfigs(): SeatConfig[] {
  return [
    { seat: 0, name: '等待玩家', mode: 'bot', color: '#38bdf8' },
    { seat: 1, name: '村里的阿明', mode: 'bot', color: '#fbbf24' },
    { seat: 2, name: '村里的老周', mode: 'bot', color: '#f472b6' },
    { seat: 3, name: '村里的细妹', mode: 'bot', color: '#4ade80' },
  ]
}

/** 构造客户端渲染所需的房间公开状态。 */
export function createOnlineRoomState(room: OnlineRoom): OnlineRoomState {
  return {
    roomCode: room.roomCode,
    seatConfigs: cloneJsonValue(room.match.seatConfigs),
    onlineSeats: [...room.players.values()].filter((player) => player.online).map((player) => player.seat),
    isPlaying: room.isPlaying,
    hostSeat: room.hostSeat,
    revision: room.revision,
    players: [...room.players.values()].map((player) => ({
      seat: player.seat,
      name: player.name,
      online: player.online,
      isHost: player.seat === room.hostSeat,
    })),
  }
}

/** 将未揭示的背面出牌替换为只保留张数的占位牌。 */
function redactHiddenPlay(play: PlayedAction, playIndex: number): PlayedAction {
  if (play.revealed || play.pattern.isOpen) {
    return play
  }

  return {
    ...play,
    cards: Array.from({ length: play.pattern.cardCount }, (_, cardIndex) => ({
      id: `hidden-${play.seat}-${playIndex}-${cardIndex}`,
      definitionId: 'long_tian',
      copyIndex: 0,
      order: cardIndex,
    })),
    pattern: {
      ...play.pattern,
      cardDefinitionIds: [],
      cardInstanceIds: [],
    },
  }
}

/**
 * 生成指定座位视角的牌局状态；只保留自己的手牌，并彻底移除未揭示牌实例。
 */
export function createMatchStateForSeat(room: OnlineRoom, viewerSeat: SeatId): MatchState {
  const state = cloneJsonValue(room.match)
  const round = state.currentRound
  if (!round) {
    return state
  }

  for (const seatState of round.seats) {
    if (seatState.seat !== viewerSeat) {
      seatState.hand = []
    }
    seatState.wonTricks = seatState.wonTricks.map((trick) => ({
      ...trick,
      plays: trick.plays.map(redactHiddenPlay),
    }))
  }

  if (round.currentTrick) {
    round.currentTrick.plays = round.currentTrick.plays.map(redactHiddenPlay)
  }
  round.publicTrickLog = round.publicTrickLog.map((trick) => ({
    ...trick,
    plays: trick.plays.map(redactHiddenPlay),
  }))
  return state
}

/** 生成指定座位的完整房间快照消息。 */
export function createRoomStateMessageForSeat(room: OnlineRoom, viewerSeat: SeatId): OnlineServerMessage {
  return {
    type: 'room-state',
    room: createOnlineRoomState(room),
    state: createMatchStateForSeat(room, viewerSeat),
  }
}

/** 生成指定座位的轻量牌局快照消息。 */
export function createMatchStateMessageForSeat(room: OnlineRoom, viewerSeat: SeatId): OnlineServerMessage {
  return {
    type: 'match-state',
    roomCode: room.roomCode,
    revision: room.revision,
    state: createMatchStateForSeat(room, viewerSeat),
  }
}

/**
 * 生成联机大厅使用的公开房间摘要，仅暴露在线人数和占座数量。
 *
 * @param room 等待开局的房间。
 * @param now 本次列表请求的服务端时间戳，与加入时使用相同的保留规则。
 * @returns 大厅用于展示和判断是否可加入的房间摘要。
 */
export function createOnlineRoomSummary(room: OnlineRoom, now: number): OnlineRoomSummary {
  const players = [...room.players.values()]
  return {
    roomCode: room.roomCode,
    hostName: room.players.get(room.hostSeat)?.name ?? '房主',
    onlineCount: players.filter((player) => player.online).length,
    // 加入请求会先释放已过期的座位，列表不必等到后台维护才显示空位。
    occupiedCount: players.filter((player) => !isDisconnectedSeatExpired(player, now)).length,
    maxCount: room.match.seatConfigs.length,
    isPlaying: room.isPlaying,
    createdAt: room.createdAt,
  }
}
