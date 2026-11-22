import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useDiceReview } from '@/app/useDiceReview'
import { MockMatchApi } from '@/services/mock-match-api/MockMatchApi'
import { DICE_TOTAL_DISPLAY_MS } from '@/shared/diceTiming'

/**
 * 复用真实牌局结构，只控制动画需要的点数和已结束回合数。
 *
 * @returns 带有同一掷骰结果的快照和本次点数。
 */
function createDiceSnapshot() {
  const state = new MockMatchApi(42).startRound()
  const round = state.currentRound!
  const roll = { first: 3, second: 2, sum: 5, key: '2-3', door: 'point' } as const
  round.pendingDice = { seat: round.firstLeader, roll, forcedDoor: roll.door, hasMatchingDoor: true }
  return { state, round, roll }
}

describe('局内掷骰展示', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('重复推送和提前定门不会重置或截断展示', () => {
    const { state, round, roll } = createDiceSnapshot()
    const { result, rerender } = renderHook(({ match }) => useDiceReview(match), { initialProps: { match: state } })
    expect(result.current).toEqual(roll)

    act(() => { vi.advanceTimersByTime(700) })
    rerender({ match: structuredClone(state) })
    // 旧版服务端可能在翻滚期间已清掉待定门状态，牌桌仍应展示正确点数。
    rerender({ match: { ...state, currentRound: { ...round, pendingDice: null } } })
    act(() => { vi.advanceTimersByTime(DICE_TOTAL_DISPLAY_MS - 701) })
    expect(result.current).toEqual(roll)
    act(() => { vi.advanceTimersByTime(1) })
    expect(result.current).toBeNull()
  })

  it('仅同步已有点数，下一回合即使点数相同仍可播放', () => {
    const { state, round, roll } = createDiceSnapshot()
    const { result, rerender } = renderHook(({ match, live }) => useDiceReview(match, live), {
      initialProps: { match: state, live: false },
    })
    expect(result.current).toBeNull()
    rerender({ match: structuredClone(state), live: true })
    expect(result.current).toBeNull()

    // 回放列表只用到长度，构造一条已完结记录以隔离规则引擎的出牌细节。
    const nextRound: typeof round = {
      ...round,
      publicTrickLog: [{ trickIndex: 0, leader: 0, winner: 0, cardCount: 1, visibleWinningSeat: 0, plays: [], note: '' }],
    }
    rerender({ match: { ...state, currentRound: nextRound }, live: true })
    expect(result.current).toEqual(roll)
    rerender({ match: { ...state, currentRound: { ...nextRound, roundNumber: nextRound.roundNumber + 1, pendingDice: null } }, live: true })
    expect(result.current).toBeNull()
  })
})
