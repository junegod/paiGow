import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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
    const startMessage = findMessage<{ type: string; state?: { currentRound: unknown } }>(
      socket,
      'room-state',
    )
    expect(startMessage.state?.currentRound ?? null).not.toBeNull()

    await vi.advanceTimersByTimeAsync(750)
    expect(socket.messages.some((data) => data.includes('"type":"match-state"'))).toBe(true)
    service.stop()
  })
})
