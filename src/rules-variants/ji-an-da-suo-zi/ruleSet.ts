import type { MatchState, RuleSet, SeatConfig } from '@/rules-core/types'
import { heuristicBotStrategy } from '@/rules-variants/ji-an-da-suo-zi/botStrategy'
import {
  DEFAULT_SEAT_CONFIGS,
  getAllCardDefinitions,
  getCardDefinition,
} from '@/rules-variants/ji-an-da-suo-zi/cardCatalog'
import {
  createInitialMatch,
  finishRoundAndReveal,
  getReplayState,
  getTurnHint,
  listTurnActions,
  previewSelection,
  startRound,
  submitAction,
} from '@/rules-variants/ji-an-da-suo-zi/engine'

/**
 * 将吉安打索子玩法打包成统一 RuleSet，供 mock 服务和 UI 复用。
 */
export const jiAnDaSuoZiRuleSet: RuleSet = {
  id: 'ji-an-da-suo-zi',
  name: '江西吉安打索子',
  createMatch(seed: number, seatConfigs: SeatConfig[] = DEFAULT_SEAT_CONFIGS): MatchState {
    return createInitialMatch(seed, seatConfigs)
  },
  startRound,
  previewSelection,
  listTurnActions,
  getTurnHint,
  submitAction,
  finishRoundAndReveal,
  getReplayState,
  getBotStrategy() {
    return heuristicBotStrategy
  },
  getCardDefinition,
  getAllCardDefinitions,
}
