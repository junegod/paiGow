import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { useSettlementPersistence } from '@/app/useSettlementPersistence'
import { createSettledMatch } from '@/test/matchFixtures'

describe('结算落账与离局门禁', () => {
  afterEach(cleanup)

  it('自动保存失败时保留当前局，手动重试成功后才允许离局', async () => {
    const record = vi.fn().mockRejectedValue(new Error('磁盘空间不足'))
    const leave = vi.fn()
    const match = createSettledMatch()
    const { result } = renderHook(() => useSettlementPersistence({ match, userId: 'user', enabled: true, record }))
    await waitFor(() => expect(result.current.error).toContain('积分保存失败'))
    await act(async () => { await result.current.persistAndRun(leave) })
    expect(leave).not.toHaveBeenCalled()

    record.mockResolvedValue(undefined)
    await act(async () => { await result.current.retry() })
    expect(result.current.error).toBeNull()
    await act(async () => { await result.current.persistAndRun(leave) })
    expect(leave).toHaveBeenCalledTimes(1)
    expect(record).toHaveBeenCalledTimes(3)
  })

  it('自动保存期间连点离局只共享一次写入，并且只推进一次', async () => {
    let resolveWrite!: () => void
    const record = vi.fn(() => new Promise<void>((resolve) => { resolveWrite = resolve }))
    const leave = vi.fn()
    const match = createSettledMatch()
    const { result } = renderHook(() => useSettlementPersistence({ match, userId: 'user', enabled: true, record }))
    await waitFor(() => expect(record).toHaveBeenCalledTimes(1))
    await act(async () => {
      const first = result.current.persistAndRun(leave)
      const second = result.current.persistAndRun(leave)
      expect(leave).not.toHaveBeenCalled()
      resolveWrite()
      await Promise.all([first, second])
    })
    expect(record).toHaveBeenCalledTimes(1)
    expect(leave).toHaveBeenCalledTimes(1)
  })

  it('定制局和联机局不写本机积分', async () => {
    const record = vi.fn()
    const leave = vi.fn()
    const match = createSettledMatch()
    const { result } = renderHook(() => useSettlementPersistence({ match, userId: 'user', enabled: false, record }))
    await act(async () => { await result.current.persistAndRun(leave) })
    expect(record).not.toHaveBeenCalled()
    expect(leave).toHaveBeenCalledTimes(1)
  })

  it('定制局进入下一局后离局锁会释放，第二局仍可返回首页', async () => {
    const record = vi.fn()
    const leave = vi.fn()
    const match = createSettledMatch()
    const { result, rerender } = renderHook(({ currentMatch }) => useSettlementPersistence({
      match: currentMatch, userId: 'user', enabled: false, record,
    }), { initialProps: { currentMatch: match } })
    await act(async () => { await result.current.persistAndRun(leave) })
    const nextMatch = structuredClone(match)
    nextMatch.currentRound!.roundNumber += 1
    rerender({ currentMatch: nextMatch })
    await act(async () => { await result.current.persistAndRun(leave) })
    expect(leave).toHaveBeenCalledTimes(2)
    expect(record).not.toHaveBeenCalled()
  })
})
