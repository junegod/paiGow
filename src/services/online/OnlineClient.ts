import { ONLINE_PROTOCOL_VERSION } from '@/services/online/types'
import type {
  OnlineClientPayload,
  OnlineServerMessage,
} from '@/services/online/types'
import type { TurnAction } from '@/rules-core/types'
import type { OnlineSessionSnapshot } from '@/services/online/onlineSession'

/** 心跳间隔与响应期限兼顾移动网络抖动和断网后的及时恢复。 */
const HEARTBEAT_INTERVAL_MS = 25_000
const CONNECTION_TIMEOUT_MS = 10_000

/**
 * WebSocket 客户端封装，负责连接、心跳、自动重连和消息 JSON 编解码。
 */
export class OnlineClient {
  private readonly listeners = new Set<(message: OnlineServerMessage) => void>()
  private readonly statusListeners = new Set<(status: OnlineClientStatus) => void>()
  private socket: WebSocket | null = null
  private reconnectTimer: number | null = null
  private heartbeatTimer: number | null = null
  /** 建连或等待心跳响应的期限，超时后主动更换失活连接。 */
  private responseTimer: number | null = null
  private reconnectAttempt = 0
  private disposed = false
  private currentStatus: OnlineClientStatus = 'idle'
  private pendingMessages: OnlineClientPayload[] = []
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
    if (this.socket) {
      return
    }

    // 显式重新连接允许组件在 StrictMode 清理后再次挂载。
    this.disposed = false
    this.setStatus('connecting')
    const socket = new WebSocket(this.url)
    // 创建后立即占用当前连接槽，避免 React StrictMode 重跑 effect 时并发建立两条连接。
    this.socket = socket
    this.responseTimer = window.setTimeout(() => this.reconnect(), CONNECTION_TIMEOUT_MS)
    socket.onopen = () => {
      if (this.socket !== socket) {
        socket.close()
        return
      }

      this.clearResponseTimer()
      this.reconnectAttempt = 0
      this.setStatus('connected')
      this.flushPendingMessages()
      this.startHeartbeat()
    }
    socket.onmessage = (event) => {
      try {
        const message = JSON.parse(String(event.data)) as OnlineServerMessage
        if (message.type === 'pong') {
          this.clearResponseTimer()
        }

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
      if (!this.detachSocket(socket)) {
        return
      }

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
    this.pendingMessages = []
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
   * 发送协议消息。建连期间只保留可恢复的请求，不排队补发过期出牌或开局动作。
   *
   * @param message 客户端消息。
   */
  private send(message: OnlineClientPayload): void {
    if (this.disposed) {
      return
    }
    if (this.socket?.readyState !== WebSocket.OPEN) {
      // 动作依赖当前回合，重连后必须先同步再由玩家重新选择，不能补发旧牌。
      if (message.type === 'submit-action' || message.type === 'start-match' || message.type === 'configure-bots') {
        this.emit({ type: 'error', code: 'server-error', message: '连接正在恢复，请同步牌局后重试。' })
        return
      }
      if (message.type !== 'ping') {
        // 合并重复查询，防止长时间断网时大厅轮询无限积压。
        this.pendingMessages = this.pendingMessages.filter((pending) => pending.type !== message.type)
        this.pendingMessages.push(message)
      }
      this.connect()
      return
    }

    this.socket.send(JSON.stringify({
      ...message,
      protocolVersion: ONLINE_PROTOCOL_VERSION,
    }))
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
    this.probeConnection()
    this.heartbeatTimer = window.setInterval(() => this.probeConnection(), HEARTBEAT_INTERVAL_MS)
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
  private detachSocket(socket: WebSocket | null): boolean {
    if (this.socket !== socket) {
      return false
    }

    if (socket) {
      socket.onopen = null
      socket.onmessage = null
      socket.onclose = null
      socket.onerror = null
    }

    this.socket = null
    this.stopTimers()
    return true
  }

  /**
   * 清理心跳和重连计时器。
   */
  private stopTimers(): void {
    this.clearResponseTimer()
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

  /**
   * 主动丢弃失活连接并重连；切回前台时也使用此入口，恢复后重新验证座位。
   * 先解绑旧连接再关闭，避免迟到的 close 事件误清理新连接。
   */
  public reconnect(): void {
    if (this.disposed) {
      return
    }
    const previousSocket = this.socket
    this.detachSocket(previousSocket)
    previousSocket?.close()
    this.setStatus('reconnecting')
    this.scheduleReconnect()
  }

  /** 清理建连或心跳超时计时器，避免旧响应期限影响后续连接。 */
  private clearResponseTimer(): void {
    if (this.responseTimer !== null) {
      window.clearTimeout(this.responseTimer)
      this.responseTimer = null
    }
  }

  /** 检测双向链路；只有收到 pong 才取消超时，socket 的 OPEN 状态并不代表网络可用。 */
  private probeConnection(): void {
    if (this.socket?.readyState !== WebSocket.OPEN || this.responseTimer !== null) {
      return
    }
    this.responseTimer = window.setTimeout(() => this.reconnect(), CONNECTION_TIMEOUT_MS)
    this.send({ type: 'ping' })
  }

}

/** 客户端连接状态。 */
export type OnlineClientStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting'
