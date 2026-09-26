import { MockMatchApi } from '@/services/mock-match-api/MockMatchApi'
import { DEFAULT_SEAT_CONFIGS } from '@/rules-variants/ji-an-da-suo-zi/cardCatalog'
import type { MatchState } from '@/rules-core/types'

/**
 * 使用真实规则完成固定种子的四机器人对局，避免测试伪造不合法的结算模型。
 * @returns 一局已经揭牌结算的整场状态。
 */
export function createSettledMatch(): MatchState {
  const api = new MockMatchApi(42)
  api.configureSeats(DEFAULT_SEAT_CONFIGS.map((seat) => ({ ...seat, mode: 'bot' })))
  let match = api.startRound()
  for (let step = 0; step < 100 && match.currentRound?.phase === 'playing'; step += 1) {
    match = api.requestBotMove()
  }
  if (match.currentRound?.phase !== 'awaiting-reveal') {
    throw new Error('测试牌局没有在限定步数内完成。')
  }
  return api.finishRoundAndReveal()
}
