import type {
  BotDecisionContext,
  PreparedAction,
} from '@/rules-core/types'
import { getCardDefinition } from '@/rules-variants/ji-an-da-suo-zi/cardCatalog'
import {
  countLooseSingles,
  describeAction,
  estimateLeadSecurity,
  estimatePierProgressValue,
  estimateStructureDamage,
  GROUP_MAX_STRENGTH,
  isEndgame,
} from '@/rules-variants/ji-an-da-suo-zi/botStrategyAnalysis'
import {
  estimateDeadRewardLeadScore,
  estimateLiveRewardLeadScore,
} from '@/rules-variants/ji-an-da-suo-zi/botRewardEvaluation'

/**
 * 后手响应评分：最后一墩能吃一定优先；早期只为 1 墩要慎用脑子和强对子。
 */
function scoreResponseAction(
  context: BotDecisionContext,
  action: PreparedAction,
): number {
  const shape = describeAction(context, action)
  const damage = estimateStructureDamage(context, shape.cards)
  const trickValue = context.round.currentTrick?.expectedCardCount ?? shape.cardCount
  const isFinalResponse = shape.cardCount > 0 && shape.cardCount === context.seatState.hand.length

  if (action.intent === 'respond-pass-hidden') {
    const lowDiscardBonus = 42 - damage
    return isFinalResponse ? lowDiscardBonus - 180 : lowDiscardBonus
  }

  const targetPattern = context.round.currentTrick?.currentTargetPattern
  const forcedDoor = context.round.currentTrick?.forcedDoor
  const forcedDoorBonus = forcedDoor ? 18 : 0
  const rewardMustEatBonus = targetPattern?.group === 'reward-live' ? 220 : 0
  const finalControlBonus = isFinalResponse ? 360 : isEndgame(context, shape.cardCount) ? 70 : 0
  const pierValue = estimatePierProgressValue(context.seatState, trickValue)
  const security = forcedDoor
    ? estimateLeadSecurity(context, shape) * 28
    : (shape.strength / (GROUP_MAX_STRENGTH[shape.group ?? 'hidden'] ?? 1)) * 18

  return 30 + pierValue + finalControlBonus + rewardMustEatBonus + forcedDoorBonus + security - damage
}

/**
 * 掷骰评分：当可明打动作会严重破坏最后控制结构时，机器人可以选择掷骰解手。
 */
function scoreRollDice(context: BotDecisionContext): number {
  const openActionScores = context.legalActions
    .filter((action) => action.intent !== 'roll-dice')
    .filter((action) =>
      action.intent === 'lead-open' ||
      action.intent === 'lead-final-open' ||
      action.intent === 'lead-reward-live' ||
      action.intent === 'lead-reward-dead',
    )
    .map((action) => scoreLeadAction(context, action, true))

  if (openActionScores.length === 0) {
    return 120 + countLooseSingles(context.seatState.hand) * 5
  }

  const bestOpenScore = Math.max(...openActionScores)
  const looseSingleBonus = countLooseSingles(context.seatState.hand) * 7
  const endgamePenalty = isEndgame(context) ? 22 : 0

  return 26 + looseSingleBonus - bestOpenScore * 0.28 - endgamePenalty
}

/**
 * 领出评分：优先多墩、强组合、最后一手和已无更大牌可压的安全牌；
 * 同时惩罚早期裸出脑子，避免把最后一墩控制牌提前浪费掉。
 */
function scoreLeadAction(
  context: BotDecisionContext,
  action: PreparedAction,
  ignoreRollDice = false,
): number {
  if (action.intent === 'roll-dice') {
    return ignoreRollDice ? -1000 : scoreRollDice(context)
  }

  const shape = describeAction(context, action)
  const damage = estimateStructureDamage(context, shape.cards)
  const security = estimateLeadSecurity(context, shape)
  const pierValue = estimatePierProgressValue(context.seatState, shape.cardCount)
  const finalLeadBonus =
    action.intent === 'lead-final-open' || shape.cardCount === context.seatState.hand.length
      ? 360
      : 0
  const endgameControlBonus = isEndgame(context, shape.cardCount) ? security * 54 : 0
  const rewardBonus =
    shape.kind === 'reward-live'
      ? estimateLiveRewardLeadScore(context, shape)
      : shape.kind === 'reward-dead'
        ? estimateDeadRewardLeadScore(context, shape)
        : 0
  const comboBonus = shape.kind === 'long-combo' ? shape.cardCount * 16 + shape.strength * 8 : 0
  const pairBonus = shape.kind === 'pair' ? shape.cardCount * 12 + shape.strength * 5 : 0
  const safeSinglesBonus = shape.kind === 'safe-singles' ? shape.cardCount * 28 : 0
  const nakedBrainPenalty =
    shape.kind === 'single' &&
    shape.cards.some((card) => getCardDefinition(card.definitionId).isBrain) &&
    context.seatState.hand.length > 3
      ? 28
      : 0

  return (
    20 +
    pierValue +
    security * 58 +
    finalLeadBonus +
    endgameControlBonus +
    rewardBonus +
    comboBonus +
    pairBonus +
    safeSinglesBonus -
    damage -
    nakedBrainPenalty
  )
}

/**
 * 掷骰后的补牌评分：有定门牌时尽量用低损耗但不太弱的同门牌；
 * 没有定门牌卖屁股时，直接甩掉未来价值最低的一张。
 */
function scoreDiceResolutionAction(
  context: BotDecisionContext,
  action: PreparedAction,
): number {
  const shape = describeAction(context, action)
  const damage = estimateStructureDamage(context, shape.cards)

  if (action.intent === 'resolve-dice-hidden') {
    return 40 - damage
  }

  const security = estimateLeadSecurity(context, shape)
  const endgameBonus = isEndgame(context, shape.cardCount) ? security * 38 : 0

  return 26 + security * 24 + endgameBonus - damage
}

/**
 * 按当前阶段调用对应评分器。保留一个入口，方便后续做不同难度策略。
 */
export function scoreBotAction(context: BotDecisionContext, action: PreparedAction): number {
  if (action.intent === 'respond-eat' || action.intent === 'respond-pass-hidden') {
    return scoreResponseAction(context, action)
  }

  if (action.intent === 'resolve-dice-open' || action.intent === 'resolve-dice-hidden') {
    return scoreDiceResolutionAction(context, action)
  }

  return scoreLeadAction(context, action)
}
