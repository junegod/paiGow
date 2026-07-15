import type { BotDecisionContext, PreparedAction } from '@/rules-core/types'
import {
  describeAction,
  estimateLeadSecurity,
  type ActionShape,
} from '@/rules-variants/ji-an-da-suo-zi/botStrategyAnalysis'
import { isLastTwoRewardAction } from '@/rules-variants/ji-an-da-suo-zi/botRewardEvaluation'

interface ExpertPosition {
  /** 当前合法动作对应的牌型摘要。 */
  shape: ActionShape
  /** 当前是否大概率已经进入全桌最后一墩。 */
  likelyLastTrick: boolean
  /** 当前是否处于需要显著提高控制权权重的残局。 */
  endgamePosition: boolean
  /** 动作成功后预计增加的基础墩数。 */
  estimatedGain: number
  /** 动作成功后机器人预计达到的基础墩数。 */
  pierAfterAction: number
  /** 基于公开牌和自己手牌估算的动作安全度。 */
  security: number
  /** 当前公开计分中对手的最高基础墩数。 */
  maximumOpponentPierCount: number
}

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
 * 汇总专家难度需要的公开局势指标。
 * 计算只读取自己手牌、公开墩记录、公开目标牌型和对手剩余张数，不接触任何暗牌身份。
 *
 * @param context 当前脱敏决策上下文。
 * @param action 规则引擎提供的合法动作。
 * @returns 供各专家子评分器复用的公开局势摘要。
 */
function createExpertPosition(
  context: BotDecisionContext,
  action: PreparedAction,
): ExpertPosition {
  const shape = describeAction(context, action)
  const self = context.observation.self
  const round = context.observation.round
  const expectedCardCount = round.currentTrick?.expectedCardCount ?? shape.cardCount
  const minimumOpponentCards = Math.min(
    ...context.observation.opponents.map((opponent) => opponent.remainingCardCount),
  )
  const estimatedGain =
    action.intent === 'respond-eat' || action.intent.startsWith('lead-')
      ? shape.cardCount
      : 0

  return {
    shape,
    likelyLastTrick:
      expectedCardCount > 0 &&
      self.hand.length === expectedCardCount &&
      context.observation.opponents.every(
        (opponent) => opponent.remainingCardCount <= expectedCardCount,
      ),
    endgamePosition:
      self.hand.length - shape.cardCount <= 3 ||
      minimumOpponentCards <= 2 ||
      round.publicTrickLog.length >= 5,
    estimatedGain,
    pierAfterAction: self.wonPierCount + estimatedGain,
    security: action.intent === 'roll-dice' ? 0 : estimateLeadSecurity(context, shape),
    maximumOpponentPierCount: Math.max(
      ...context.observation.opponents.map((opponent) => opponent.wonPierCount),
    ),
  }
}

/**
 * 计算专家档的残局安全度与抢墩加权。
 *
 * @param position 当前动作对应的专家局势摘要。
 * @returns 残局控制权附加分。
 */
function scoreEndgameControl(position: ExpertPosition): number {
  if (!position.endgamePosition) {
    return 0
  }

  return position.security * 148 + position.estimatedGain * 42
}

/**
 * 计算专家档的最后一手和最后一墩加权。
 * 收官明吃、最后领出会获得大幅加分，最后一墩背面放弃则受到同量级惩罚。
 *
 * @param context 当前脱敏决策上下文。
 * @param action 规则引擎提供的合法动作。
 * @param position 当前动作对应的专家局势摘要。
 * @returns 收官控制权附加分。
 */
function scoreFinalTrickControl(
  context: BotDecisionContext,
  action: PreparedAction,
  position: ExpertPosition,
): number {
  let score = isFinalHandAction(context, action) ? 540 : 0

  if (!position.likelyLastTrick) {
    return score
  }

  if (action.intent === 'respond-eat') {
    score += 720
  } else if (action.intent === 'respond-pass-hidden') {
    score -= 720
  } else if (action.intent === 'lead-final-open') {
    score += 640
  }

  return score
}

/**
 * 计算专家档的赏、孵赏和吃赏加权。
 * 孵赏收益显著高于普通活赏，最后两墩选择死赏则承担明显机会成本。
 *
 * @param context 当前脱敏决策上下文。
 * @param action 规则引擎提供的合法动作。
 * @param position 当前动作对应的专家局势摘要。
 * @returns 赏牌局势附加分。
 */
function scoreRewardControl(
  context: BotDecisionContext,
  action: PreparedAction,
  position: ExpertPosition,
): number {
  if (position.shape.kind === 'reward-live') {
    return isLastTwoRewardAction(context, position.shape) ? 620 : 210
  }

  if (position.shape.kind === 'reward-dead') {
    return isLastTwoRewardAction(context, position.shape) ? -520 : -90
  }

  if (
    action.intent === 'respond-eat' &&
    context.observation.round.currentTrick?.currentTargetPattern?.group === 'reward-live'
  ) {
    return 260
  }

  return 0
}

/**
 * 计算专家档围绕保本线、七墩和收官线的公开计分压力。
 *
 * @param context 当前脱敏决策上下文。
 * @param position 当前动作对应的专家局势摘要。
 * @returns 基础墩数竞争附加分。
 */
function scorePierRace(
  context: BotDecisionContext,
  position: ExpertPosition,
): number {
  const self = context.observation.self
  let score = self.wonPierCount < 4 && position.pierAfterAction >= 4 ? 90 : 0

  if (position.pierAfterAction >= 8) {
    score += 260
  } else if (position.pierAfterAction >= 7) {
    score += 120
  }

  if (
    position.maximumOpponentPierCount >= 6 &&
    position.pierAfterAction > self.wonPierCount
  ) {
    score += 70
  }

  return score
}

/**
 * 计算专家难度叠加在标准评分之上的公开局势权重。
 * 专家档会显著提高残局、赏、孵赏和最后一墩控制权，但仍只使用脱敏观察。
 *
 * @param context 当前脱敏决策上下文。
 * @param action 规则引擎提供的合法动作。
 * @returns 需要叠加到标准评分上的专家附加分。
 */
export function scoreExpertBotActionAdjustment(
  context: BotDecisionContext,
  action: PreparedAction,
): number {
  const position = createExpertPosition(context, action)

  return (
    scoreEndgameControl(position) +
    scoreFinalTrickControl(context, action, position) +
    scoreRewardControl(context, action, position) +
    scorePierRace(context, position)
  )
}
