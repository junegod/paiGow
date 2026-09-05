import type {
  MatchState,
  SeatConfig,
  SeatId,
  StartRoundOptions,
  TurnAction,
} from '@/rules-core/types'

/** 联机协议版本。客户端与服务端不一致时要求玩家刷新页面。 */
export const ONLINE_PROTOCOL_VERSION = '2026-09-05-room-v2'

/** 房间内一个座位的联机登录信息，重连时使用 token 找回座位。 */
export interface OnlinePlayer {
  /** 服务端生成的一次房间身份令牌。 */
  token: string
  /** 服务端分配的固定座位。 */
  seat: SeatId
  /** 玩家在加入房间时填写的名字。 */
  name: string
}

/** 一次"按座位裁剪"的广播：每个接收者拿到各自视角的专属消息。 */
export interface OnlineSeatBroadcast {
  /** 接收者座位。 */
  seat: SeatId
  /** 该座位视角下的消息。 */
  message: OnlineServerMessage
}

/** 服务端发给客户端的房间整体状态。 */
export interface OnlineRoomState {
  /** 六位房间码。 */
  roomCode: string
  /** 大厅当前座位配置，对局开始后会复制到 MatchState。 */
  seatConfigs: SeatConfig[]
  /** 当前在线座位；断线玩家座位暂时保留，方便自动重连。 */
  onlineSeats: SeatId[]
  /** 当前房间是否已经开局。 */
  isPlaying: boolean
  /** 房主座位；创建者是座位 0，房主离开后自动迁移给剩余真人。 */
  hostSeat: SeatId
  /** 房间状态递增版本；客户端用它忽略重连期间迟到的旧快照。 */
  revision: number
  /** 真人座位连接状态；机器人座位不出现在此列表。 */
  players: OnlineRoomPlayerState[]
}

/** 房间内真人玩家的公开连接状态。 */
export interface OnlineRoomPlayerState {
  /** 服务端固定座位。 */
  seat: SeatId
  /** 玩家昵称。 */
  name: string
  /** 当前 WebSocket 是否在线。 */
  online: boolean
  /** 是否是当前房主。 */
  isHost: boolean
}

/** 联机大厅里一张房间的公开摘要，不包含任何座位明细或令牌。 */
export interface OnlineRoomSummary {
  /** 六位房间码，玩家用它加入房间。 */
  roomCode: string
  /** 房主名字；房主离开后服务端会自动迁移，列表展示始终是最新房主。 */
  hostName: string
  /** 当前在线真人数量，断线三分钟内的玩家不算在线。 */
  onlineCount: number
  /** 真人座位上限，当前固定为 4。 */
  maxCount: number
  /** 是否已经开局；开局的房间不在大厅列表展示。 */
  isPlaying: boolean
  /** 房间创建时间戳，用于展示等待时长。 */
  createdAt: number
}

/**
 * 服务器视角下"某个座位"能看到的手牌信息。
 * 自己的座位返回完整明牌；其他真人座位只返回张数，牌面一律隐藏。
 */
export interface OnlineHandVisibility {
  /** 手牌张数。 */
  count: number
  /** 只有自己座位的 hand 才携带具体牌实例；其他座位永远为空数组。 */
  hand: []
}

/** 客户端业务消息；OnlineClient 发送时会统一补充协议版本。 */
export type OnlineClientPayload =
  | { type: 'create-room'; playerName: string }
  | { type: 'join-room'; roomCode: string; playerName: string }
  | { type: 'list-rooms' }
  | { type: 'resume-room'; roomCode: string; playerToken: string }
  | { type: 'configure-bots'; playerToken: string; botNames: string[] }
  | { type: 'start-match'; playerToken: string }
  | { type: 'leave-room'; playerToken: string }
  | { type: 'submit-action'; playerToken: string; action: TurnAction }
  | { type: 'request-room'; playerToken?: string }
  | { type: 'request-state'; playerToken?: string }
  | { type: 'ping' }

/** 客户端发给服务端的完整消息。 */
export type OnlineClientMessage = OnlineClientPayload & {
  /** 前后端协议版本不一致时服务端直接拒绝，避免滚动发布期间状态互相污染。 */
  protocolVersion: string
}

/** 服务端发给客户端的消息。 */
export type OnlineServerMessage =
  | {
      type: 'room-created'
      roomCode: string
      player: OnlinePlayer
      room: OnlineRoomState
      state: MatchState
    }
  | {
      type: 'room-joined'
      roomCode: string
      player: OnlinePlayer
      room: OnlineRoomState
      state: MatchState
    }
  | {
      type: 'room-resumed'
      roomCode: string
      player: OnlinePlayer
      room: OnlineRoomState
      state: MatchState
    }
  | { type: 'room-state'; room: OnlineRoomState; state: MatchState }
  | { type: 'match-state'; roomCode: string; revision: number; state: MatchState }
  | { type: 'start-round-options'; options: StartRoundOptions }
  | { type: 'pong' }
  | { type: 'room-list'; rooms: OnlineRoomSummary[] }
  | { type: 'player-disconnected'; seat: SeatId; name: string }
  | { type: 'host-changed'; seat: SeatId; name: string }
  | { type: 'player-reconnected'; seat: SeatId; name: string }
  | { type: 'room-left' }
  | { type: 'error'; code: OnlineErrorCode; message: string }

/** 第一版联机错误码，前端转成玩家能理解的中文提示。 */
export type OnlineErrorCode =
  | 'bad-message'
  | 'protocol-mismatch'
  | 'room-not-found'
  | 'room-full'
  | 'seat-token-invalid'
  | 'not-host'
  | 'already-in-room'
  | 'match-started'
  | 'invalid-action'
  | 'server-error'
