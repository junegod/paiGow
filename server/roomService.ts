import { randomUUID } from 'node:crypto'

import { SeededRandom } from '@/rules-core/random'
import type {
  MatchState,
  SeatConfig,
  SeatId,
  TurnAction,
} from '@/rules-core/types'
import { jiAnDaSuoZiRuleSet } from '@/rules-variants/ji-an-da-suo-zi/ruleSet'
import { RULE_ENGINE_REVISION } from '@/rules-variants/ji-an-da-suo-zi/engine'
import { createBotDecisionContext } from '@/rules-variants/ji-an-da-suo-zi/botObservation'
import type {
  OnlineClientMessage,
  OnlineErrorCode,
  OnlinePlayer,
  OnlineRoomState,
  OnlineRoomSummary,
  OnlineSeatBroadcast,
  OnlineServerMessage,
} from '@/services/online/types'

/** WebSocket 兼容类型；这里只使用文本帧，避免依赖具体 ws 包类型。 */
export type RoomSocket = {
  readonly readyState: number
  send: (data: string) => void
  close: (code?: number, reason?: string) => void
}

/**
 * Node 16 没有 globalThis.structuredClone。
 * 服务端状态都是纯 JSON 数据，使用 JSON 深拷贝保证 CentOS 7 兼容。
 *
 * @param value 需要复制的状态。
 * @returns 与原状态断开引用的副本。
 */
function cloneJsonValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

/** 服务端保存的一个真实玩家连接。 */
interface RoomPlayer {
  token: string
  seat: SeatId
  name: string
  socket: RoomSocket
  online: boolean
}

/** 一个可重连的联机房间。 */
export interface OnlineRoom {
  roomCode: string
  createdAt: number
  hostSeat: SeatId
  players: Map<SeatId, RoomPlayer>
  match: MatchState
  rng: SeededRandom
  botDifficulty: 'standard'
  isPlaying: boolean
  botMoveTimer: NodeJS.Timeout | null
}

/** 客户端请求统一处理后的响应。 */
interface RoomRequestResult {
  room?: OnlineRoom
  player?: OnlinePlayer
  response?: OnlineServerMessage
  broadcastRoom?: boolean
  /** 按座位裁剪后的房间广播，由入口层分发给各在线接收者。 */
  seatBroadcast?: OnlineSeatBroadcast[]
}

/** 房间最大闲置时间；内部朋友局留 6 小时足够，避免服务进程缓慢累积房间。 */
const ROOM_IDLE_TTL_MS = 6 * 60 * 60 * 1000
/** 断线玩家保留座位的时长，足够覆盖锁屏、电梯和地铁短暂断网。 */
const DISCONNECT_RETENTION_MS = 3 * 60 * 1000
/** 服务端机器人行动间隔，客户端仍会播放自己的骰子和回合停留动画。 */
const BOT_MOVE_DELAY_MS = 700

/**
 * 生成不包含易混淆字符的六位房间码。
 *
 * @returns 例如 274935 这样的纯数字房间码，方便口头告诉朋友。
 */
function createRoomCode(): string {
  let code = ''

  for (let index = 0; index < 6; index += 1) {
    code += String(Math.floor(Math.random() * 10))
  }

  return code
}

/**
 * 修剪玩家名字并限制长度。
 *
 * @param value 前端提交的任意名字输入。
 * @returns 服务端统一保存的安全短名字。
 */
function sanitizePlayerName(value: unknown): string {
  if (typeof value !== 'string') {
    return '玩家'
  }

  const trimmedName = value.trim().slice(0, 12)
  return trimmedName || '玩家'
}

/**
 * 创建默认大厅座位。对局开始前主机可以只改机器人名字，真人座位在加入时自动改名。
 *
 * @returns 四个固定座位配置。
 */
function createDefaultSeatConfigs(): SeatConfig[] {
  return [
    { seat: 0, name: '等待玩家', mode: 'bot', color: '#38bdf8' },
    { seat: 1, name: '村里的阿明', mode: 'bot', color: '#fbbf24' },
    { seat: 2, name: '村里的老周', mode: 'bot', color: '#f472b6' },
    { seat: 3, name: '村里的细妹', mode: 'bot', color: '#4ade80' },
  ]
}

/**
 * 构造客户端渲染所需的房间公开状态。
 *
 * @param room 当前房间。
 * @returns 不包含 token 和 WebSocket 的状态快照。
 */
function createOnlineRoomState(room: OnlineRoom): OnlineRoomState {
  return {
    roomCode: room.roomCode,
    seatConfigs: cloneJsonValue(room.match.seatConfigs),
    onlineSeats: [...room.players.values()]
      .filter((player) => player.online)
      .map((player) => player.seat),
    isPlaying: room.isPlaying,
    hostSeat: room.hostSeat,
  }
}

/**
 * 生成"某个座位视角"的牌局状态。
 * 自己座位的手牌原样返回；其他座位只保留张数，具体牌实例全部剥离，
 * 确保任何客户端都无法从网络包里读到对手的手牌。
 *
 * @param room 当前房间。
 * @param viewerSeat 接收者的座位。
 * @returns 裁剪后的 MatchState 深拷贝。
 */
function createMatchStateForSeat(room: OnlineRoom, viewerSeat: SeatId): MatchState {
  const state = cloneJsonValue(room.match)

  if (!state.currentRound) {
    return state
  }

  for (const seatState of state.currentRound.seats) {
    if (seatState.seat !== viewerSeat) {
      (seatState as { hand: unknown }).hand = []
    }
  }

  return state
}

/**
 * 生成"某个座位视角"的完整房间消息（房间元信息 + 裁剪后的牌局状态）。
 *
 * @param room 当前房间。
 * @param viewerSeat 接收者的座位。
 * @returns room-state 消息。
 */
function createRoomStateMessageForSeat(room: OnlineRoom, viewerSeat: SeatId): OnlineServerMessage {
  return {
    type: 'room-state',
    room: createOnlineRoomState(room),
    state: createMatchStateForSeat(room, viewerSeat),
  }
}

/**
 * 生成大厅房间列表里的一行摘要。
 *
 * @param room 当前房间。
 * @returns 只包含公开信息的摘要，不携带任何令牌。
 */
function createOnlineRoomSummary(room: OnlineRoom): OnlineRoomSummary {
  return {
    roomCode: room.roomCode,
    hostName: room.players.get(room.hostSeat)?.name ?? '房主',
    onlineCount: [...room.players.values()].filter((player) => player.online).length,
    maxCount: 4,
    isPlaying: room.isPlaying,
    createdAt: room.createdAt,
  }
}

/**
 * 管理所有联机房间，并封装规则引擎、机器人调度和玩家重连。
 */
export class OnlineRoomService {
  private readonly rooms = new Map<string, OnlineRoom>()
  private maintenanceTimer: NodeJS.Timeout | null = null

  /**
   * 停止后台维护定时器。测试或进程关闭前调用，避免句柄悬挂。
   */
  public stop(): void {
    if (this.maintenanceTimer !== null) {
      clearInterval(this.maintenanceTimer)
      this.maintenanceTimer = null
    }

    for (const room of this.rooms.values()) {
      this.clearBotTimer(room)
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
    toRoom?: { roomCode: string; message: OnlineServerMessage }
    /** 按座位裁剪后的房间广播；sendList 携带每个接收者的专属消息。 */
    seatBroadcast?: OnlineSeatBroadcast[]
  } {
    let message: OnlineClientMessage

    try {
      message = JSON.parse(rawMessage) as OnlineClientMessage
    } catch {
      return {
        toSelf: this.createError('bad-message', '消息格式不正确，请刷新页面重试。'),
      }
    }

    const result = this.routeMessage(socket, message)
    this.ensureMaintenanceTimer()

    if (!result.response) {
      return {
        toSelf: this.createError('server-error', '服务器没有生成有效响应，请刷新页面重试。'),
      }
    }

    if (result.broadcastRoom && result.room && result.player) {
      return {
        toSelf: result.response,
        seatBroadcast: [...result.room.players.values()]
          .filter((receiver) => receiver.online)
          .map((receiver) => ({
            seat: receiver.seat,
            message: createRoomStateMessageForSeat(result.room!, receiver.seat),
          })),
      }
    }

    if (result.broadcastRoom && result.room) {
      return {
        toSelf: result.response,
        toRoom: {
          roomCode: result.room.roomCode,
          message: result.response,
        },
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
        this.broadcast(room, {
          type: 'player-disconnected',
          seat: player.seat,
          name: player.name,
        })
        this.broadcastRoomStatePerSeat(room)
        this.scheduleBotMoves(room)
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
        return this.configureBots(message.playerToken, message.botNames)
      case 'start-match':
        return this.startMatch(message.playerToken)
      case 'leave-room':
        return this.leaveRoom(message.playerToken)
      case 'submit-action':
        return this.submitAction(message.playerToken, message.action)
      case 'request-room':
        return this.findRoomByToken(message.playerToken, 'room')
      case 'request-state':
        return this.findRoomByToken(message.playerToken, 'state')
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
    let roomCode = createRoomCode()

    while (this.rooms.has(roomCode)) {
      roomCode = createRoomCode()
    }

    const seed = Math.floor(Math.random() * 0x100000000)
    const seatConfigs = createDefaultSeatConfigs()
    seatConfigs[0] = { ...seatConfigs[0], name: playerName, mode: 'bot' }
    const room: OnlineRoom = {
      roomCode,
      createdAt: Date.now(),
      hostSeat: 0,
      players: new Map(),
      match: jiAnDaSuoZiRuleSet.createMatch(seed, seatConfigs),
      rng: new SeededRandom(seed),
      botDifficulty: 'standard',
      isPlaying: false,
      botMoveTimer: null,
    }
    const player = this.addPlayer(room, socket, playerName)
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
    const room = this.rooms.get(roomCode)

    if (!room) {
      return { response: this.createError('room-not-found', '房间码不存在，请检查后再试。') }
    }

    const emptySeat = ([0, 1, 2, 3] as const)
      .find((seat) => !room.players.has(seat))

    if (emptySeat === undefined) {
      return { response: this.createError('room-full', '房间已经满员。') }
    }

    if (room.isPlaying) {
      return { response: this.createError('match-started', '牌局已经开局，不能中途加入。') }
    }

    const player = this.addPlayer(room, socket, playerName, emptySeat)
    this.updateLobbySeatName(room, emptySeat, playerName, 'human')

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
    const player = room?.players.get(this.findSeatByToken(room, playerToken))

    if (!room || !player || player.token !== playerToken) {
      return { response: this.createError('seat-token-invalid', '房间已结束，请重新创建或加入。') }
    }

    const wasOffline = !player.online
    player.socket = socket
    player.online = true

    if (wasOffline) {
      this.broadcast(room, {
        type: 'player-reconnected',
        seat: player.seat,
        name: player.name,
      })
      this.broadcastRoomStatePerSeat(room)
    }

    this.scheduleBotMoves(room)

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
  private configureBots(playerToken: string, botNames: string[]): RoomRequestResult {
    const room = this.getRoomByToken(playerToken)
    const host = room?.players.get(room.hostSeat)

    if (!room || !host || host.token !== playerToken) {
      return { response: this.createError('seat-token-invalid', '身份已失效，请重新加入房间。') }
    }

    if (room.isPlaying) {
      return { response: this.createError('match-started', '牌局已经开始，不能修改座位。') }
    }

    room.match.seatConfigs = room.match.seatConfigs.map((seatConfig) => {
      if (seatConfig.seat === 0 || seatConfig.mode !== 'bot') {
        return seatConfig
      }

      const botIndex = seatConfig.seat - 1
      return {
        ...seatConfig,
        name: sanitizePlayerName(botNames[botIndex]),
      }
    })

    return {
      room,
      player: host,
      response: {
        type: 'room-state',
        room: createOnlineRoomState(room),
        state: createMatchStateForSeat(room, host.seat),
      },
    }
  }

  /**
   * 主机开始牌局。四个座位都可以是真人，也可以保留机器人补位。
   *
   * @param playerToken 主机令牌。
   * @returns 广播开局状态的内部结果。
   */
  private startMatch(playerToken: string): RoomRequestResult {
    const room = this.getRoomByToken(playerToken)
    const host = room?.players.get(room.hostSeat)

    if (!room || !host || host.token !== playerToken) {
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
    this.scheduleBotMoves(room)

    return {
      room,
      player: host,
      response: {
        type: 'room-state',
        room: createOnlineRoomState(room),
        state: createMatchStateForSeat(room, host.seat),
      },
      broadcastRoom: true,
    }
  }

  /**
   * 校验并提交真人动作。规则引擎会负责回合、牌型和状态流转校验。
   *
   * @param playerToken 当前玩家令牌。
   * @param action 前端转发的动作。
   * @returns 广播最新状态的内部结果。
   */
  private submitAction(playerToken: string, action: TurnAction): RoomRequestResult {
    const room = this.getRoomByToken(playerToken)
    const player = room?.players.get(this.findSeatByToken(room, playerToken))

    if (!room || !player || player.token !== playerToken) {
      return { response: this.createError('seat-token-invalid', '身份已失效，请重新加入房间。') }
    }

    if (action.seat !== player.seat) {
      return { response: this.createError('invalid-action', '不能代替其他玩家操作。') }
    }

    try {
      const result = jiAnDaSuoZiRuleSet.submitAction(room.match, action, room.rng)
      room.match = result.match
      this.scheduleBotMoves(room)
    } catch {
      return { response: this.createError('invalid-action', '这个动作已经过期或不合法。') }
    }

    return {
      room,
      player,
      response: {
        type: 'match-state',
        state: createMatchStateForSeat(room, player.seat),
      },
      broadcastRoom: true,
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
    playerToken: string | undefined,
    responseKind: 'room' | 'state',
  ): RoomRequestResult {
    const room = this.getRoomByToken(playerToken)
    const player = room?.players.get(this.findSeatByToken(room, playerToken))

    if (!room || !player || player.token !== playerToken) {
      return { response: this.createError('seat-token-invalid', '身份已失效，请重新加入房间。') }
    }

    if (responseKind === 'state') {
      return {
        room,
        player,
        response: {
          type: 'match-state',
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
  private leaveRoom(playerToken: string): RoomRequestResult {
    const room = this.getRoomByToken(playerToken)
    const player = room?.players.get(this.findSeatByToken(room, playerToken))

    if (!room || !player || player.token !== playerToken) {
      return { response: this.createError('seat-token-invalid', '身份已失效，请重新加入房间。') }
    }

    const leftSeat = player.seat
    room.players.delete(leftSeat)
    room.match.seatConfigs = room.match.seatConfigs.map((seatConfig) =>
      seatConfig.seat === leftSeat
        ? { ...seatConfig, name: '村里的机器人', mode: 'bot' }
        : seatConfig,
    )

    const nextHost = [...room.players.values()]
      .filter((candidate) => candidate.online)
      .sort((left, right) => left.seat - right.seat)[0] ?? null
    room.hostSeat = nextHost?.seat ?? leftSeat

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
      this.scheduleBotMoves(room)
    } else {
      this.clearBotTimer(room)
    }

    return {
      room,
      player: nextHost ?? undefined,
      response: {
        type: 'room-state',
        room: createOnlineRoomState(room),
        // 离开导致房主迁移时可能没有任何真人在线，此时回退为房间默认视角。
        state: createMatchStateForSeat(room, nextHost?.seat ?? leftSeat),
      },
      broadcastRoom: Boolean(nextHost),
    }
  }

  /**
   * 向房间添加玩家并标记在线。
   *
   * @param room 目标房间。
   * @param socket 玩家连接。
   * @param playerName 玩家名字。
   * @param seat 可选固定座位。
   * @returns 新增玩家。
   */
  private addPlayer(
    room: OnlineRoom,
    socket: RoomSocket,
    playerName: string,
    seat?: SeatId,
  ): RoomPlayer {
    const targetSeat = seat ?? 0
    const player: RoomPlayer = {
      token: randomUUID(),
      seat: targetSeat,
      name: playerName,
      socket,
      online: true,
    }

    room.players.set(targetSeat, player)
    return player
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
   * 根据座位在大厅态更新名字和模式。
   *
   * @param room 当前房间。
   * @param seat 座位。
   * @param name 玩家名字。
   * @param mode 座位模式。
   */
  private updateLobbySeatName(
    room: OnlineRoom,
    seat: SeatId,
    name: string,
    mode: 'human' | 'bot',
  ): void {
    room.match.seatConfigs = room.match.seatConfigs.map((seatConfig) =>
      seatConfig.seat === seat
        ? { ...seatConfig, name, mode }
        : seatConfig,
    )
  }

  /**
   * 通过 token 反查座位。找不到时返回 0，由调用方再校验 token。
   *
   * @param room 目标房间。
   * @param playerToken 玩家令牌。
   * @returns 对应座位，找不到时为 0。
   */
  private findSeatByToken(room: OnlineRoom | undefined, playerToken: string | undefined): SeatId {
    if (!room || !playerToken) {
      return 0
    }

    for (const [seat, player] of room.players.entries()) {
      if (player.token === playerToken) {
        return seat
      }
    }

    return 0
  }

  /**
   * 只根据 token 查房间，具体座位校验交给调用方。
   *
   * @param playerToken 玩家令牌。
   * @returns 对应房间。
   */
  private getRoomByToken(playerToken: string | undefined): OnlineRoom | undefined {
    if (!playerToken) {
      return undefined
    }

    for (const room of this.rooms.values()) {
      const seat = this.findSeatByToken(room, playerToken)
      const player = room.players.get(seat)

      if (player?.token === playerToken) {
        return room
      }
    }

    return undefined
  }

  /**
   * 服务端机器人循环。每次只走一步，保证所有客户端都能看清过程。
   *
   * @param room 当前房间。
   */
  private scheduleBotMoves(room: OnlineRoom): void {
    this.clearBotTimer(room)

    if (!room.isPlaying || room.players.size === 0) {
      return
    }

    const delay = room.match.currentRound?.phase === 'awaiting-reveal'
      ? 2_000
      : BOT_MOVE_DELAY_MS

    room.botMoveTimer = setTimeout(() => {
      room.botMoveTimer = null
      this.advanceBotsOnce(room)
    }, delay)

    room.botMoveTimer.unref()
  }

  /**
   * 执行一次机器人动作或等待揭示，然后按最新状态继续调度。
   *
   * @param room 当前房间。
   */
  private advanceBotsOnce(room: OnlineRoom): void {
    const round = room.match.currentRound

    if (!round || room.match.phase === 'settled' || room.players.size === 0) {
      return
    }

    if (round.phase === 'awaiting-reveal') {
      room.match = jiAnDaSuoZiRuleSet.finishRoundAndReveal(room.match).match
      this.broadcastMatchState(room)
      this.scheduleBotMoves(room)
      return
    }

    const currentSeat = round.currentSeat
    const currentSeatState = currentSeat === null
      ? null
      : round.seats.find((seatState) => seatState.seat === currentSeat) ?? null

    if (currentSeat === null || !currentSeatState || currentSeatState.config.mode !== 'bot') {
      return
    }

    const legalActions = jiAnDaSuoZiRuleSet.listTurnActions(round, currentSeat)
    const botStrategy = jiAnDaSuoZiRuleSet.getBotStrategy()
    const botAction = botStrategy.chooseAction(
      createBotDecisionContext(round, currentSeat, legalActions),
    )
    room.match = jiAnDaSuoZiRuleSet.submitAction(room.match, botAction, room.rng).match
    this.broadcastMatchState(room)
    this.scheduleBotMoves(room)
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
        state: createMatchStateForSeat(room, player.seat),
      }))
    }
  }
  /**
   * 查找某个座位对应的活跃连接，供入口层发送座位专属广播。
   *
   * @param seat 目标座位。
   * @returns 该座位当前的 WebSocket；不在线时返回 null。
   */
  public findSocketBySeat(seat: SeatId): RoomSocket | null {
    for (const room of this.rooms.values()) {
      const player = room.players.get(seat)

      if (player && player.online && player.socket.readyState === 1) {
        return player.socket
      }
    }

    return null
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
   * 清理机器人定时器，重连或房间销毁前必须调用。
   *
   * @param room 当前房间。
   */
  private clearBotTimer(room: OnlineRoom): void {
    if (room.botMoveTimer !== null) {
      clearTimeout(room.botMoveTimer)
      room.botMoveTimer = null
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
      const hasOnlinePlayer = [...room.players.values()].some((player) => player.online)

      if (hasOnlinePlayer) {
        continue
      }

      if (now - room.createdAt > ROOM_IDLE_TTL_MS) {
        this.clearBotTimer(room)
        this.rooms.delete(roomCode)
        continue
      }

      const hasRecentPlayer = [...room.players.values()]
        .some(() => now - room.createdAt <= DISCONNECT_RETENTION_MS)

      if (!hasRecentPlayer) {
        this.clearBotTimer(room)
        this.rooms.delete(roomCode)
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
