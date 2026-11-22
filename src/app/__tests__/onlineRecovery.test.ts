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
  afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); vi.unstubAllGlobals() })

  /**
   * 触发浏览器切换前后台事件，测试走实际页面监听入口。
   *
   * @param visibility 事件触发时的页面可见状态。
   */
  function changePageVisibility(visibility: DocumentVisibilityState): void {
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue(visibility)
    document.dispatchEvent(new Event('visibilitychange'))
  }

  it('传输层重连成功但尚未收到身份快照时保持锁定，确认恢复后才放行', async () => {
    const api = new MockMatchApi(42)
    const state = api.startRound()
    const player = { seat: 0 as const, token: 'test-token', name: '测试玩家' }
    const room: OnlineRoomState = {
      roomCode: '123456', seatConfigs: state.seatConfigs, onlineSeats: [0], isPlaying: true,
      hostSeat: 0, revision: 1, players: [{ ...player, online: true, isHost: true }],
    }
    const { result } = renderHook(() => useOnlineController('测试玩家'))
    // 本测试从玩家明确同意的联机入口开始，首页本身不再自动建连。
    await act(async () => { result.current.enterBrowser() })
    await act(async () => { result.current.consent.accept() })
    const first = FakeWebSocket.instances[0]
    await act(async () => {
      first.open()
      first.receive({ type: 'pong' })
      first.receive({ type: 'room-created', roomCode: room.roomCode, player, room, state })
    })
    const session = result.current.session!
    expect(result.current.isSynchronized).toBe(true)

    // 后台不探测；回到前台时用原连接核对权限，多次切回也只保留一个请求。
    await act(async () => {
      changePageVisibility('hidden')
      expect(first.sent.some((payload) => JSON.parse(payload).type === 'resume-room')).toBe(false)
      changePageVisibility('visible')
      changePageVisibility('visible')
    })
    expect(FakeWebSocket.instances).toHaveLength(1)
    expect(first.readyState).toBe(FakeWebSocket.OPEN)
    expect(result.current.connectionStatus).toBe('connected')
    expect(result.current.isSynchronized).toBe(false)
    expect(first.sent.filter((payload) => JSON.parse(payload).type === 'resume-room')).toHaveLength(1)

    await act(async () => {
      first.receive({ type: 'room-resumed', roomCode: session.roomCode, player, room, state })
    })
    expect(result.current.isSynchronized).toBe(true)
    expect(result.current.isHost).toBe(true)

    // 第二次切回时模拟半开：连接看似在线却收不到快照，等到期限才关闭原连接。
    await act(async () => { changePageVisibility('visible'); vi.advanceTimersByTime(9_999) })
    expect(first.readyState).toBe(FakeWebSocket.OPEN)
    expect(result.current.isSynchronized).toBe(false)
    await act(async () => { vi.advanceTimersByTime(601) })
    expect(result.current.connectionStatus).toBe('connecting')
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

  it('前台恢复快照紧跟实时掷骰到达时，保留动画并暂缓下一步', async () => {
    const state = new MockMatchApi(42).startRound()
    const player = { seat: 0 as const, token: 'dice-test-token', name: '掷骰玩家' }
    const room: OnlineRoomState = {
      roomCode: '123456', seatConfigs: state.seatConfigs, onlineSeats: [0], isPlaying: true,
      hostSeat: 0, revision: 1, players: [{ ...player, online: true, isHost: true }],
    }
    const { result } = renderHook(() => useOnlineController('掷骰玩家'))
    await act(async () => { result.current.enterBrowser() })
    await act(async () => { result.current.consent.accept() })
    const socket = FakeWebSocket.instances[0]
    await act(async () => {
      socket.open()
      socket.receive({ type: 'pong' })
      socket.receive({ type: 'room-created', roomCode: room.roomCode, player, room, state })
    })
    await act(async () => { changePageVisibility('visible') })

    const rolled = structuredClone(state)
    const round = rolled.currentRound!
    const roll = { first: 3, second: 2, sum: 5, key: '2-3', door: 'point' } as const
    round.currentSeat = 0
    round.pendingDice = { seat: 0, roll, forcedDoor: roll.door, hasMatchingDoor: true }
    // 两条消息在同一批渲染；恢复快照应确认操作身份，同时保留对应的实时掷骰。
    await act(async () => {
      socket.receive({ type: 'match-state', roomCode: room.roomCode, revision: 2, state: rolled })
      socket.receive({ type: 'room-resumed', roomCode: room.roomCode, player, room: { ...room, revision: 2 }, state: rolled })
    })
    expect(result.current.isSynchronized).toBe(true)
    expect(result.current.controller?.diceReviewRoll).toEqual(roll)

    const before = socket.sent.length
    await act(async () => {
      result.current.submitViewerAction({
        id: 'resolve', intent: 'resolve-dice-open', selectedCardIds: [round.seats[0].hand[0].id],
        label: '出牌', description: '定门出牌', emphasis: 'primary',
      })
    })
    expect(socket.sent).toHaveLength(before)
  })
})
