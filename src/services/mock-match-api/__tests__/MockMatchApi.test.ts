import { describe, expect, it } from 'vitest'

import type { SeatConfig } from '@/rules-core/types'
import {
  createDeck,
  DEFAULT_SEAT_CONFIGS,
} from '@/rules-variants/ji-an-da-suo-zi/cardCatalog'
import { MockMatchApi } from '@/services/mock-match-api/MockMatchApi'

function createBotSeatConfigs(): SeatConfig[] {
  return DEFAULT_SEAT_CONFIGS.map((seatConfig) => ({
    ...seatConfig,
    mode: 'bot',
  }))
}

describe('MockMatchApi', () => {
  it('首页指定的真人手牌会进入对应座位，不足 8 张时随机补齐', () => {
    const api = new MockMatchApi(20260628)
    const selectedHandCardIds = createDeck()
      .filter((card) => card.definitionId === 'point_three' || card.definitionId === 'point_six')
      .map((card) => card.id)

    api.startRound({
      humanSeat: 0,
      selectedHandCardIds,
    })

    const round = api.getState().currentRound
    const humanSeatState = round?.seats.find((seatState) => seatState.seat === 0)
    const allCardIds = round?.seats.flatMap((seatState) =>
      seatState.hand.map((card) => card.id),
    ) ?? []

    expect(humanSeatState?.hand).toHaveLength(8)
    expect(selectedHandCardIds.every((cardId) =>
      humanSeatState?.hand.some((card) => card.id === cardId),
    )).toBe(true)
    expect(new Set(allCardIds).size).toBe(32)
  })

  it('牌局进行中配置座位不会清空当前局', () => {
    const api = new MockMatchApi(20260628)
    api.startRound()

    const playingState = api.getState()
    api.configureSeats(createBotSeatConfigs())
    const stateAfterConfigure = api.getState()

    expect(playingState.currentRound?.roundNumber).toBe(1)
    expect(stateAfterConfigure.currentRound?.roundNumber).toBe(1)
    expect(stateAfterConfigure.currentRound?.phase).toBe('playing')
  })

  it('机器人可以通过 mock 服务稳定完成整局并进入结算复盘', () => {
    const api = new MockMatchApi(20260628)
    api.configureSeats(createBotSeatConfigs())
    api.startRound()

    for (let index = 0; index < 240; index += 1) {
      const state = api.getState()

      if (state.currentRound?.phase === 'awaiting-reveal') {
        api.finishRoundAndReveal()
        break
      }

      if (state.currentRound?.phase === 'settled') {
        break
      }

      api.requestBotMove()
    }

    const settledState = api.getState()
    const settledRound = settledState.currentRound

    expect(settledRound?.phase).toBe('settled')
    expect(settledRound?.settlement).toBeDefined()
    expect(settledRound?.seats.every((seatState) => seatState.hand.length === 0)).toBe(true)
    expect(
      settledRound?.seats.reduce((total, seatState) => total + seatState.wonPierCount, 0),
    ).toBe(8)
    expect(
      settledRound?.publicTrickLog.flatMap((trick) => trick.plays).every((play) =>
        play.pattern.isOpen ? true : play.revealed,
      ),
    ).toBe(true)
    expect(
      settledRound?.publicTrickLog.every((trick) => {
        const leadPlay = trick.plays[0]
        return leadPlay.pattern.isOpen || (
          leadPlay.pattern.source === 'dice' && leadPlay.cards.length === 1
        )
      }),
    ).toBe(true)
    expect(
      settledRound?.publicTrickLog
        .flatMap((trick) => trick.plays)
        .some((play) => play.message.includes('最后一手弃牌')),
    ).toBe(false)
  })
})
