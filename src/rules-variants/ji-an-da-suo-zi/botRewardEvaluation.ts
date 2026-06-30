import type { BotDecisionContext } from '@/rules-core/types'
import { countBy } from '@/rules-core/collections'
import { getCardDefinition } from '@/rules-variants/ji-an-da-suo-zi/cardCatalog'
import type { ActionShape } from '@/rules-variants/ji-an-da-suo-zi/botStrategyAnalysis'
import { LIVE_REWARD_EATERS } from '@/rules-variants/ji-an-da-suo-zi/patternCatalog'

/**
 * 活赏未被吃时，每个对手需要出的赏钱。最后两张赏更贵，
 * 所以机器人必须把“最后两张打活赏”当成高价值机会，而不是只看能否保底拿墩。
 */
const LIVE_REWARD_VALUE_PER_OPPONENT = {
  normal: 2,
  lastTwo: 4,
} as const

/**
 * 吃赏对子对机器人造成的威胁权重。这里只使用公开明牌和自己手牌推断，
 * 不偷看其他玩家暗手牌；九、七、五任意对子都能吃活赏，但高点对子更影响最后控制权。
 */
const LIVE_REWARD_EATER_RISK_WEIGHT: Record<string, number> = {
  point_nine: 0.28,
  point_seven: 0.24,
  point_five: 0.2,
}

/**
 * 判断当前动作是不是赏。策略层会把活赏和死赏放在同一套收益模型下比较。
 */
function isRewardShape(shape: ActionShape): boolean {
  return shape.kind === 'reward-live' || shape.kind === 'reward-dead'
}

/**
 * 统计机器人可以确认“对手不再可能拿着”的牌面。
 * 明面出过的牌和机器人自己的手牌都算已知；背面弃牌不能算，因为桌上玩家并不知道牌面。
 */
function countKnownUnavailableDefinitions(context: BotDecisionContext): Record<string, number> {
  const currentOpenDefinitionIds =
    context.round.currentTrick?.plays.flatMap((play) =>
      play.pattern.isOpen ? play.cards.map((card) => card.definitionId) : [],
    ) ?? []
  const historyOpenDefinitionIds = context.round.publicTrickLog.flatMap((trick) =>
    trick.plays.flatMap((play) =>
      play.pattern.isOpen ? play.cards.map((card) => card.definitionId) : [],
    ),
  )
  const ownDefinitionIds = context.seatState.hand.map((card) => card.definitionId)

  return countBy([
    ...historyOpenDefinitionIds,
    ...currentOpenDefinitionIds,
    ...ownDefinitionIds,
  ])
}

/**
 * 判断某个吃赏对子是否仍有可能藏在对手手里。
 * 牌面一共只有两张，只要公开信息或自己手牌已经见过任意一张，该对子就不可能完整存在。
 */
function canOpponentStillHoldPair(
  definitionId: string,
  unavailableCount: Record<string, number>,
): boolean {
  const definition = getCardDefinition(definitionId)
  return definition.count - (unavailableCount[definitionId] ?? 0) >= 2
}

/**
 * 估算仍有几家能拿两张牌来吃赏。到最后阶段若某家只剩 0 或 1 张，
 * 它已经没有能力拿对子吃活赏，风险会自然下降。
 */
function estimateEligibleEaterSeatFactor(context: BotDecisionContext): number {
  const eligibleSeatCount = context.round.seats.filter(
    (seatState) => seatState.seat !== context.seat && seatState.hand.length >= 2,
  ).length

  return eligibleSeatCount / 3
}

/**
 * 判断这次赏是不是最后两张牌。最后两张活赏是明显的收益点：
 * 不仅每家赏钱翻倍，还经常关系到最后一墩控制权。
 */
export function isLastTwoRewardAction(
  context: BotDecisionContext,
  shape: ActionShape,
): boolean {
  return isRewardShape(shape) && shape.cardCount === 2 && context.seatState.hand.length === 2
}

/**
 * 估算活赏被吃的风险分。这个分只做扣分参考，不会压过最后两张活赏的核心收益，
 * 否则机器人会过度保守，变成“见赏就死赏”。
 */
export function estimateLiveRewardEatRiskScore(
  context: BotDecisionContext,
  shape: ActionShape,
): number {
  if (shape.kind !== 'reward-live') {
    return 0
  }

  const unavailableCount = countKnownUnavailableDefinitions(context)
  const possibleEaterWeight = LIVE_REWARD_EATERS.reduce((total, definitionId) => {
    if (!canOpponentStillHoldPair(definitionId, unavailableCount)) {
      return total
    }

    return total + (LIVE_REWARD_EATER_RISK_WEIGHT[definitionId] ?? 0.18)
  }, 0)
  const lastTwoDiscount = isLastTwoRewardAction(context, shape) ? 0.62 : 1

  return Math.round(
    possibleEaterWeight * estimateEligibleEaterSeatFactor(context) * 76 * lastTwoDiscount,
  )
}

/**
 * 估算打出赏以后，在当前墩数局势里的额外价值。
 * 这里不是重复算基础墩数，而是强调从 3 到 4 保本、从 4 到 5 进分、冲 7/8 墩时的节奏价值。
 */
function estimateRewardPierPressureScore(
  context: BotDecisionContext,
  shape: ActionShape,
): number {
  const beforePierCount = context.seatState.wonPierCount
  const afterPierCount = beforePierCount + shape.cardCount
  const safeLineScore = beforePierCount < 4 && afterPierCount >= 4 ? 34 : 0
  const profitLineScore = beforePierCount < 5 && afterPierCount >= 5 ? 28 : 0
  const collectorScore = afterPierCount >= 8
    ? 86
    : afterPierCount >= 7
      ? 48
      : 0

  return safeLineScore + profitLineScore + collectorScore
}

/**
 * 活赏收益评分。普通活赏按每家 2 个赏钱建模，最后两张按每家 4 个赏钱建模；
 * 最后一手额外加权，确保机器人知道最后两张赏比普通两墩更值钱。
 */
export function estimateLiveRewardLeadScore(
  context: BotDecisionContext,
  shape: ActionShape,
): number {
  if (shape.kind !== 'reward-live') {
    return 0
  }

  const isLastTwo = isLastTwoRewardAction(context, shape)
  const rewardValuePerOpponent = isLastTwo
    ? LIVE_REWARD_VALUE_PER_OPPONENT.lastTwo
    : LIVE_REWARD_VALUE_PER_OPPONENT.normal
  const rewardMoneyScore = rewardValuePerOpponent * 3 * 24
  const lastTwoScore = isLastTwo ? 248 : 0
  const pressureScore = estimateRewardPierPressureScore(context, shape)
  const eatRiskScore = estimateLiveRewardEatRiskScore(context, shape)

  return rewardMoneyScore + lastTwoScore + pressureScore - eatRiskScore
}

/**
 * 死赏只保留“稳拿不被吃”的战术价值，但明确扣掉没有赏钱的机会成本。
 * 特别是最后两张牌，死赏会浪费翻倍赏钱，所以必须被强烈压低。
 */
export function estimateDeadRewardLeadScore(
  context: BotDecisionContext,
  shape: ActionShape,
): number {
  if (shape.kind !== 'reward-dead') {
    return 0
  }

  const matchingLiveShape: ActionShape = {
    ...shape,
    kind: 'reward-live',
    group: 'reward-live',
    strength: 99,
  }
  const riskCompensation = Math.min(
    22,
    estimateLiveRewardEatRiskScore(context, matchingLiveShape) * 0.35,
  )
  const lastTwoPenalty = isLastTwoRewardAction(context, shape) ? 230 : 0

  return riskCompensation - 42 - lastTwoPenalty
}
