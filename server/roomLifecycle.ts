import { randomUUID } from 'node:crypto'

import type { SeatId } from '@/rules-core/types'

import { DISCONNECT_RETENTION_MS } from './roomModels'
import type { OnlineRoom, RoomPlayer, RoomSocket } from './roomModels'

/** 更新房间活跃时间并递增状态版本。 */
export function touchRoom(room: OnlineRoom): void {
  room.lastActivityAt = Date.now()
  room.revision += 1
}

/** 向房间添加真人玩家并标记在线。 */
export function addPlayer(
  room: OnlineRoom,
  socket: RoomSocket,
  playerName: string,
  seat: SeatId = 0,
): RoomPlayer {
  const player: RoomPlayer = {
    token: randomUUID(),
    seat,
    name: playerName,
    socket,
    online: true,
    disconnectedAt: null,
  }
  room.players.set(seat, player)
  return player
}

/** 更新大厅座位名称和真人/机器人模式。 */
export function updateLobbySeatName(
  room: OnlineRoom,
  seat: SeatId,
  name: string,
  mode: 'human' | 'bot',
): void {
  room.match.seatConfigs = room.match.seatConfigs.map((seatConfig) =>
    seatConfig.seat === seat ? { ...seatConfig, name, mode } : seatConfig,
  )
}

/** 选择座位号最小的在线真人作为新房主。 */
export function selectNextHost(room: OnlineRoom): RoomPlayer | null {
  return [...room.players.values()]
    .filter((candidate) => candidate.online)
    .sort((left, right) => left.seat - right.seat)[0] ?? null
}

/** 通过 token 反查房间内座位，找不到时返回零并由调用方继续校验 token。 */
export function findSeatByToken(room: OnlineRoom | undefined, playerToken: string | undefined): SeatId {
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

/** 通过玩家 token 查找所属房间。 */
export function getRoomByPlayerToken(
  rooms: Iterable<OnlineRoom>,
  playerToken: string | undefined,
): OnlineRoom | undefined {
  if (!playerToken) {
    return undefined
  }
  for (const room of rooms) {
    const player = room.players.get(findSeatByToken(room, playerToken))
    if (player?.token === playerToken) {
      return room
    }
  }
  return undefined
}

/** 查找某条连接当前绑定的房间玩家。 */
export function findPlayerBySocket(
  rooms: Iterable<OnlineRoom>,
  socket: RoomSocket,
): { room: OnlineRoom; player: RoomPlayer } | null {
  for (const room of rooms) {
    for (const player of room.players.values()) {
      if (player.socket === socket) {
        return { room, player }
      }
    }
  }
  return null
}

/**
 * 清理断线超过三分钟的玩家，并把座位永久转成机器人。
 *
 * @returns 是否发生了清理。
 */
export function expireDisconnectedPlayers(room: OnlineRoom, now: number): boolean {
  const expiredPlayers = [...room.players.values()].filter((player) =>
    !player.online &&
    player.disconnectedAt !== null &&
    now - player.disconnectedAt >= DISCONNECT_RETENTION_MS,
  )
  if (expiredPlayers.length === 0) {
    return false
  }

  const expiredSeats = new Set(expiredPlayers.map((player) => player.seat))
  for (const player of expiredPlayers) {
    room.players.delete(player.seat)
  }
  room.match.seatConfigs = room.match.seatConfigs.map((seatConfig) =>
    expiredSeats.has(seatConfig.seat)
      ? { ...seatConfig, name: '村里的机器人', mode: 'bot' }
      : seatConfig,
  )
  if (!room.players.has(room.hostSeat) || !room.players.get(room.hostSeat)?.online) {
    room.hostSeat = selectNextHost(room)?.seat ?? room.hostSeat
  }
  touchRoom(room)
  return true
}
