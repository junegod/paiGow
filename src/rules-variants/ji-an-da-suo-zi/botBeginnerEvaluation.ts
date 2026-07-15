import type { BotDecisionContext, PreparedAction } from '@/rules-core/types'
import {
  countLooseSingles,
  describeAction,
  estimateStructureDamage,
  GROUP_MAX_STRENGTH,
  type ActionShape,
} from '@/rules-variants/ji-an-da-suo-zi/botStrategyAnalysis'
import { isLastTwoRewardAction } from '@/rules-variants/ji-an-da-suo-zi/botRewardEvaluation'

/**
 * 判断动作是否会一次打完机器人当前全部手牌。
 *
 * @param context 当前脱敏决策上下文。
 * @param action 规则引擎提供的合法动作。
 * @returns 动作是否直接清空当前手牌。
 */
function isFinalHandAction(context: BotDecisionContext, action: PreparedAction): boolean {
  return (
    action.selectedCardIds.length > 0 &&
    action.selectedCardIds.length === context.observation.self.hand.length
  )
}

/**
 * 将牌型强度换算成零到一附近的粗粒度比例。
 * 入门档只需要区分明显强弱，不执行标准档的完整安全牌推演。
 *
 * @param shape 当前合法动作对应的牌型摘要。
 * @returns 基于牌型组最大强度计算的相对牌力。
 */
function normalizeStrength(shape: ActionShape): number {
  if (!shape.group) {
    return 0
  }

  return shape.strength / (GROUP_MAX_STRENGTH[shape.group] ?? Math.max(1, shape.strength))
}

/**
 * 计算入门难度的后手响应分数。
 * 仅考虑基础牌力、张数、粗略结构损耗、公开赏目标和是否最后一手。
 *
 * @param context 当前脱敏决策上下文。
 * @param action 规则引擎提供的合法响应动作。
 * @param shape 动作对应的牌型摘要。
 * @param damage 动作造成的粗略结构损耗。
 * @returns 入门难度的响应分数。
 */
function scoreBeginnerResponse(
  context: BotDecisionContext,
  action: PreparedAction,
  shape: ActionShape,
  damage: number,
): number {
  const finalActionBonus = isFinalHandAction(context, action) ? 130 : 0

  if (action.intent === 'respond-pass-hidden') {
    return 38 - damage - finalActionBonus
  }

  const publicRewardBonus =
    context.observation.round.currentTrick?.currentTargetPattern?.group === 'reward-live'
      ? 82
      : 0

  return (
    34 +
    shape.cardCount * 20 +
    normalizeStrength(shape) * 24 +
    finalActionBonus +
    publicRewardBonus -
    damage
  )
}

/**
 * 计算入门难度的领出分数。
 * 赏牌只使用固定基础权重，孵赏给予明显但不进行深层风险推演的加成。
 *
 * @param context 当前脱敏决策上下文。
 * @param action 规则引擎提供的合法领出动作。
 * @param shape 动作对应的牌型摘要。
 * @param damage 动作造成的粗略结构损耗。
 * @returns 入门难度的领出分数。
 */
function scoreBeginnerLead(
  context: BotDecisionContext,
  action: PreparedAction,
  shape: ActionShape,
  damage: number,
): number {
  const finalActionBonus = isFinalHandAction(context, action) ? 130 : 0
  const rewardBonus =
    shape.kind === 'reward-live'
      ? isLastTwoRewardAction(context, shape)
        ? 190
        : 92
      : shape.kind === 'reward-dead'
        ? 34
        : 0

  return (
    26 +
    shape.cardCount * 22 +
    normalizeStrength(shape) * 30 +
    finalActionBonus +
    rewardBonus -
    damage
  )
}

/**
 * 计算入门难度的浅层启发式分数。
 * 该档不执行完整安全牌、赏风险和残局结构推演，最终选择阶段会在相近高分候选中稳定随机。
 *
 * @param context 当前脱敏决策上下文。
 * @param action 规则引擎提供的合法动作。
 * @returns 入门难度下的粗粒度动作分数。
 */
export function scoreBeginnerBotAction(
  context: BotDecisionContext,
  action: PreparedAction,
): number {
  const shape = describeAction(context, action)
  const damage = estimateStructureDamage(context, shape.cards) * 0.32

  if (action.intent === 'respond-pass-hidden' || action.intent === 'respond-eat') {
    return scoreBeginnerResponse(context, action, shape, damage)
  }

  if (action.intent === 'roll-dice') {
    return 24 + countLooseSingles(context.observation.self.hand) * 4
  }

  if (action.intent === 'resolve-dice-hidden') {
    return 34 - damage
  }

  if (action.intent === 'resolve-dice-open') {
    return 32 + normalizeStrength(shape) * 20 - damage
  }

  return scoreBeginnerLead(context, action, shape, damage)
}
