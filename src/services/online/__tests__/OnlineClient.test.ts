import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { OnlineClient } from '@/services/online/OnlineClient'
import { FakeWebSocket } from '@/test/FakeWebSocket'

describe('联机连接恢复', () => {
  let client: OnlineClient
  beforeEach(() => {
    vi.useFakeTimers()
    FakeWebSocket.instances = []
    vi.stubGlobal('WebSocket', FakeWebSocket)
    client = new OnlineClient('ws://localhost/test')
  })
  afterEach(() => { client.disconnect(); vi.useRealTimers(); vi.unstubAllGlobals() })

  it('半开连接未收到 pong 时主动更换连接，不等待浏览器 close 事件', () => {
    client.connect()
    const socket = FakeWebSocket.instances[0]
    socket.open()
    expect(client.status).toBe('connected')
    vi.advanceTimersByTime(10_000)
    expect(socket.readyState).toBe(3)
    expect(client.status).toBe('reconnecting')
    vi.advanceTimersByTime(600)
    expect(FakeWebSocket.instances).toHaveLength(2)
  })

  it('正常 pong 取消超时，后续心跳仍继续检测', () => {
    client.connect()
    const socket = FakeWebSocket.instances[0]
    socket.open()
    socket.receive({ type: 'pong' })
    vi.advanceTimersByTime(25_000)
    expect(client.status).toBe('connected')
    expect(socket.sent.map((message) => JSON.parse(message).type)).toEqual(['ping', 'ping'])
    socket.receive({ type: 'pong' })
    vi.advanceTimersByTime(10_000)
    expect(FakeWebSocket.instances).toHaveLength(1)
  })

  it('握手一直不完成也会超时重试', () => {
    client.connect()
    vi.advanceTimersByTime(10_600)
    expect(FakeWebSocket.instances).toHaveLength(2)
  })

  it('断网不补发过期出牌或开局，大厅重复查询只保留一次', () => {
    client.connect()
    client.submitAction('token', { seat: 0, intent: 'roll-dice', selectedCardIds: [] })
    client.startMatch('token')
    for (let index = 0; index < 100; index += 1) { client.requestRoomList() }
    const socket = FakeWebSocket.instances[0]
    socket.open()
    expect(socket.sent.map((message) => JSON.parse(message).type)).toEqual(['list-rooms', 'ping'])
  })

  it('主动断开清理计时器和积压消息，重新挂载可以建立新连接', () => {
    client.createRoom('测试玩家')
    client.disconnect()
    vi.advanceTimersByTime(60_000)
    expect(FakeWebSocket.instances).toHaveLength(1)
    client.connect()
    FakeWebSocket.instances[1].open()
    expect(FakeWebSocket.instances[1].sent.map((message) => JSON.parse(message).type)).toEqual(['ping'])
  })
})
