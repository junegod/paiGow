import { SeededRandom } from '@/rules-core/random'
import type {
  BotDifficulty,
  MatchState,
  PreparedAction,
  SeatConfig,
  TurnAction,
} from '@/rules-core/types'
import { DEFAULT_SEAT_CONFIGS } from '@/rules-variants/ji-an-da-suo-zi/cardCatalog'
import { createBotDecisionContext } from '@/rules-variants/ji-an-da-suo-zi/botObservation'
import { getHeuristicBotStrategy } from '@/rules-variants/ji-an-da-suo-zi/botStrategy'
import { jiAnDaSuoZiRuleSet } from '@/rules-variants/ji-an-da-suo-zi/ruleSet'

const DIFFICULTIES: BotDifficulty[] = ['beginner', 'standard', 'expert']
const MAX_ACTIONS_PER_ROUND = 160

interface DifficultyBehaviorStats {
  /** 当前难度累计参与比较的决策次数。 */
  decisions: number
  /** 主动打活赏次数。 */
  liveRewardLeads: number
  /** 主动打死赏次数。 */
  deadRewardLeads: number
  /** 有明吃动作但选择合法弃牌的次数。 */
  passesWithEatAvailable: number
  /** 主动选择掷骰次数。 */
  diceRolls: number
}

export interface BotDifficultyBenchmarkReport {
  /** 实际完整跑完的牌局数。 */
  rounds: number
  /** 参与三档横向比较的决策总数。 */
  comparedDecisions: number
  /** 入门和标准选择不同的决策数。 */
  beginnerStandardDifferences: number
  /** 标准和专家选择不同的决策数。 */
  standardExpertDifferences: number
  /** 三档全部选择相同动作的决策数。 */
  allSameDecisions: number
  /** 三档分别表现出的关键行为统计。 */
  behaviorByDifficulty: Record<BotDifficulty, DifficultyBehaviorStats>
}

/** 创建四机器人座位，保证基准流程不会停在真人等待状态。 */
function createBotSeatConfigs(): SeatConfig[] {
  return DEFAULT_SEAT_CONFIGS.map((seatConfig) => ({
    ...seatConfig,
    mode: 'bot',
  }))
}

/** 创建一份空行为统计，避免三档共用可变对象。 */
function createBehaviorStats(): DifficultyBehaviorStats {
  return {
    decisions: 0,
    liveRewardLeads: 0,
    deadRewardLeads: 0,
    passesWithEatAvailable: 0,
    diceRolls: 0,
  }
}

/**
 * 将最终动作转换成玩家可感知的语义签名。重复牌的副本 id 不影响牌面，
 * 因此签名使用动作意图和牌定义，而不是实例牌 id。
 */
function createActionSignature(
  action: TurnAction,
  legalActions: PreparedAction[],
  matchState: MatchState,
): string {
  const round = matchState.currentRound
  const seatState = round?.seats.find((seat) => seat.seat === action.seat)
  const selectedDefinitions = action.selectedCardIds
    .map((cardId) => seatState?.hand.find((card) => card.id === cardId)?.definitionId ?? cardId)
    .sort()
  const legalAction = legalActions.find((candidate) =>
    candidate.intent === action.intent &&
    candidate.selectedCardIds.length === action.selectedCardIds.length &&
    candidate.selectedCardIds.every((cardId, index) => cardId === action.selectedCardIds[index]),
  )

  return `${legalAction?.intent ?? action.intent}:${selectedDefinitions.join('|')}`
}

/** 汇总一个难度在当前公开局面选择出的关键行为。 */
function recordBehavior(
  stats: DifficultyBehaviorStats,
  action: TurnAction,
  legalActions: PreparedAction[],
): void {
  stats.decisions += 1

  if (action.intent === 'lead-reward-live') {
    stats.liveRewardLeads += 1
  } else if (action.intent === 'lead-reward-dead') {
    stats.deadRewardLeads += 1
  } else if (action.intent === 'roll-dice') {
    stats.diceRolls += 1
  } else if (
    action.intent === 'respond-pass-hidden' &&
    legalActions.some((candidate) => candidate.intent === 'respond-eat')
  ) {
    stats.passesWithEatAvailable += 1
  }
}

/**
 * 使用同一批公开局面横向询问三档策略，并继续执行标准档动作推进牌局。
 * 这样三档看到的输入完全一致，差异率不会被不同洗牌或不同历史路径污染。
 */
export function runBotDifficultyBenchmark(
  rounds = 200,
  seed = 2026071501,
): BotDifficultyBenchmarkReport {
  const random = new SeededRandom(seed)
  let matchState = jiAnDaSuoZiRuleSet.createMatch(seed, createBotSeatConfigs())
  const behaviorByDifficulty: Record<BotDifficulty, DifficultyBehaviorStats> = {
    beginner: createBehaviorStats(),
    standard: createBehaviorStats(),
    expert: createBehaviorStats(),
  }
  let comparedDecisions = 0
  let beginnerStandardDifferences = 0
  let standardExpertDifferences = 0
  let allSameDecisions = 0

  for (let roundIndex = 0; roundIndex < rounds; roundIndex += 1) {
    matchState = jiAnDaSuoZiRuleSet.startRound(matchState, random).match
    let actionCount = 0

    while (matchState.currentRound?.phase !== 'settled') {
      const round = matchState.currentRound

      if (!round) {
        throw new Error('难度基准运行中缺少当前牌局。')
      }

      if (round.phase === 'awaiting-reveal') {
        matchState = jiAnDaSuoZiRuleSet.finishRoundAndReveal(matchState).match
        continue
      }

      if (round.currentSeat === null) {
        throw new Error('难度基准运行中缺少当前操作座位。')
      }

      actionCount += 1

      if (actionCount > MAX_ACTIONS_PER_ROUND) {
        throw new Error(`第 ${round.roundNumber} 局超过最大动作数。`)
      }

      const legalActions = jiAnDaSuoZiRuleSet.listTurnActions(round, round.currentSeat)
      const context = createBotDecisionContext(round, round.currentSeat, legalActions)
      const decisions = Object.fromEntries(
        DIFFICULTIES.map((difficulty) => [
          difficulty,
          getHeuristicBotStrategy(difficulty).chooseAction(context),
        ]),
      ) as Record<BotDifficulty, TurnAction>
      const signatures = Object.fromEntries(
        DIFFICULTIES.map((difficulty) => [
          difficulty,
          createActionSignature(decisions[difficulty], legalActions, matchState),
        ]),
      ) as Record<BotDifficulty, string>

      comparedDecisions += 1
      beginnerStandardDifferences += Number(signatures.beginner !== signatures.standard)
      standardExpertDifferences += Number(signatures.standard !== signatures.expert)
      allSameDecisions += Number(
        signatures.beginner === signatures.standard &&
        signatures.standard === signatures.expert,
      )

      DIFFICULTIES.forEach((difficulty) => {
        recordBehavior(behaviorByDifficulty[difficulty], decisions[difficulty], legalActions)
      })

      matchState = jiAnDaSuoZiRuleSet.submitAction(
        matchState,
        decisions.standard,
        random,
      ).match
    }
  }

  return {
    rounds,
    comparedDecisions,
    beginnerStandardDifferences,
    standardExpertDifferences,
    allSameDecisions,
    behaviorByDifficulty,
  }
}
