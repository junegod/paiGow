import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useOnlineController } from '@/app/useOnlineController'
import { MockMatchApi } from '@/services/mock-match-api/MockMatchApi'
import type { OnlineRoomState } from '@/services/online/types'
import { FakeWebSocket } from '@/test/FakeWebSocket'

describe('联机恢复快照门禁', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('WebSocket', FakeWebSocket)
    FakeWebSocket.instances = []
    localStorage.clear()
  })
  afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals() })

  it('传输层重连成功但尚未收到身份快照时保持锁定，确认恢复后才放行', async () => {
    const api = new MockMatchApi(42)
    const state = api.startRound()
    const player = { seat: 0 as const, token: 'test-token', name: '测试玩家' }
    const room: OnlineRoomState = {
      roomCode: '123456', seatConfigs: state.seatConfigs, onlineSeats: [0], isPlaying: true,
      hostSeat: 0, revision: 1, players: [{ ...player, online: true, isHost: true }],
    }
    const { result } = renderHook(() => useOnlineController('测试玩家'))
    const first = FakeWebSocket.instances[0]
    await act(async () => {
      first.open()
      first.receive({ type: 'pong' })
      first.receive({ type: 'room-created', roomCode: room.roomCode, player, room, state })
    })
    const session = result.current.session!
    expect(result.current.isSynchronized).toBe(true)

    await act(async () => { first.close(); vi.advanceTimersByTime(600) })
    let next = FakeWebSocket.instances[1]
    await act(async () => { next.open(); next.receive({ type: 'pong' }) })
    expect(result.current.connectionStatus).toBe('connected')
    expect(result.current.isSynchronized).toBe(false)
    const before = next.sent.length
    await act(async () => {
      result.current.submitViewerAction({ id: 'old-action', intent: 'roll-dice', selectedCardIds: [], label: '掷骰', description: '旧动作', emphasis: 'primary' })
    })
    expect(next.sent).toHaveLength(before)

    // 心跳已经恢复也不能无限等身份快照，超时应再次建立连接。
    await act(async () => { vi.advanceTimersByTime(10_000) })
    expect(result.current.connectionStatus).toBe('reconnecting')
    await act(async () => { vi.advanceTimersByTime(600) })
    next = FakeWebSocket.instances[2]
    await act(async () => { next.open(); next.receive({ type: 'pong' }) })
    await act(async () => {
      next.receive({ type: 'room-resumed', roomCode: session.roomCode, player, room, state })
    })
    expect(result.current.isSynchronized).toBe(true)
    expect(result.current.mode).toBe('match')

    // 恢复期间主动离开后，迟到的身份快照不能把玩家拉回旧牌桌。
    await act(async () => { next.close(); vi.advanceTimersByTime(600) })
    const third = FakeWebSocket.instances[3]
    await act(async () => { third.open(); third.receive({ type: 'pong' }) })
    await act(async () => { result.current.leaveOnlineMode() })
    await act(async () => {
      third.receive({ type: 'room-resumed', roomCode: session.roomCode, player, room, state })
    })
    expect(result.current.mode).toBe('offline')
    expect(result.current.session).toBeNull()
    expect(result.current.isSynchronized).toBe(false)
  })
})
