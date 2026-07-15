import {
  act,
  renderHook,
} from '@testing-library/react'
import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'

import { useGameController } from '@/app/useGameController'
import { arrangeJiAnDaSuoZiHandIds } from '@/rules-variants/ji-an-da-suo-zi/handArrangement'

describe('跳过抓牌动画设置', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('跳过动画后仍会自动整理真人手牌', async () => {
    vi.useFakeTimers()
    const { result } = renderHook(() => useGameController('standard', true))

    await act(async () => {
      result.current.startRound({ humanSeat: 0 })
    })

    expect(result.current.openingCeremony).toBeNull()

    const originalHand = result.current.humanSeatState?.hand ?? []
    const expectedCardIds = arrangeJiAnDaSuoZiHandIds(originalHand)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(221)
    })

    expect(result.current.visibleActionHandCards.map((card) => card.id)).toEqual(expectedCardIds)
    expect(result.current.isHandOrganizing).toBe(true)
  })
})
