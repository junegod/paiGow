import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useOnlineController } from '@/app/useOnlineController'
import { hasOnlineConsent } from '@/app/useOnlineConsent'
import { saveOnlineSession } from '@/services/online/onlineSession'
import { FakeWebSocket } from '@/test/FakeWebSocket'

describe('单机与联机隐私边界', () => {
  beforeEach(() => {
    localStorage.clear()
    FakeWebSocket.instances = []
    vi.stubGlobal('WebSocket', FakeWebSocket)
  })
  afterEach(() => { cleanup(); vi.unstubAllGlobals() })

  it('首页和取消联机都不建连，确认后只执行一次创建，撤回后重新询问', async () => {
    const { result } = renderHook(() => useOnlineController('测试玩家'))
    expect(FakeWebSocket.instances).toHaveLength(0)
    await act(async () => { result.current.createRoom('测试玩家') })
    expect(result.current.consent.requested).toBe(true)
    expect(FakeWebSocket.instances).toHaveLength(0)
    await act(async () => { result.current.consent.cancel() })
    expect(FakeWebSocket.instances).toHaveLength(0)
    await act(async () => { result.current.createRoom('测试玩家') })
    await act(async () => { result.current.consent.accept(); result.current.consent.accept() })
    expect(hasOnlineConsent()).toBe(true)
    const socket = FakeWebSocket.instances[0]
    await act(async () => { socket.open(); socket.receive({ type: 'pong' }) })
    expect(socket.sent.filter((message) => JSON.parse(message).type === 'create-room')).toHaveLength(1)

    // 撤回必须同时停止在途连接和清除许可；下一次请求不可复用旧确认。
    await act(async () => { result.current.leaveOnlineMode(); result.current.consent.revoke() })
    expect(result.current.connectionStatus).toBe('idle')
    expect(hasOnlineConsent()).toBe(false)
    await act(async () => { result.current.enterBrowser() })
    expect(result.current.consent.requested).toBe(true)
    expect(FakeWebSocket.instances).toHaveLength(1)
  })

  it('保存过许可但没有房间的首页仍不联网，重新进入大厅才连接', async () => {
    const first = renderHook(() => useOnlineController())
    await act(async () => { first.result.current.enterBrowser() })
    await act(async () => { first.result.current.consent.accept() })
    first.unmount()
    FakeWebSocket.instances = []
    const second = renderHook(() => useOnlineController())
    expect(FakeWebSocket.instances).toHaveLength(0)
    await act(async () => { second.result.current.enterBrowser() })
    expect(FakeWebSocket.instances).toHaveLength(1)
  })
  it('已同意且未退出的座位重新启动时恢复身份', async () => {
    const first = renderHook(() => useOnlineController())
    await act(async () => { first.result.current.enterBrowser() })
    await act(async () => { first.result.current.consent.accept() })
    first.unmount()
    saveOnlineSession({ roomCode: '123456', playerToken: 'saved-token', playerName: '测试玩家', seat: 0 })
    FakeWebSocket.instances = []
    renderHook(() => useOnlineController())
    const socket = FakeWebSocket.instances[0]
    await act(async () => { socket.open(); socket.receive({ type: 'pong' }) })
    expect(socket.sent.map((message) => JSON.parse(message)).find((message) => message.type === 'resume-room'))
      .toMatchObject({ roomCode: '123456', playerToken: 'saved-token' })
  })
})
