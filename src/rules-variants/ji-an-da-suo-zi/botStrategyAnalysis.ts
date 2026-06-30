import type {
  BotDecisionContext,
  CardInstance,
  PlayGroup,
  PreparedAction,
  RoundState,
  SeatState,
} from '@/rules-core/types'
import { countBy } from '@/rules-core/collections'
import {
  CARD_DEFINITIONS,
  getCardDefinition,
} from '@/rules-variants/ji-an-da-suo-zi/cardCatalog'
import {
  LONG_COMBO_RECIPES,
  REWARD_DEFINITION_IDS,
} from '@/rules-variants/ji-an-da-suo-zi/patternCatalog'

export type ActionKind =
  | 'single'
  | 'pair'
  | 'reward-live'
  | 'reward-dead'
  | 'long-combo'
  | 'safe-singles'
  | 'dice'
  | 'hidden'
  | 'unknown'

export interface ActionShape {
  /** 当前动作在策略层识别出的粗粒度牌型。 */
  kind: ActionKind
  /** 当前动作会打出的实例牌。 */
  cards: CardInstance[]
  /** 当前动作涉及的牌定义 id，已经按手牌排序。 */
  definitionIds: string[]
  /** 可比较牌型所在比较组；弃牌和掷骰动作没有比较组。 */
  group?: PlayGroup
  /** 当前动作自身的牌力，用于估算能否守住本墩。 */
  strength: number
  /** 当前动作张数，也就是本次可能抢到的墩数。 */
  cardCount: number
}

export const GROUP_MAX_STRENGTH: Partial<Record<PlayGroup, number>> = {
  'long-single': 7,
  'yao-single': 4,
  'point-single': 6,
  'long-pair': 7,
  'yao-pair': 4,
  'point-pair': 4,
  'long-combo-2': 4,
  'long-combo-3': 4,
  'long-combo-4': 4,
  'reward-live': 99,
  'reward-dead': 100,
}

/**
 * 从机器人手牌里还原合法动作使用的实例牌。规则引擎已经校验过合法性，
 * 这里仍做防御式查找，避免未来服务层传入残缺上下文时静默出错。
 */
function getActionCards(hand: CardInstance[], action: PreparedAction): CardInstance[] {
  return action.selectedCardIds.map((selectedCardId) => {
    const card = hand.find((handCard) => handCard.id === selectedCardId)

    if (!card) {
      throw new Error(`机器人动作引用了不存在的手牌 ${selectedCardId}。`)
    }

    return card
  })
}

/**
 * 统计当前机器人已经能确认“别人不可能再拿着”的牌。
 * 公开明牌和自己的手牌都算已知信息；背面弃牌不算，因为当时没人知道牌面。
 */
function countUnavailableDefinitions(round: RoundState, seatState: SeatState): Record<string, number> {
  const faceUpDefinitionIds = [
    ...round.publicTrickLog.flatMap((trick) =>
      trick.plays.flatMap((play) =>
        play.pattern.isOpen
          ? play.cards.map((card) => card.definitionId)
          : [],
      ),
    ),
    ...(round.currentTrick?.plays.flatMap((play) =>
      play.pattern.isOpen
        ? play.cards.map((card) => card.definitionId)
        : [],
    ) ?? []),
    ...seatState.hand.map((card) => card.definitionId),
  ]

  return countBy(faceUpDefinitionIds)
}

/**
 * 判断某个定义的牌是否仍可能在其他玩家手里出现指定数量。
 */
function canOpponentHoldCount(
  definitionId: string,
  requiredCount: number,
  unavailableCount: Record<string, number>,
): boolean {
  const definition = getCardDefinition(definitionId)
  const opponentPossibleCount = definition.count - (unavailableCount[definitionId] ?? 0)
  return opponentPossibleCount >= requiredCount
}

/**
 * 判断某张单牌是否已经没有更大的对手牌能压住。
 */
function isSingleUnbeatable(
  definitionId: string,
  unavailableCount: Record<string, number>,
): boolean {
  const definition = getCardDefinition(definitionId)
  const singleStrength = definition.singleStrength ?? 0

  if (!singleStrength) {
    return false
  }

  return CARD_DEFINITIONS
    .filter((candidate) =>
      candidate.door === definition.door &&
      (candidate.singleStrength ?? 0) > singleStrength,
    )
    .every((candidate) => !canOpponentHoldCount(candidate.id, 1, unavailableCount))
}

/**
 * 判断某个对子是否已经没有更大的对手对子能压住。
 */
function isPairUnbeatable(
  definitionId: string,
  unavailableCount: Record<string, number>,
): boolean {
  const definition = getCardDefinition(definitionId)
  const pairStrength = definition.pairStrength ?? 0

  if (!pairStrength) {
    return false
  }

  return CARD_DEFINITIONS
    .filter((candidate) =>
      candidate.door === definition.door &&
      (candidate.pairStrength ?? 0) > pairStrength,
    )
    .every((candidate) => !canOpponentHoldCount(candidate.id, 2, unavailableCount))
}

/**
 * 判断更大的长门组合是否还可能被对手凑出来。
 */
function canOpponentMakeCombo(
  definitionIds: string[],
  unavailableCount: Record<string, number>,
): boolean {
  const recipeCount = countBy(definitionIds)
  return Object.entries(recipeCount).every(([definitionId, requiredCount]) =>
    canOpponentHoldCount(definitionId, requiredCount, unavailableCount),
  )
}

/**
 * 判断当前长门组合是否已经没有更大的组合可压。
 */
function isLongComboUnbeatable(shape: ActionShape, unavailableCount: Record<string, number>): boolean {
  if (!shape.group || !shape.group.startsWith('long-combo')) {
    return false
  }

  return LONG_COMBO_RECIPES
    .filter((recipe) => recipe.group === shape.group && recipe.strength > shape.strength)
    .every((recipe) => !canOpponentMakeCombo(recipe.definitions, unavailableCount))
}

/**
 * 识别一个合法动作的大致牌型。这里不重新判定合法性，只把合法动作转成策略可读的信息。
 */
export function describeAction(context: BotDecisionContext, action: PreparedAction): ActionShape {
  const cards = getActionCards(context.seatState.hand, action)
  const definitionIds = cards.map((card) => card.definitionId)
  const cardCount = cards.length

  if (action.intent === 'roll-dice') {
    return {
      kind: 'dice',
      cards,
      definitionIds,
      strength: 0,
      cardCount: 0,
    }
  }

  if (action.intent === 'respond-pass-hidden' || action.intent === 'resolve-dice-hidden') {
    return {
      kind: 'hidden',
      cards,
      definitionIds,
      strength: 0,
      cardCount,
    }
  }

  if (action.intent === 'lead-reward-live') {
    return {
      kind: 'reward-live',
      cards,
      definitionIds,
      group: 'reward-live',
      strength: 99,
      cardCount,
    }
  }

  if (action.intent === 'lead-reward-dead') {
    return {
      kind: 'reward-dead',
      cards,
      definitionIds,
      group: 'reward-dead',
      strength: 100,
      cardCount,
    }
  }

  if (cardCount === 1) {
    const [definitionId] = definitionIds
    const definition = getCardDefinition(definitionId)

    return {
      kind: 'single',
      cards,
      definitionIds,
      group: `${definition.door}-single` as PlayGroup,
      strength: definition.singleStrength ?? 0,
      cardCount,
    }
  }

  if (cardCount === 2 && definitionIds[0] === definitionIds[1]) {
    const definition = getCardDefinition(definitionIds[0])

    return {
      kind: 'pair',
      cards,
      definitionIds,
      group: `${definition.door}-pair` as PlayGroup,
      strength: definition.pairStrength ?? 0,
      cardCount,
    }
  }

  const matchedCombo = LONG_COMBO_RECIPES.find((recipe) => {
    if (recipe.definitions.length !== definitionIds.length) {
      return false
    }

    const recipeCount = countBy(recipe.definitions)
    const actionCount = countBy(definitionIds)
    return Object.entries(recipeCount).every(
      ([definitionId, requiredCount]) => actionCount[definitionId] === requiredCount,
    )
  })

  if (matchedCombo) {
    return {
      kind: 'long-combo',
      cards,
      definitionIds,
      group: matchedCombo.group,
      strength: matchedCombo.strength,
      cardCount,
    }
  }

  if (cardCount > 1 && action.intent === 'lead-open') {
    return {
      kind: 'safe-singles',
      cards,
      definitionIds,
      group: 'safe-singles',
      strength: cards.reduce(
        (total, card) => total + (getCardDefinition(card.definitionId).singleStrength ?? 0),
        0,
      ),
      cardCount,
    }
  }

  return {
    kind: 'unknown',
    cards,
    definitionIds,
    strength: 0,
    cardCount,
  }
}

/**
 * 计算一手牌里对子、赏、长门组合和最后控制牌的综合潜力。
 * 机器人比较动作时会用“出牌前潜力 - 出牌后潜力”衡量这步有多伤结构。
 */
function estimateHandPotential(
  round: RoundState,
  seatState: SeatState,
  cards: CardInstance[],
): number {
  const definitionCount = countBy(cards.map((card) => card.definitionId))
  const unavailableCount = countUnavailableDefinitions(round, {
    ...seatState,
    hand: cards,
  })

  const singlePotential = cards.reduce((total, card) => {
    const definition = getCardDefinition(card.definitionId)
    const strength = definition.singleStrength ?? 0
    const brainBonus = definition.isBrain ? 16 : 0
    const safetyBonus = isSingleUnbeatable(definition.id, unavailableCount) ? 10 : 0
    return total + strength * 1.8 + brainBonus + safetyBonus
  }, 0)

  const pairPotential = Object.entries(definitionCount).reduce((total, [definitionId, count]) => {
    if (count < 2) {
      return total
    }

    const definition = getCardDefinition(definitionId)
    const pairStrength = definition.pairStrength ?? 0

    if (!pairStrength) {
      return total
    }

    const topPairBonus = isPairUnbeatable(definitionId, unavailableCount) ? 18 : 0
    return total + pairStrength * 8 + 18 + topPairBonus
  }, 0)

  const rewardPotential = REWARD_DEFINITION_IDS.every((definitionId) => definitionCount[definitionId])
    ? 34
    : 0

  const comboPotential = LONG_COMBO_RECIPES.reduce((total, recipe) => {
    const recipeCount = countBy(recipe.definitions)
    const hasRecipe = Object.entries(recipeCount).every(
      ([definitionId, requiredCount]) => (definitionCount[definitionId] ?? 0) >= requiredCount,
    )

    if (!hasRecipe) {
      return total
    }

    const shape: ActionShape = {
      kind: 'long-combo',
      cards: [],
      definitionIds: recipe.definitions,
      group: recipe.group,
      strength: recipe.strength,
      cardCount: recipe.definitions.length,
    }
    const topComboBonus = isLongComboUnbeatable(shape, unavailableCount) ? 20 : 0
    return total + recipe.definitions.length * 10 + recipe.strength * 12 + topComboBonus
  }, 0)

  return singlePotential + pairPotential + rewardPotential + comboPotential
}

/**
 * 估算选中这些牌会破坏多少后续潜力。越接近最后一手，控制牌越不能乱花。
 */
export function estimateStructureDamage(
  context: BotDecisionContext,
  selectedCards: CardInstance[],
): number {
  const selectedCardIdSet = new Set(selectedCards.map((card) => card.id))
  const remainingCards = context.seatState.hand.filter((card) => !selectedCardIdSet.has(card.id))
  const beforePotential = estimateHandPotential(context.round, context.seatState, context.seatState.hand)
  const afterPotential = estimateHandPotential(context.round, context.seatState, remainingCards)
  const remainingCardCount = remainingCards.length
  const endgameMultiplier = remainingCardCount <= 3 ? 1.35 : remainingCardCount <= 5 ? 1.15 : 1

  return Math.max(0, beforePotential - afterPotential) * endgameMultiplier
}

/**
 * 计算这手牌主动打出后大概率能否守住。分数越高，越像“能拿墩并拿到下一手”。
 */
export function estimateLeadSecurity(context: BotDecisionContext, shape: ActionShape): number {
  const unavailableCount = countUnavailableDefinitions(context.round, context.seatState)

  if (shape.kind === 'reward-dead' || shape.kind === 'safe-singles') {
    return 1
  }

  if (shape.kind === 'reward-live') {
    return 0.55
  }

  if (shape.kind === 'single') {
    const definition = getCardDefinition(shape.definitionIds[0])
    return definition.isBrain || isSingleUnbeatable(definition.id, unavailableCount)
      ? 1
      : Math.min(0.85, shape.strength / (GROUP_MAX_STRENGTH[shape.group ?? 'hidden'] ?? 7))
  }

  if (shape.kind === 'pair') {
    const definitionId = shape.definitionIds[0]
    return isPairUnbeatable(definitionId, unavailableCount)
      ? 1
      : Math.min(0.9, shape.strength / (GROUP_MAX_STRENGTH[shape.group ?? 'hidden'] ?? 7))
  }

  if (shape.kind === 'long-combo') {
    return isLongComboUnbeatable(shape, unavailableCount)
      ? 1
      : Math.min(0.9, shape.strength / (GROUP_MAX_STRENGTH[shape.group ?? 'hidden'] ?? 4))
  }

  return 0.3
}

/**
 * 当前是否已经进入必须考虑最后一墩控制权的阶段。
 */
export function isEndgame(context: BotDecisionContext, selectedCardCount = 0): boolean {
  const remainingAfterAction = context.seatState.hand.length - selectedCardCount
  return remainingAfterAction <= 3 || context.round.publicTrickLog.length >= 5
}

/**
 * 估算当前动作拿下以后，对该玩家基础墩数收益的影响。
 * 4 墩是保本线，所以从 3 到 4、4 到 5 的价值比纯早期抢 1 墩更高。
 */
export function estimatePierProgressValue(seatState: SeatState, gainedPierCount: number): number {
  const beforeDistance = Math.abs(4 - seatState.wonPierCount)
  const afterDistance = Math.abs(4 - (seatState.wonPierCount + gainedPierCount))
  const crossingSafeLineBonus = seatState.wonPierCount < 4 && seatState.wonPierCount + gainedPierCount >= 4
    ? 18
    : 0

  return gainedPierCount * 18 + Math.max(0, beforeDistance - afterDistance) * 6 + crossingSafeLineBonus
}

/**
 * 计算手牌里没有成型结构的散牌数量。散牌越多，领出时越适合用骰子拆局。
 */
export function countLooseSingles(hand: CardInstance[]): number {
  const definitionCount = countBy(hand.map((card) => card.definitionId))
  const comboDefinitionIdSet = new Set(
    LONG_COMBO_RECIPES.flatMap((recipe) => recipe.definitions),
  )

  return hand.filter((card) => {
    if (definitionCount[card.definitionId] >= 2) {
      return false
    }

    if (REWARD_DEFINITION_IDS.includes(card.definitionId)) {
      return false
    }

    return !comboDefinitionIdSet.has(card.definitionId)
  }).length
}
