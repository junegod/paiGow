import { ONLINE_PROTOCOL_VERSION } from '@/services/online/types'
import type {
  OnlineClientMessage,
  OnlineServerMessage,
} from '@/services/online/types'
import type {
  MatchState,
  SeatId,
  StartRoundOptions,
  TurnAction,
} from '@/rules-core/types'

/** 断线后需要恢复的联机会话。 */
export interface OnlineSessionSnapshot {
  roomCode: string
  playerToken: string
  playerName: string
  seat: SeatId
}

/** 浏览器 localStorage 里的联机会话键。 */
const ONLINE_SESSION_STORAGE_KEY = 'da-suo-zi.online-session'

/**
 * WebSocket 客户端封装，负责连接、心跳、自动重连和消息 JSON 编解码。
 */
export class OnlineClient {
  private readonly listeners = new Set<(message: OnlineServerMessage) => void>()
  private readonly statusListeners = new Set<(status: OnlineClientStatus) => void>()
  private socket: WebSocket | null = null
  private reconnectTimer: number | null = null
  private heartbeatTimer: number | null = null
  private reconnectAttempt = 0
  private disposed = false
  private currentStatus: OnlineClientStatus = 'idle'
  private pendingMessages: OnlineClientMessage[] = []
  private readonly url: string

  /**
   * 创建联机客户端。
   *
   * @param url WebSocket 服务地址。
   */
  public constructor(url: string) {
    this.url = url
  }

  /**
   * 当前连接状态。
   */
  public get status(): OnlineClientStatus {
    return this.currentStatus
  }

  /**
   * 订阅服务端消息。
   *
   * @param listener 消息回调。
   * @returns 取消订阅函数。
   */
  public onMessage(listener: (message: OnlineServerMessage) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /**
   * 订阅连接状态变化。
   *
   * @param listener 状态回调。
   * @returns 取消订阅函数。
   */
  public onStatus(listener: (status: OnlineClientStatus) => void): () => void {
    this.statusListeners.add(listener)
    listener(this.currentStatus)
    return () => {
      this.statusListeners.delete(listener)
    }
  }

  /**
   * 建立连接。已有连接时不会重复建立。
   */
  public connect(): void {
    if (this.disposed || this.socket) {
      return
    }

    this.setStatus('connecting')
    const socket = new WebSocket(this.url)
    socket.onopen = () => {
      this.socket = socket
      this.reconnectAttempt = 0
      this.setStatus('connected')
      this.flushPendingMessages()
      this.startHeartbeat()
    }
    socket.onmessage = (event) => {
      try {
        const message = JSON.parse(String(event.data)) as OnlineServerMessage

        for (const listener of this.listeners) {
          listener(message)
        }
      } catch {
        this.emit({
          type: 'error',
          code: 'bad-message',
          message: '服务器返回的数据无法识别。',
        })
      }
    }
    socket.onclose = () => {
      this.detachSocket(socket)
      this.setStatus('reconnecting')
      this.scheduleReconnect()
    }
    socket.onerror = () => {
      socket.close()
    }
  }

  /**
   * 主动断开并停止自动重连，用于玩家明确离开联机。
   */
  public disconnect(): void {
    this.disposed = true
    this.stopTimers()
    this.socket?.close()
    this.detachSocket(this.socket)
    this.setStatus('idle')
  }

  /**
   * 创建房间。
   *
   * @param playerName 创建者名字。
   */
  public createRoom(playerName: string): void {
    this.send({
      type: 'create-room',
      playerName,
    })
  }

  /**
   * 输入房间码加入。
   *
   * @param roomCode 六位房间码。
   * @param playerName 加入者名字。
   */
  public joinRoom(roomCode: string, playerName: string): void {
    this.send({
      type: 'join-room',
      roomCode: roomCode.trim(),
      playerName,
    })
  }

  /**
   * 请求最新的等待开局房间列表。服务端只返回公开摘要，不含令牌。
   */
  public requestRoomList(): void {
    this.send({
      type: 'list-rooms',
    })
  }

  /**
   * 用本地保存的会话恢复座位。
   *
   * @param session 本地保存的房间和身份。
   */
  public resumeRoom(session: OnlineSessionSnapshot): void {
    this.send({
      type: 'resume-room',
      roomCode: session.roomCode,
      playerToken: session.playerToken,
    })
  }

  /**
   * 房主修改机器人名字。
   *
   * @param playerToken 房主令牌。
   * @param botNames 三个机器人名字。
   */
  public configureBots(playerToken: string, botNames: string[]): void {
    this.send({
      type: 'configure-bots',
      playerToken,
      botNames,
    })
  }

  /**
   * 房主开始新一局。
   *
   * @param playerToken 房主令牌。
   */
  public startMatch(playerToken: string): void {
    this.send({
      type: 'start-match',
      playerToken,
    })
  }

  /**
   * 明确离开房间。服务端会把该座位交给机器人，并在有剩余真人时迁移房主。
   *
   * @param playerToken 当前玩家令牌。
   */
  public leaveRoom(playerToken: string): void {
    this.send({
      type: 'leave-room',
      playerToken,
    })
  }

  /**
   * 提交当前座位动作。
   *
   * @param playerToken 玩家令牌。
   * @param action 规则动作。
   */
  public submitAction(playerToken: string, action: TurnAction): void {
    this.send({
      type: 'submit-action',
      playerToken,
      action,
    })
  }

  /**
   * 移动端重新可见时主动刷新房间和牌局。
   *
   * @param playerToken 可选玩家令牌。
   */
  public refreshRoom(playerToken?: string): void {
    this.send({
      type: 'request-room',
      playerToken,
    })
  }

  /**
   * 只请求最新牌局状态。
   *
   * @param playerToken 可选玩家令牌。
   */
  public requestState(playerToken?: string): void {
    this.send({
      type: 'request-state',
      playerToken,
    })
  }

  /**
   * 发送任意协议消息；连接未就绪时静默丢弃，由重连兜底。
   *
   * @param message 客户端消息。
   */
  private send(message: OnlineClientMessage): void {
    if (this.socket?.readyState !== WebSocket.OPEN) {
      this.pendingMessages.push(message)
      this.connect()
      return
    }

    this.socket.send(JSON.stringify(message))
  }

  /**
   * 连接建立后补发连接期间产生的消息，避免恢复请求被丢弃。
   */
  private flushPendingMessages(): void {
    const pendingMessages = [...this.pendingMessages]
    this.pendingMessages = []

    for (const message of pendingMessages) {
      this.send(message)
    }
  }

  /**
   * 发送私有错误消息，供 UI 显示本地连接异常。
   *
   * @param message 服务端风格错误。
   */
  private emit(message: OnlineServerMessage): void {
    for (const listener of this.listeners) {
      listener(message)
    }
  }

  /**
   * 定时 ping，保证中间设备不会很快掐断空闲连接。
   */
  private startHeartbeat(): void {
    if (this.heartbeatTimer !== null) {
      window.clearInterval(this.heartbeatTimer)
    }

    this.heartbeatTimer = window.setInterval(() => {
      this.send({ type: 'ping' })
    }, 25_000)
  }

  /**
   * 指数退避自动重连，最多等 5 秒；内部朋友局不需要复杂离线排队。
   */
  private scheduleReconnect(): void {
    if (this.disposed || this.reconnectTimer !== null) {
      return
    }

    const delay = Math.min(5_000, 600 * 2 ** this.reconnectAttempt)
    this.reconnectAttempt += 1
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null
      this.connect()
    }, delay)
  }

  /**
   * 清理指定 socket 的回调和全局定时器。
   *
   * @param socket 待解绑的连接。
   */
  private detachSocket(socket: WebSocket | null): void {
    if (this.socket !== socket) {
      return
    }

    if (socket) {
      socket.onopen = null
      socket.onmessage = null
      socket.onclose = null
      socket.onerror = null
    }

    this.socket = null
    this.stopTimers()
  }

  /**
   * 清理心跳和重连计时器。
   */
  private stopTimers(): void {
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }

    if (this.heartbeatTimer !== null) {
      window.clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
  }

  /**
   * 更新连接状态并通知 UI。
   *
   * @param status 最新状态。
   */
  private setStatus(status: OnlineClientStatus): void {
    if (this.currentStatus === status) {
      return
    }

    this.currentStatus = status

    for (const listener of this.statusListeners) {
      listener(status)
    }
  }
}

/** 客户端连接状态。 */
export type OnlineClientStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting'

/**
 * 读取本地联机会话。
 *
 * @returns 会话或 null。
 */
export function readOnlineSession(): OnlineSessionSnapshot | null {
  try {
    const rawSession = localStorage.getItem(ONLINE_SESSION_STORAGE_KEY)

    if (!rawSession) {
      return null
    }

    const session = JSON.parse(rawSession) as OnlineSessionSnapshot

    return session.roomCode && session.playerToken
      ? session
      : null
  } catch {
    return null
  }
}

/**
 * 保存本地联机会话，断线或刷新后自动找回座位。
 *
 * @param session 需要保存的会话。
 */
export function saveOnlineSession(session: OnlineSessionSnapshot): void {
  localStorage.setItem(ONLINE_SESSION_STORAGE_KEY, JSON.stringify(session))
}

/**
 * 离开联机模式时清理本地会话。
 */
export function clearOnlineSession(): void {
  localStorage.removeItem(ONLINE_SESSION_STORAGE_KEY)
}

/** 客户端请求协议版本，避免新旧页面连同一服务后状态不兼容。 */
export const ONLINE_CLIENT_PROTOCOL_VERSION = ONLINE_PROTOCOL_VERSION

/** 开局选项协议占位，服务端当前不允许玩家自带手牌。 */
export type OnlineStartOptions = StartRoundOptions

/**
 * 按玩家看到的桌面方向重排座位。
 *
 * @param seat 服务端逻辑座位。
 * @param viewerSeat 当前玩家逻辑座位。
 * @returns 当前玩家永远映射到 UI 底部座位 0。
 */
function mapSeatForViewer(seat: SeatId, viewerSeat: SeatId): SeatId {
  return (((seat - viewerSeat + 4) % 4) as SeatId)
}

/**
 * 转换可为 null 的必填座位字段，null 语义保持不变。
 *
 * @param seat 原座位。
 * @param viewerSeat 当前玩家座位。
 * @returns 视角座位。
 */
function remapNullableSeat(
  seat: SeatId | null,
  viewerSeat: SeatId,
): SeatId | null {
  return seat === null ? null : mapSeatForViewer(seat, viewerSeat)
}

/**
 * 转换可选座位字段，undefined 语义保持不变。
 *
 * @param seat 原座位。
 * @param viewerSeat 当前玩家座位。
 * @returns 视角座位。
 */
function remapOptionalSeat(
  seat: SeatId | undefined,
  viewerSeat: SeatId,
): SeatId | undefined {
  return seat === undefined ? undefined : mapSeatForViewer(seat, viewerSeat)
}

/**
 * 把服务端 MatchState 转成当前玩家的牌桌视角。
 * 内部娱乐版仍会收到完整状态；这里同时保证 UI 底部永远是自己的座位。
 *
 * @param state 服务端原始状态。
 * @param viewerSeat 当前玩家逻辑座位。
 * @returns 当前视角的状态快照。
 */
export function createMatchStateForViewer(
  state: MatchState,
  viewerSeat: SeatId,
): MatchState {
  if (viewerSeat === 0) {
    return structuredClone(state)
  }

  const nextState = structuredClone(state)
  nextState.seatConfigs = nextState.seatConfigs
    .map((seatConfig) => ({
      ...seatConfig,
      seat: mapSeatForViewer(seatConfig.seat, viewerSeat),
    }))
    .sort((left, right) => left.seat - right.seat)
  nextState.lastRoundLastTrickWinner = remapNullableSeat(
    nextState.lastRoundLastTrickWinner,
    viewerSeat,
  )

  if (nextState.currentRound) {
    const round = nextState.currentRound
    round.seats = round.seats
      .map((seatState) => ({
        ...seatState,
        seat: mapSeatForViewer(seatState.seat, viewerSeat),
        config: {
          ...seatState.config,
          seat: mapSeatForViewer(seatState.config.seat, viewerSeat),
        },
      }))
      .sort((left, right) => left.seat - right.seat)
    round.currentSeat = remapNullableSeat(round.currentSeat, viewerSeat)
    round.firstLeader = mapSeatForViewer(round.firstLeader, viewerSeat)
    round.lastTrickWinner = remapOptionalSeat(round.lastTrickWinner, viewerSeat)
    round.ceremony = {
      ...round.ceremony,
      roller: mapSeatForViewer(round.ceremony.roller, viewerSeat),
      firstLeader: mapSeatForViewer(round.ceremony.firstLeader, viewerSeat),
      firstRoller: remapOptionalSeat(round.ceremony.firstRoller, viewerSeat),
      secondRoller: remapOptionalSeat(round.ceremony.secondRoller, viewerSeat),
    }
    round.pendingDice = round.pendingDice
      ? {
          ...round.pendingDice,
          seat: mapSeatForViewer(round.pendingDice.seat, viewerSeat),
        }
      : null

    if (round.currentTrick) {
      round.currentTrick = {
        ...round.currentTrick,
        leader: mapSeatForViewer(round.currentTrick.leader, viewerSeat),
        currentWinningSeat: mapSeatForViewer(round.currentTrick.currentWinningSeat, viewerSeat),
        responseSeat: remapNullableSeat(round.currentTrick.responseSeat, viewerSeat),
        rewardOwner: remapOptionalSeat(round.currentTrick.rewardOwner, viewerSeat),
        plays: round.currentTrick.plays.map((play) => ({
          ...play,
          seat: mapSeatForViewer(play.seat, viewerSeat),
        })),
      }
    }

    round.publicTrickLog = round.publicTrickLog.map((trick) => ({
      ...trick,
      leader: mapSeatForViewer(trick.leader, viewerSeat),
      winner: mapSeatForViewer(trick.winner, viewerSeat),
      visibleWinningSeat: mapSeatForViewer(trick.visibleWinningSeat, viewerSeat),
      forcedDoor: trick.forcedDoor,
      rewardOwner: remapOptionalSeat(trick.rewardOwner, viewerSeat),
      plays: trick.plays.map((play) => ({
        ...play,
        seat: mapSeatForViewer(play.seat, viewerSeat),
      })),
    }))

    if (round.rewardOutcome) {
      round.rewardOutcome = {
        ...round.rewardOutcome,
        owner: mapSeatForViewer(round.rewardOutcome.owner, viewerSeat),
        winner: mapSeatForViewer(round.rewardOutcome.winner, viewerSeat),
      }
    }

    if (round.settlement) {
      round.settlement = {
        ...round.settlement,
        collector: mapSeatForViewer(round.settlement.collector, viewerSeat),
        seats: round.settlement.seats.map((seatSettlement) => ({
          ...seatSettlement,
          seat: mapSeatForViewer(seatSettlement.seat, viewerSeat),
        })),
      }
    }
  }

  return nextState
}

/**
 * 将界面动作座位还原为服务端逻辑座位。
 *
 * @param seat 当前玩家看到的界面座位。
 * @param viewerSeat 当前玩家逻辑座位。
 * @returns 服务端座位。
 */
export function mapSeatFromViewer(seat: SeatId, viewerSeat: SeatId): SeatId {
  return (((seat + viewerSeat) % 4) as SeatId)
}
