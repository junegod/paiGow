import type {
  BotDecisionContext,
  BotStrategy,
  PreparedAction,
  TurnAction,
} from '@/rules-core/types'
import { scoreBotAction } from '@/rules-variants/ji-an-da-suo-zi/botStrategyScoring'

interface ScoredAction {
  /** 规则层给出的合法预备动作。 */
  action: PreparedAction
  /** 策略最终评分，分数越高越优先。 */
  score: number
}

const STRATEGY_ID = 'endgame-control-v2'

/**
 * 将 PreparedAction 落成最终的 TurnAction。
 */
function toTurnAction(
  seat: number,
  action: PreparedAction,
): TurnAction {
  return {
    seat: seat as TurnAction['seat'],
    intent: action.intent,
    selectedCardIds: action.selectedCardIds,
  }
}

/**
 * 对所有合法动作打分并做稳定排序，确保同一局面下机器人选择可复现。
 */
function chooseHighestScoreAction(context: BotDecisionContext): PreparedAction {
  const scoredActions: ScoredAction[] = context.legalActions.map((action) => ({
    action,
    score: scoreBotAction(context, action),
  }))

  scoredActions.sort((leftItem, rightItem) => {
    if (rightItem.score !== leftItem.score) {
      return rightItem.score - leftItem.score
    }

    return leftItem.action.label.localeCompare(rightItem.action.label, 'zh-Hans-CN')
  })

  const bestAction = scoredActions[0]?.action

  if (!bestAction) {
    throw new Error('机器人没有可执行动作。')
  }

  return bestAction
}

/**
 * 吉安打索子启发式机器人 v2。核心目标不是“每墩都抢”，而是：
 * 早期少浪费脑子和强对子，中期抢多墩高安全牌，后期尽量拿最后一墩。
 */
export const heuristicBotStrategy: BotStrategy = {
  id: STRATEGY_ID,
  chooseAction(context) {
    return toTurnAction(context.seat, chooseHighestScoreAction(context))
  },
}
