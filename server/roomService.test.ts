import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { TurnAction } from '@/rules-core/types'
import { jiAnDaSuoZiRuleSet } from '@/rules-variants/ji-an-da-suo-zi/ruleSet'
import { ONLINE_PROTOCOL_VERSION } from '@/services/online/types'
import type { OnlineClientPayload, OnlineServerMessage } from '@/services/online/types'

import { OnlineRoomService, type RoomSocket } from './roomService'

/** 测试用假连接，只记录服务端实际发送过的消息。 */
function createFakeSocket(): RoomSocket & { messages: OnlineServerMessage[] } {
  const messages: OnlineServerMessage[] = []

  return {
    readyState: 1,
    messages,
    send(data: string) {
      messages.push(JSON.parse(data) as OnlineServerMessage)
    },
    close() {},
  }
}

/** 通过正式协议调用房间服务，并模拟入口层发送专属投递列表。 */
function request(
  service: OnlineRoomService,
  socket: RoomSocket & { messages: OnlineServerMessage[] },
  payload: OnlineClientPayload,
) {
  const result = service.handleMessage(socket, JSON.stringify({
    ...payload,
    protocolVersion: ONLINE_PROTOCOL_VERSION,
  }))
  socket.messages.push(result.toSelf)

  for (const delivery of result.toPlayers ?? []) {
    delivery.socket.send(JSON.stringify(delivery.message))
  }

  return result
}

/** 从假连接中读取最后一条指定类型消息。 */
function findLatestMessage<T extends OnlineServerMessage['type']>(
  socket: { messages: OnlineServerMessage[] },
  type: T,
): Extract<OnlineServerMessage, { type: T }> {
  const message = [...socket.messages].reverse().find((item) => item.type === type)

  if (!message) {
    throw new Error(`没有找到消息 ${type}。`)
  }

  return message as Extract<OnlineServerMessage, { type: T }>
}

describe('OnlineRoomService', () => {
  let service: OnlineRoomService

  beforeEach(() => {
    service = new OnlineRoomService()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    service.stop()
  })

  it('拒绝没有携带当前协议版本的旧客户端', () => {
    const socket = createFakeSocket()
    const result = service.handleMessage(socket, JSON.stringify({
      type: 'create-room',
      playerName: '旧页面',
    }))

    expect(result.toSelf).toMatchObject({ type: 'error', code: 'protocol-mismatch' })
  })

  it('创建房间后房主是真人，并由服务端机器人继续推进', async () => {
    vi.useFakeTimers()
    const socket = createFakeSocket()
    const created = request(service, socket, { type: 'create-room', playerName: '房主' }).toSelf

    expect(created.type).toBe('room-created')
    if (created.type !== 'room-created') {
      return
    }

    expect(created.room.seatConfigs[0].mode).toBe('human')
    const started = request(service, socket, {
      type: 'start-match',
      playerToken: created.player.token,
    }).toSelf

    expect(started.type).toBe('room-state')
    if (started.type !== 'room-state' || !started.state.currentRound) {
      return
    }

    const firstSeat = started.state.currentRound.currentSeat
    if (firstSeat === 0) {
      const preparedAction = jiAnDaSuoZiRuleSet.listTurnActions(started.state.currentRound, 0)[0]
      const action: TurnAction = {
        seat: 0,
        intent: preparedAction.intent,
        selectedCardIds: preparedAction.selectedCardIds,
      }
      request(service, socket, {
        type: 'submit-action',
        playerToken: created.player.token,
        action,
      })
    }

    await vi.advanceTimersByTimeAsync(1_500)
    expect(socket.messages.some((message) => message.type === 'match-state')).toBe(true)
  })

  it('两个房间同时开局时只向目标房间的连接投递', () => {
    const aHost = createFakeSocket()
    const aGuest = createFakeSocket()
    const bHost = createFakeSocket()
    const bGuest = createFakeSocket()
    const roomA = request(service, aHost, { type: 'create-room', playerName: 'A房主' }).toSelf
    const roomB = request(service, bHost, { type: 'create-room', playerName: 'B房主' }).toSelf

    if (roomA.type !== 'room-created' || roomB.type !== 'room-created') {
      throw new Error('测试房间创建失败。')
    }

    request(service, aGuest, {
      type: 'join-room',
      roomCode: roomA.roomCode,
      playerName: 'A客人',
    })
    request(service, bGuest, {
      type: 'join-room',
      roomCode: roomB.roomCode,
      playerName: 'B客人',
    })
    aHost.messages.length = 0
    aGuest.messages.length = 0
    bHost.messages.length = 0
    bGuest.messages.length = 0

    const result = request(service, bHost, {
      type: 'start-match',
      playerToken: roomB.player.token,
    })

    expect(result.toPlayers?.map((delivery) => delivery.socket)).toEqual([bGuest])
    expect(aHost.messages).toEqual([])
    expect(aGuest.messages).toEqual([])
    expect(findLatestMessage(bGuest, 'room-state').room.roomCode).toBe(roomB.roomCode)
  })

  it('开局后每个真人只收到自己的手牌', () => {
    const hostSocket = createFakeSocket()
    const guestSocket = createFakeSocket()
    const created = request(service, hostSocket, { type: 'create-room', playerName: '房主' }).toSelf

    if (created.type !== 'room-created') {
      throw new Error('创建房间失败。')
    }

    const joined = request(service, guestSocket, {
      type: 'join-room',
      roomCode: created.roomCode,
      playerName: '客人',
    }).toSelf
    if (joined.type !== 'room-joined') {
      throw new Error('加入房间失败。')
    }

    request(service, hostSocket, {
      type: 'start-match',
      playerToken: created.player.token,
    })
    const hostRound = findLatestMessage(hostSocket, 'room-state').state.currentRound
    const guestRound = findLatestMessage(guestSocket, 'room-state').state.currentRound
    const hostHands = hostRound?.seats.map((seat) => seat.hand.map((card) => card.id)) ?? []
    const guestHands = guestRound?.seats.map((seat) => seat.hand.map((card) => card.id)) ?? []
    const hostOwnHand = hostHands.find((hand) => hand.length > 0) ?? []
    const guestOwnHand = guestHands.find((hand) => hand.length > 0) ?? []

    expect(hostHands.filter((hand) => hand.length > 0)).toHaveLength(1)
    expect(guestHands.filter((hand) => hand.length > 0)).toHaveLength(1)
    expect(hostOwnHand).toHaveLength(8)
    expect(guestOwnHand).toHaveLength(8)
    expect(new Set([...hostOwnHand, ...guestOwnHand]).size).toBe(16)
  })

  it('房主主动离开后剩余真人接管并可继续开局', () => {
    const hostSocket = createFakeSocket()
    const guestSocket = createFakeSocket()
    const created = request(service, hostSocket, { type: 'create-room', playerName: '房主' }).toSelf

    if (created.type !== 'room-created') {
      throw new Error('创建房间失败。')
    }

    const joined = request(service, guestSocket, {
      type: 'join-room',
      roomCode: created.roomCode,
      playerName: '朋友',
    }).toSelf
    if (joined.type !== 'room-joined') {
      throw new Error('加入房间失败。')
    }

    const leaveResult = request(service, hostSocket, {
      type: 'leave-room',
      playerToken: created.player.token,
    })

    expect(leaveResult.toSelf.type).toBe('room-left')
    expect(findLatestMessage(guestSocket, 'room-state').room.hostSeat).toBe(joined.player.seat)
    expect(request(service, guestSocket, {
      type: 'start-match',
      playerToken: joined.player.token,
    }).toSelf.type).toBe('room-state')
  })

  it('房主断线后立即迁移房主，离线座位由机器人临时代打', async () => {
    vi.useFakeTimers()
    // 固定首发为房主座位，确保该用例直接验证断线真人的临时代打，而不是随机等待在线客人操作。
    vi.spyOn(Math, 'random').mockReturnValue(3 / 0x100000000)
    const hostSocket = createFakeSocket()
    const guestSocket = createFakeSocket()
    const created = request(service, hostSocket, { type: 'create-room', playerName: '房主' }).toSelf

    if (created.type !== 'room-created') {
      throw new Error('创建房间失败。')
    }

    const joined = request(service, guestSocket, {
      type: 'join-room',
      roomCode: created.roomCode,
      playerName: '朋友',
    }).toSelf
    if (joined.type !== 'room-joined') {
      throw new Error('加入房间失败。')
    }

    request(service, hostSocket, {
      type: 'start-match',
      playerToken: created.player.token,
    })
    service.handleDisconnect(hostSocket)

    expect(findLatestMessage(guestSocket, 'room-state').room.hostSeat).toBe(joined.player.seat)
    await vi.advanceTimersByTimeAsync(3_000)
    expect(guestSocket.messages.some((message) => message.type === 'match-state')).toBe(true)
  })

  it('断线超过三分钟后释放座位，不因其他在线玩家而永久占位', async () => {
    vi.useFakeTimers()
    const hostSocket = createFakeSocket()
    const guestSocket = createFakeSocket()
    const created = request(service, hostSocket, { type: 'create-room', playerName: '房主' }).toSelf

    if (created.type !== 'room-created') {
      throw new Error('创建房间失败。')
    }

    const joined = request(service, guestSocket, {
      type: 'join-room',
      roomCode: created.roomCode,
      playerName: '朋友',
    }).toSelf
    if (joined.type !== 'room-joined') {
      throw new Error('加入房间失败。')
    }

    service.handleDisconnect(guestSocket)
    await vi.advanceTimersByTimeAsync(181_000)
    const refreshed = request(service, hostSocket, {
      type: 'request-room',
      playerToken: created.player.token,
    }).toSelf

    expect(refreshed.type).toBe('room-state')
    if (refreshed.type !== 'room-state') {
      return
    }

    expect(refreshed.room.players.some((player) => player.seat === joined.player.seat)).toBe(false)
    expect(refreshed.room.seatConfigs[joined.player.seat].mode).toBe('bot')
  })
})
