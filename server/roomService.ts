import { SeededRandom } from '@/rules-core/random'
import type { TurnAction } from '@/rules-core/types'
import { jiAnDaSuoZiRuleSet } from '@/rules-variants/ji-an-da-suo-zi/ruleSet'
import { RULE_ENGINE_REVISION } from '@/rules-variants/ji-an-da-suo-zi/engine'
import type {
  OnlineClientMessage,
  OnlineErrorCode,
  OnlinePlayer,
  OnlineServerMessage,
} from '@/services/online/types'
import { parseOnlineClientMessage } from './onlineProtocol'
import { RoomBotScheduler } from './roomBotScheduler'
import {
  addPlayer,
  expireDisconnectedPlayers,
  findPlayerBySocket,
  findSeatByToken,
  getRoomByPlayerToken,
  selectNextHost,
  touchRoom,
  updateLobbySeatName,
} from './roomLifecycle'
import {
  createDefaultSeatConfigs,
  createMatchStateForSeat,
  createMatchStateMessageForSeat,
  createOnlineRoomState,
  createOnlineRoomSummary,
  createRoomCode,
  createRoomStateMessageForSeat,
  ROOM_IDLE_TTL_MS,
  sanitizePlayerName,
} from './roomModels'
import type { OnlineRoom, RoomPlayer, RoomSocket } from './roomModels'

export type { RoomSocket } from './roomModels'

/** 客户端请求统一处理后的响应。 */
interface RoomRequestResult {
  room?: OnlineRoom
  player?: OnlinePlayer
  response?: OnlineServerMessage
  broadcastRoom?: boolean
  /** 广播时使用完整房间快照，否则只广播牌局状态。 */
  broadcastKind?: 'room' | 'match'
}

/**
 * 管理所有联机房间，并封装规则引擎、机器人调度和玩家重连。
 */
export class OnlineRoomService {
  private readonly rooms = new Map<string, OnlineRoom>()
  private maintenanceTimer: NodeJS.Timeout | null = null
  private readonly botScheduler = new RoomBotScheduler((room) => {
    touchRoom(room)
    this.broadcastMatchState(room)
  })

  /**
   * 停止后台维护定时器。测试或进程关闭前调用，避免句柄悬挂。
   */
  public stop(): void {
    if (this.maintenanceTimer !== null) {
      clearInterval(this.maintenanceTimer)
      this.maintenanceTimer = null
    }

    for (const room of this.rooms.values()) {
      this.botScheduler.clear(room)
    }
  }

  /**
   * 处理任意客户端消息，不感知具体 WebSocket 实现。
   *
   * @param socket 当前 WebSocket 连接。
   * @param rawMessage 浏览器发来的 JSON 文本。
   * @returns 服务端要回给当前连接或广播给房间的消息。
   */
  public handleMessage(
    socket: RoomSocket,
    rawMessage: string,
  ): {
    toSelf: OnlineServerMessage
    /** 已经绑定到具体房间连接的专属消息，入口层只负责逐条发送。 */
    toPlayers?: Array<{ socket: RoomSocket; message: OnlineServerMessage }>
  } {
    const parsedResult = parseOnlineClientMessage(rawMessage)
    if (!parsedResult.message) {
      return {
        toSelf: this.createError(parsedResult.errorCode, parsedResult.errorMessage),
      }
    }

    const result = this.routeMessage(socket, parsedResult.message)
    this.ensureMaintenanceTimer()

    if (!result.response) {
      return {
        toSelf: this.createError('server-error', '服务器没有生成有效响应，请刷新页面重试。'),
      }
    }

    if (result.broadcastRoom && result.room) {
      return {
        toSelf: result.response,
        toPlayers: [...result.room.players.values()]
          .filter((receiver) => receiver.online && receiver.socket !== socket)
          .map((receiver) => ({
            socket: receiver.socket,
            message: result.broadcastKind === 'match'
              ? createMatchStateMessageForSeat(result.room!, receiver.seat)
              : createRoomStateMessageForSeat(result.room!, receiver.seat),
          })),
      }
    }

    return { toSelf: result.response }
  }

  /**
   * 返回当前所有等待开局的房间摘要，按创建时间从新到旧排列。
   * 已经开局或没有真人在线的房间不在大厅展示。
   *
   * @returns 大厅房间列表消息。
   */
  public listWaitingRooms(): OnlineServerMessage {
    const summaries = [...this.rooms.values()]
      .filter((room) => !room.isPlaying && [...room.players.values()].some((player) => player.online))
      .map(createOnlineRoomSummary)
      .sort((left, right) => right.createdAt - left.createdAt)

    return {
      type: 'room-list',
      rooms: summaries,
    }
  }

  /**
   * 处理连接关闭，保留座位和房间，供自动重连。
   *
   * @param socket 断开的连接。
   */
  public handleDisconnect(socket: RoomSocket): void {
    for (const room of this.rooms.values()) {
      for (const player of room.players.values()) {
        if (player.socket !== socket) {
          continue
        }

        player.online = false
        player.disconnectedAt = Date.now()
        const previousHostSeat = room.hostSeat
        const nextHost = player.seat === room.hostSeat ? selectNextHost(room) : null

        if (nextHost) {
          room.hostSeat = nextHost.seat
        }

        touchRoom(room)
        this.broadcast(room, {
          type: 'player-disconnected',
          seat: player.seat,
          name: player.name,
        })

        if (nextHost && previousHostSeat !== nextHost.seat) {
          this.broadcast(room, {
            type: 'host-changed',
            seat: nextHost.seat,
            name: nextHost.name,
          })
        }

        this.broadcastRoomStatePerSeat(room)
        this.botScheduler.schedule(room)
      }
    }
  }

  /**
   * 按消息类型分发。保持薄路由，具体规则放在独立私有方法里。
   *
   * @param socket 当前 WebSocket 连接。
   * @param message 已解析的客户端消息。
   * @returns 内部处理结果。
   */
  private routeMessage(
    socket: RoomSocket,
    message: OnlineClientMessage,
  ): RoomRequestResult {
    switch (message.type) {
      case 'create-room':
        return this.createRoom(socket, sanitizePlayerName(message.playerName))
      case 'join-room':
        return this.joinRoom(socket, message.roomCode, sanitizePlayerName(message.playerName))
      case 'list-rooms':
        return {
          room: undefined,
          response: this.listWaitingRooms(),
        }
      case 'resume-room':
        return this.resumeRoom(socket, message.roomCode, message.playerToken)
      case 'configure-bots':
        return this.configureBots(socket, message.playerToken, message.botNames)
      case 'start-match':
        return this.startMatch(socket, message.playerToken)
      case 'leave-room':
        return this.leaveRoom(socket, message.playerToken)
      case 'submit-action':
        return this.submitAction(socket, message.playerToken, message.action)
      case 'request-room':
        return this.findRoomByToken(socket, message.playerToken, 'room')
      case 'request-state':
        return this.findRoomByToken(socket, message.playerToken, 'state')
      case 'ping':
        return { response: { type: 'pong' } }
      default:
        return {
          response: this.createError('bad-message', '暂不支持的消息类型。'),
        }
    }
  }

  /**
   * 创建房间并把创建者安排到底部座位。
   *
   * @param socket 创建者连接。
   * @param playerName 创建者名字。
   * @returns 创建成功响应。
   */
  private createRoom(socket: RoomSocket, playerName: string): RoomRequestResult {
    if (findPlayerBySocket(this.rooms.values(), socket)) {
      return { response: this.createError('already-in-room', '你已经在一个房间中，请先离开当前房间。') }
    }

    let roomCode = createRoomCode()

    while (this.rooms.has(roomCode)) {
      roomCode = createRoomCode()
    }

    const seed = Math.floor(Math.random() * 0x100000000)
    const now = Date.now()
    const seatConfigs = createDefaultSeatConfigs()
    seatConfigs[0] = { ...seatConfigs[0], name: playerName, mode: 'human' }
    const room: OnlineRoom = {
      roomCode,
      createdAt: now,
      lastActivityAt: now,
      hostSeat: 0,
      players: new Map(),
      match: jiAnDaSuoZiRuleSet.createMatch(seed, seatConfigs),
      rng: new SeededRandom(seed),
      botDifficulty: 'standard',
      isPlaying: false,
      botMoveTimer: null,
      revision: 0,
    }
    const player = addPlayer(room, socket, playerName)
    this.rooms.set(roomCode, room)

    return {
      room,
      player,
      response: {
        type: 'room-created',
        roomCode,
        player: this.toPublicPlayer(player),
        room: createOnlineRoomState(room),
        state: createMatchStateForSeat(room, player.seat),
      },
    }
  }

  /**
   * 加入已有房间。第一版自动分配第一个空座位，不做选座。
   *
   * @param socket 加入者连接。
   * @param roomCode 用户输入的房间码。
   * @param playerName 加入者名字。
   * @returns 加入成功或失败响应。
   */
  private joinRoom(
    socket: RoomSocket,
    roomCode: string,
    playerName: string,
  ): RoomRequestResult {
    if (findPlayerBySocket(this.rooms.values(), socket)) {
      return { response: this.createError('already-in-room', '你已经在一个房间中，请先离开当前房间。') }
    }

    const room = this.rooms.get(roomCode)

    if (!room) {
      return { response: this.createError('room-not-found', '房间码不存在，请检查后再试。') }
    }

    expireDisconnectedPlayers(room, Date.now())

    const emptySeat = ([0, 1, 2, 3] as const)
      .find((seat) => !room.players.has(seat))

    if (emptySeat === undefined) {
      return { response: this.createError('room-full', '房间已经满员。') }
    }

    if (room.isPlaying) {
      return { response: this.createError('match-started', '牌局已经开局，不能中途加入。') }
    }

    const player = addPlayer(room, socket, playerName, emptySeat)
    updateLobbySeatName(room, emptySeat, playerName, 'human')
    touchRoom(room)

    return {
      room,
      player,
      response: {
        type: 'room-joined',
        roomCode: room.roomCode,
        player: this.toPublicPlayer(player),
        room: createOnlineRoomState(room),
        state: createMatchStateForSeat(room, player.seat),
      },
      broadcastRoom: true,
      broadcastKind: 'room',
    }
  }

  /**
   * 使用房间码和 token 恢复座位。token 保存在各端浏览器 localStorage。
   *
   * @param socket 新建立的连接。
   * @param roomCode 保存的房间码。
   * @param playerToken 保存的座位令牌。
   * @returns 恢复成功或失败响应。
   */
  private resumeRoom(
    socket: RoomSocket,
    roomCode: string,
    playerToken: string,
  ): RoomRequestResult {
    const room = this.rooms.get(roomCode)
    const player = room?.players.get(findSeatByToken(room, playerToken))

    if (!room || !player || player.token !== playerToken) {
      return { response: this.createError('seat-token-invalid', '房间已结束，请重新创建或加入。') }
    }

    const wasOffline = !player.online

    if (player.socket !== socket && player.socket.readyState === 1) {
      player.socket.close(4001, '账号已在新的连接恢复')
    }

    player.socket = socket
    player.online = true
    player.disconnectedAt = null
    touchRoom(room)

    if (wasOffline) {
      this.broadcast(room, {
        type: 'player-reconnected',
        seat: player.seat,
        name: player.name,
      })
      this.broadcastRoomStatePerSeat(room)
    }

    this.botScheduler.schedule(room)

    return {
      room,
      player,
      response: {
        type: 'room-resumed',
        roomCode: room.roomCode,
        player: this.toPublicPlayer(player),
        room: createOnlineRoomState(room),
        state: createMatchStateForSeat(room, player.seat),
      },
    }
  }

  /**
   * 主机在大厅修改三个机器人名字。
   *
   * @param playerToken 主机令牌。
   * @param botNames 三个机器人名字。
   * @returns 广播房间状态的内部结果。
   */
  private configureBots(
    socket: RoomSocket,
    playerToken: string,
    botNames: string[],
  ): RoomRequestResult {
    const room = getRoomByPlayerToken(this.rooms.values(), playerToken)
    const host = room?.players.get(room.hostSeat)

    if (!room || !host || host.token !== playerToken || host.socket !== socket || !host.online) {
      return { response: this.createError('seat-token-invalid', '身份已失效，请重新加入房间。') }
    }

    if (room.isPlaying) {
      return { response: this.createError('match-started', '牌局已经开始，不能修改座位。') }
    }

    const safeBotNames = Array.isArray(botNames) ? botNames : []
    const botSeats = room.match.seatConfigs
      .filter((candidate) => !room.players.has(candidate.seat))
      .map((candidate) => candidate.seat)

    room.match.seatConfigs = room.match.seatConfigs.map((seatConfig) => {
      if (room.players.has(seatConfig.seat)) {
        return seatConfig
      }

      const botIndex = botSeats.indexOf(seatConfig.seat)
      return {
        ...seatConfig,
        name: sanitizePlayerName(safeBotNames[botIndex]),
        mode: 'bot',
      }
    })
    touchRoom(room)

    return {
      room,
      player: host,
      response: {
        type: 'room-state',
        room: createOnlineRoomState(room),
        state: createMatchStateForSeat(room, host.seat),
      },
      broadcastRoom: true,
      broadcastKind: 'room',
    }
  }

  /**
   * 主机开始牌局。四个座位都可以是真人，也可以保留机器人补位。
   *
   * @param playerToken 主机令牌。
   * @returns 广播开局状态的内部结果。
   */
  private startMatch(socket: RoomSocket, playerToken: string): RoomRequestResult {
    const room = getRoomByPlayerToken(this.rooms.values(), playerToken)
    const host = room?.players.get(room.hostSeat)

    if (!room || !host || host.token !== playerToken) {
      return { response: this.createError('not-host', '只有当前房主可以开始牌局。') }
    }

    if (host.socket !== socket || !host.online) {
      return { response: this.createError('seat-token-invalid', '身份已失效，请重新加入房间。') }
    }

    if (room.isPlaying && room.match.phase !== 'settled') {
      return { response: this.createError('match-started', '当前牌局还在进行中。') }
    }

    if (!host.online) {
      return { response: this.createError('not-host', '房主已断线，等重连后再开始。') }
    }

    room.match.seatConfigs = room.match.seatConfigs.map((seatConfig) => ({
      ...seatConfig,
      mode: room.players.has(seatConfig.seat) ? 'human' : 'bot',
    }))
    room.isPlaying = true
    room.rng = new SeededRandom(Math.floor(Math.random() * 0x100000000))
    const startResult = jiAnDaSuoZiRuleSet.startRound(room.match, room.rng)
    room.match = startResult.match
    touchRoom(room)
    this.botScheduler.schedule(room)

    return {
      room,
      player: host,
      response: {
        type: 'room-state',
        room: createOnlineRoomState(room),
        state: createMatchStateForSeat(room, host.seat),
      },
      broadcastRoom: true,
      broadcastKind: 'room',
    }
  }

  /**
   * 校验并提交真人动作。规则引擎会负责回合、牌型和状态流转校验。
   *
   * @param playerToken 当前玩家令牌。
   * @param action 前端转发的动作。
   * @returns 广播最新状态的内部结果。
   */
  private submitAction(
    socket: RoomSocket,
    playerToken: string,
    action: TurnAction,
  ): RoomRequestResult {
    const room = getRoomByPlayerToken(this.rooms.values(), playerToken)
    const player = room?.players.get(findSeatByToken(room, playerToken))

    if (
      !room ||
      !player ||
      player.token !== playerToken ||
      player.socket !== socket ||
      !player.online
    ) {
      return { response: this.createError('seat-token-invalid', '身份已失效，请重新加入房间。') }
    }

    if (!action || typeof action !== 'object' || action.seat !== player.seat) {
      return { response: this.createError('invalid-action', '不能代替其他玩家操作。') }
    }

    try {
      const result = jiAnDaSuoZiRuleSet.submitAction(room.match, action, room.rng)
      room.match = result.match
      touchRoom(room)
      this.botScheduler.schedule(room)
    } catch {
      return { response: this.createError('invalid-action', '这个动作已经过期或不合法。') }
    }

    return {
      room,
      player,
      response: {
        type: 'match-state',
        roomCode: room.roomCode,
        revision: room.revision,
        state: createMatchStateForSeat(room, player.seat),
      },
      broadcastRoom: true,
      broadcastKind: 'match',
    }
  }

  /**
   * 根据 token 查找回房间或拉取最新状态。
   *
   * @param playerToken 可选玩家令牌。
   * @param responseKind room 表示完整房间状态，state 表示只刷新牌局。
   * @returns 查询响应。
   */
  private findRoomByToken(
    socket: RoomSocket,
    playerToken: string | undefined,
    responseKind: 'room' | 'state',
  ): RoomRequestResult {
    const room = getRoomByPlayerToken(this.rooms.values(), playerToken)
    const player = room?.players.get(findSeatByToken(room, playerToken))

    if (
      !room ||
      !player ||
      player.token !== playerToken ||
      player.socket !== socket ||
      !player.online
    ) {
      return { response: this.createError('seat-token-invalid', '身份已失效，请重新加入房间。') }
    }

    if (responseKind === 'state') {
      return {
        room,
        player,
        response: {
          type: 'match-state',
          roomCode: room.roomCode,
          revision: room.revision,
          state: createMatchStateForSeat(room, player.seat),
        },
      }
    }

    return {
      room,
      player,
      response: {
        type: 'room-state',
        room: createOnlineRoomState(room),
        state: createMatchStateForSeat(room, player.seat),
      },
    }
  }

  /**
   * 玩家主动离开房间。
   * 座位立即改为机器人接管；若离开的是房主，房主身份迁移给座位号最小的剩余真人。
   *
   * @param playerToken 离开玩家令牌。
   * @returns 成功响应和需要广播的房间状态。
   */
  private leaveRoom(socket: RoomSocket, playerToken: string): RoomRequestResult {
    const room = getRoomByPlayerToken(this.rooms.values(), playerToken)
    const player = room?.players.get(findSeatByToken(room, playerToken))

    if (
      !room ||
      !player ||
      player.token !== playerToken ||
      player.socket !== socket
    ) {
      return { response: this.createError('seat-token-invalid', '身份已失效，请重新加入房间。') }
    }

    const leftSeat = player.seat
    room.players.delete(leftSeat)
    room.match.seatConfigs = room.match.seatConfigs.map((seatConfig) =>
      seatConfig.seat === leftSeat
        ? { ...seatConfig, name: '村里的机器人', mode: 'bot' }
        : seatConfig,
    )

    const nextHost = selectNextHost(room)
    room.hostSeat = nextHost?.seat ?? leftSeat
    touchRoom(room)

    if (nextHost) {
      this.broadcast(room, {
        type: 'host-changed',
        seat: nextHost.seat,
        name: nextHost.name,
      })
    }

    // 所有真人都主动离开后销毁房间，避免无效牌局占用服务端内存。
    if (!nextHost) {
      this.rooms.delete(room.roomCode)
    }

    if (nextHost) {
      this.botScheduler.schedule(room)
    } else {
      this.botScheduler.clear(room)
    }

    return {
      room,
      player: nextHost ?? undefined,
      response: {
        type: 'room-left',
      },
      broadcastRoom: Boolean(nextHost),
      broadcastKind: 'room',
    }
  }

  /**
   * 创建玩家对外快照，绝不把 token 广播给其他人。
   *
   * @param player 玩家内部对象。
   * @returns 只带座位和名字的对象。
   */
  private toPublicPlayer(player: RoomPlayer): OnlinePlayer {
    return {
      token: player.token,
      seat: player.seat,
      name: player.name,
    }
  }

  /**
   * 广播最新牌局状态给房间内仍在线的玩家。
   * 每个接收者只会拿到自己座位的手牌，其他座位手牌一律剥离。
   *
   * @param room 当前房间。
   */
  private broadcastMatchState(room: OnlineRoom): void {
    for (const player of room.players.values()) {
      if (!player.online || player.socket.readyState !== 1) {
        continue
      }

      player.socket.send(JSON.stringify({
        type: 'match-state',
        roomCode: room.roomCode,
        revision: room.revision,
        state: createMatchStateForSeat(room, player.seat),
      }))
    }
  }
  /**
   * 向所有在线玩家发送同一份与视角无关的消息（如断线通知）。
   */
  private broadcast(room: OnlineRoom, message: OnlineServerMessage): void {
    const encodedMessage = JSON.stringify(message)

    for (const player of room.players.values()) {
      if (player.online && player.socket.readyState === 1) {
        player.socket.send(encodedMessage)
      }
    }
  }

  /**
   * 向房间内所有在线玩家发送"各自视角"的 room-state。
   * 每个接收者只携带自己座位的手牌，其他座位手牌被剥离。
   *
   * @param room 当前房间。
   */
  private broadcastRoomStatePerSeat(room: OnlineRoom): void {
    for (const player of room.players.values()) {
      if (!player.online || player.socket.readyState !== 1) {
        continue
      }

      player.socket.send(JSON.stringify(createRoomStateMessageForSeat(room, player.seat)))
    }
  }

  /**
   * 确保房间过期维护循环已经启动。
   */
  private ensureMaintenanceTimer(): void {
    if (this.maintenanceTimer !== null) {
      return
    }

    this.maintenanceTimer = setInterval(() => {
      this.removeExpiredRooms()
    }, 60_000)
    this.maintenanceTimer.unref()
  }

  /**
   * 清理闲置房间。断线超过保留时长后才删除，保证短暂掉线仍能回来。
   */
  private removeExpiredRooms(): void {
    const now = Date.now()

    for (const [roomCode, room] of this.rooms.entries()) {
      const removedDisconnectedPlayer = expireDisconnectedPlayers(room, now)
      const hasOnlinePlayer = [...room.players.values()].some((player) => player.online)

      if (
        room.players.size === 0 ||
        (!hasOnlinePlayer && now - room.lastActivityAt > ROOM_IDLE_TTL_MS)
      ) {
        this.botScheduler.clear(room)
        this.rooms.delete(roomCode)
        continue
      }

      if (removedDisconnectedPlayer) {
        this.botScheduler.schedule(room)
        this.broadcastRoomStatePerSeat(room)
      }
    }
  }

  /**
   * 统一构造错误响应。
   *
   * @param code 错误码。
   * @param message 中文玩家提示。
   * @returns 错误消息。
   */
  private createError(code: OnlineErrorCode, message: string): OnlineServerMessage {
    return { type: 'error', code, message }
  }
}

/** 导出规则版本，服务器启动日志和后续健康检查可一起使用。 */
export const ONLINE_RULE_ENGINE_REVISION = RULE_ENGINE_REVISION
