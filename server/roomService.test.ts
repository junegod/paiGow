import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { TurnAction } from '@/rules-core/types'
import { jiAnDaSuoZiRuleSet } from '@/rules-variants/ji-an-da-suo-zi/ruleSet'

import { OnlineRoomService, type RoomSocket } from './roomService'

/** 测试用假连接，只记录发送过的文本。 */
function createFakeSocket(): RoomSocket & { messages: string[] } {
  const messages: string[] = []

  return {
    readyState: 1,
    messages,
    send(data: string) {
      messages.push(data)
    },
    close() {},
  }
}

/** 从假连接消息中查找指定类型。 */
function findMessage<T extends { type: string }>(socket: { messages: string[] }, type: string): T {
  const message = socket.messages
    .map((data) => JSON.parse(data) as { type: string })
    .find((item) => item.type === type)

  if (!message) {
    throw new Error(`没有找到消息 ${type}。`)
  }

  return message as T
}

/** 服务端返回包含“发给自己”和“广播给房间”两条结果。 */
function handleMessage(
  service: OnlineRoomService,
  socket: RoomSocket & { messages: string[] },
  message: unknown,
): void {
  const result = service.handleMessage(socket, JSON.stringify(message))
  socket.messages.push(JSON.stringify(result.toSelf))

  if (result.toRoom) {
    socket.messages.push(JSON.stringify(result.toRoom.message))
  }
}


describe('OnlineRoomService', () => {
  let service: OnlineRoomService

  beforeEach(() => {
    service = new OnlineRoomService()
  })

  afterEach(() => {
    vi.useRealTimers()
    service.stop()
  })

  it('创建房间后随机开局，并由服务端机器人推进', async () => {
    vi.useFakeTimers()
    const socket = createFakeSocket()
    const createdResult = service.handleMessage(socket, JSON.stringify({
      type: 'create-room',
      playerName: '房主',
    }))
    socket.messages.push(JSON.stringify(createdResult.toSelf))
    const created = createdResult.toSelf.type === 'room-created'
      ? createdResult.toSelf
      : null

    if (!created) {
      throw new Error('创建房间失败。')
    }

    handleMessage(service, socket, {
      type: 'start-match',
      playerToken: created.player.token,
    })
    const startMessage = findMessage<{
      type: string
      state?: { currentRound?: { currentSeat: number | null } }
    }>(
      socket,
      'room-state',
    )
    expect(startMessage.state?.currentRound ?? null).not.toBeNull()

    // 随机先手可能落在房主座位；房主是真人，测试按前端同一套规则先完成首个合法动作。
    const firstSeat = startMessage.state?.currentRound?.currentSeat

    if (firstSeat === 0) {
      const round = startMessage.state?.currentRound

      if (!round) {
        throw new Error('开局后缺少牌局状态。')
      }

      const firstAction = jiAnDaSuoZiRuleSet.listTurnActions(round, 0)[0]

      if (!firstAction) {
        throw new Error('真人先手没有可用动作。')
      }

      const action: TurnAction = {
        seat: 0,
        intent: firstAction.intent,
        selectedCardIds: firstAction.selectedCardIds,
      }
      const actionResult = service.handleMessage(socket, JSON.stringify({
        type: 'submit-action',
        playerToken: created.player.token,
        action,
      }))
      socket.messages.push(JSON.stringify(actionResult.toSelf))

      if (actionResult.toRoom) {
        socket.messages.push(JSON.stringify(actionResult.toRoom.message))
      }
    }

    await vi.advanceTimersByTimeAsync(1_000)
    expect(socket.messages.some((data) => data.includes('"type":"match-state"'))).toBe(true)
    service.stop()
  })

  it('玩家主动离开后座位由机器人接管', () => {
    const hostSocket = createFakeSocket()
    const createdResult = service.handleMessage(hostSocket, JSON.stringify({
      type: 'create-room',
      playerName: '房主',
    }))
    const created = createdResult.toSelf.type === 'room-created'
      ? createdResult.toSelf
      : null

    if (!created) {
      throw new Error('创建房间失败。')
    }

    const leaveResult = service.handleMessage(hostSocket, JSON.stringify({
      type: 'leave-room',
      playerToken: created.player.token,
    }))

    expect(leaveResult.toSelf.type).toBe('room-state')

    const roomState = leaveResult.toSelf.type === 'room-state'
      ? leaveResult.toSelf
      : null
    expect(roomState?.room.onlineSeats).toEqual([])
    expect(roomState?.room.hostSeat).toBe(0)
    expect(roomState?.state.seatConfigs[0].mode).toBe('bot')
  })

  it('开局后两个真人座位拿到不同的牌', () => {
    const hostSocket = createFakeSocket()
    const guestSocket = createFakeSocket()

    const createdResult = service.handleMessage(hostSocket, JSON.stringify({
      type: 'create-room',
      playerName: '房主',
    }))
    const created = createdResult.toSelf.type === 'room-created'
      ? createdResult.toSelf
      : null

    if (!created) {
      throw new Error('创建房间失败。')
    }

    service.handleMessage(guestSocket, JSON.stringify({
      type: 'join-room',
      roomCode: created.roomCode,
      playerName: '客人',
    }))

    const startResult = service.handleMessage(hostSocket, JSON.stringify({
      type: 'start-match',
      playerToken: created.player.token,
    }))

    hostSocket.messages.push(JSON.stringify(startResult.toSelf))
    if (startResult.toRoom) {
      hostSocket.messages.push(JSON.stringify(startResult.toRoom.message))
    }
    if (startResult.seatBroadcast) {
      for (const item of startResult.seatBroadcast) {
        if (item.seat === 0) {
          hostSocket.messages.push(JSON.stringify(item.message))
        } else {
          guestSocket.messages.push(JSON.stringify(item.message))
        }
      }
    }

    // 从房主连接上的最新 room-state 中提取四家手牌。
    const states = hostSocket.messages
      .map((data) => JSON.parse(data) as { type: string; state?: { currentRound?: { seats?: Array<{ seat: number; hand: Array<{ id: string }> }> } } })
      .filter((message) => message.type === 'room-state' && message.state?.currentRound)
    const latestState = states.at(-1)?.state?.currentRound

    // 视角隔离后房主只能拿到自己的 8 张牌；其余三家的牌需从客人视角取。
    const guestStates = guestSocket.messages
      .map((data) => JSON.parse(data) as { type: string; state?: { currentRound?: { seats?: Array<{ seat: number; hand: Array<{ id: string }> }> } } })
      .filter((message) => message.type === 'room-state' && message.state?.currentRound)
    const guestLatest = guestStates.at(-1)?.state?.currentRound

    if (!latestState?.seats) {
      throw new Error('开局后缺少座位状态。')
    }

    const handIds = latestState.seats.map((seatState) => seatState.hand.map((card) => card.id))
    const guestHandIds = guestLatest?.seats.map((seatState) => seatState.hand.map((card) => card.id)) ?? []

    // 视角裁剪生效：房主视角下其他座位手牌必须为空，客人视角只看得到自己的 8 张。
    expect(handIds.filter((hand) => hand.length > 0)).toHaveLength(1)
    expect(guestHandIds.filter((hand) => hand.length > 0)).toHaveLength(1)

    const hostOwnHand = handIds.find((hand) => hand.length > 0) ?? []
    const guestOwnHand = guestHandIds.find((hand) => hand.length > 0) ?? []
    // 32 张牌总量守恒：四家手牌拼接后不允许出现重复实例。
    const allIds = [...hostOwnHand, ...guestOwnHand]
    expect(new Set(allIds).size).toBe(allIds.length)
    expect(allIds.length).toBe(16)
  })

  it('房主离开后剩余真人接管房主并可以重新开局', () => {
    const hostSocket = createFakeSocket()
    const guestSocket = createFakeSocket()
    const createdResult = service.handleMessage(hostSocket, JSON.stringify({
      type: 'create-room',
      playerName: '房主',
    }))
    const created = createdResult.toSelf.type === 'room-created'
      ? createdResult.toSelf
      : null

    if (!created) {
      throw new Error('创建房间失败。')
    }

    const joinedResult = service.handleMessage(guestSocket, JSON.stringify({
      type: 'join-room',
      roomCode: created.roomCode,
      playerName: '朋友',
    }))
    const joined = joinedResult.toSelf.type === 'room-joined'
      ? joinedResult.toSelf
      : null

    if (!joined) {
      throw new Error('加入房间失败。')
    }

    const leaveResult = service.handleMessage(hostSocket, JSON.stringify({
      type: 'leave-room',
      playerToken: created.player.token,
    }))
    const roomState = leaveResult.toSelf.type === 'room-state'
      ? leaveResult.toSelf
      : null

    expect(roomState?.room.hostSeat).toBe(joined.player.seat)

    const startResult = service.handleMessage(guestSocket, JSON.stringify({
      type: 'start-match',
      playerToken: joined.player.token,
    }))

    expect(startResult.toSelf.type).toBe('room-state')

    const startedState = startResult.toSelf.type === 'room-state'
      ? startResult.toSelf.state
      : null
    expect(startedState?.currentRound).not.toBeNull()
  })
})
