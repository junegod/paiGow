import type {
  MatchState,
  SeatConfig,
  SeatId,
  StartRoundOptions,
  TurnAction,
} from '@/rules-core/types'

/** 联机协议版本。客户端与服务端不一致时要求玩家刷新页面。 */
export const ONLINE_PROTOCOL_VERSION = '2026-08-28-room-v1'

/** 房间内一个座位的联机登录信息，重连时使用 token 找回座位。 */
export interface OnlinePlayer {
  /** 服务端生成的一次房间身份令牌。 */
  token: string
  /** 服务端分配的固定座位。 */
  seat: SeatId
  /** 玩家在加入房间时填写的名字。 */
  name: string
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
}

/** 客户端发给服务端的消息。 */
export type OnlineClientMessage =
  | { type: 'create-room'; playerName: string }
  | { type: 'join-room'; roomCode: string; playerName: string }
  | { type: 'resume-room'; roomCode: string; playerToken: string }
  | { type: 'configure-bots'; playerToken: string; botNames: string[] }
  | { type: 'start-match'; playerToken: string }
  | { type: 'leave-room'; playerToken: string }
  | { type: 'submit-action'; playerToken: string; action: TurnAction }
  | { type: 'request-room'; playerToken?: string }
  | { type: 'request-state'; playerToken?: string }
  | { type: 'ping' }

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
  | { type: 'match-state'; state: MatchState }
  | { type: 'start-round-options'; options: StartRoundOptions }
  | { type: 'pong' }
  | { type: 'player-disconnected'; seat: SeatId; name: string }
  | { type: 'host-changed'; seat: SeatId; name: string }
  | { type: 'player-reconnected'; seat: SeatId; name: string }
  | { type: 'error'; code: OnlineErrorCode; message: string }

/** 第一版联机错误码，前端转成玩家能理解的中文提示。 */
export type OnlineErrorCode =
  | 'bad-message'
  | 'room-not-found'
  | 'room-full'
  | 'seat-token-invalid'
  | 'not-host'
  | 'match-started'
  | 'invalid-action'
  | 'server-error'
