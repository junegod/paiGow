import type { CardDefinition, CardInstance } from '@/rules-core/types'
import { CARD_DEFINITION_MAP } from '@/rules-variants/ji-an-da-suo-zi/cardCatalog'
import {
  LONG_COMBO_RECIPES,
  REWARD_DEFINITION_IDS,
  type ComboRecipe,
} from '@/rules-variants/ji-an-da-suo-zi/patternCatalog'

interface ArrangementCandidate {
  /** 候选分组里的真实牌实例，输出时会保持在一起。 */
  cards: CardInstance[]
  /** 分组类型优先级，数值越小越靠左。 */
  priority: number
  /** 同类分组强度，越大越靠左。 */
  strength: number
  /** 同强度下按牌目录顺序兜底，避免排序结果抖动。 */
  order: number
}

const BRAIN_DEFINITION_ORDER = ['long_tian', 'yao_fu', 'point_nine']
const REWARD_GROUP_PRIORITY = 0
const LONG_COMBO_GROUP_PRIORITY = 1
const PAIR_GROUP_PRIORITY = 2

/**
 * 按定义 id 汇总手牌。每个桶内继续按 copyIndex 排序，
 * 这样同张牌多副本时每次自动整理都会稳定输出。
 */
function groupCardsByDefinition(cards: CardInstance[]): Map<string, CardInstance[]> {
  const groupMap = new Map<string, CardInstance[]>()

  cards.forEach((card) => {
    const groupCards = groupMap.get(card.definitionId) ?? []
    groupCards.push(card)
    groupMap.set(card.definitionId, groupCards)
  })

  groupMap.forEach((groupCards) => {
    groupCards.sort((leftCard, rightCard) => leftCard.copyIndex - rightCard.copyIndex)
  })

  return groupMap
}

/**
 * 按定义 id 从剩余牌中试取一组牌。只读取不修改，
 * 真正移除统一由调用方处理，避免候选比较阶段产生副作用。
 */
function pickCardsByDefinitionIds(
  remainingCards: CardInstance[],
  definitionIds: string[],
): CardInstance[] | null {
  const groupMap = groupCardsByDefinition(remainingCards)
  const usedCountByDefinition = new Map<string, number>()
  const pickedCards: CardInstance[] = []

  for (const definitionId of definitionIds) {
    const usedCount = usedCountByDefinition.get(definitionId) ?? 0
    const card = groupMap.get(definitionId)?.[usedCount]

    if (!card) {
      return null
    }

    usedCountByDefinition.set(definitionId, usedCount + 1)
    pickedCards.push(card)
  }

  return pickedCards
}

/**
 * 从剩余牌里移除已经放入某个分组的牌实例。
 */
function removePickedCards(cards: CardInstance[], pickedCards: CardInstance[]): CardInstance[] {
  const pickedCardIdSet = new Set(pickedCards.map((card) => card.id))

  return cards.filter((card) => !pickedCardIdSet.has(card.id))
}

/**
 * 读取牌定义，缺定义时给一个保守兜底，避免 UI 整理因为脏数据直接崩溃。
 */
function getDefinition(card: CardInstance): CardDefinition {
  return CARD_DEFINITION_MAP[card.definitionId]
}

/**
 * 单张散牌排序强度。脑子已经提前拿走，这里主要让大牌靠左、小牌靠右。
 */
function getSingleSortStrength(card: CardInstance): number {
  const definition = getDefinition(card)

  return definition?.singleStrength ?? 0
}

/**
 * 牌实例稳定排序：先按传入强度，再按牌目录顺序和副本序号兜底。
 */
function sortCardsByStrength(cards: CardInstance[]): CardInstance[] {
  return [...cards].sort((leftCard, rightCard) => {
    const leftDefinition = getDefinition(leftCard)
    const rightDefinition = getDefinition(rightCard)
    const strengthDiff = getSingleSortStrength(rightCard) - getSingleSortStrength(leftCard)

    if (strengthDiff !== 0) {
      return strengthDiff
    }

    const orderDiff = (leftDefinition?.order ?? leftCard.order) - (rightDefinition?.order ?? rightCard.order)

    if (orderDiff !== 0) {
      return orderDiff
    }

    return leftCard.copyIndex - rightCard.copyIndex
  })
}

/**
 * 脑子固定放在最左侧。传统思路里它们都是顶张，
 * 因此不再为了天九等组合把脑子拆到后面。
 */
function takeBrainCards(cards: CardInstance[]): {
  brainCards: CardInstance[]
  remainingCards: CardInstance[]
} {
  const brainCards = cards
    .filter((card) => getDefinition(card)?.isBrain)
    .sort((leftCard, rightCard) => {
      const leftBrainIndex = BRAIN_DEFINITION_ORDER.indexOf(leftCard.definitionId)
      const rightBrainIndex = BRAIN_DEFINITION_ORDER.indexOf(rightCard.definitionId)
      const normalizedLeftIndex = leftBrainIndex >= 0 ? leftBrainIndex : Number.MAX_SAFE_INTEGER
      const normalizedRightIndex = rightBrainIndex >= 0 ? rightBrainIndex : Number.MAX_SAFE_INTEGER

      if (normalizedLeftIndex !== normalizedRightIndex) {
        return normalizedLeftIndex - normalizedRightIndex
      }

      return leftCard.copyIndex - rightCard.copyIndex
    })

  return {
    brainCards,
    remainingCards: removePickedCards(cards, brainCards),
  }
}

/**
 * 生成赏牌候选。三点和六点只有一张，能同时在手上就应该挨着放。
 */
function createRewardCandidate(remainingCards: CardInstance[]): ArrangementCandidate | null {
  const rewardCards = pickCardsByDefinitionIds(remainingCards, REWARD_DEFINITION_IDS)

  if (!rewardCards) {
    return null
  }

  return {
    cards: rewardCards,
    priority: REWARD_GROUP_PRIORITY,
    strength: 100,
    order: 0,
  }
}

/**
 * 根据长门配方生成候选。优先保留四张、三张这类更完整的组合，
 * 用户看牌时能一眼识别“这几张可以一起出”。
 */
function createLongComboCandidates(remainingCards: CardInstance[]): ArrangementCandidate[] {
  return LONG_COMBO_RECIPES
    .map((recipe: ComboRecipe): ArrangementCandidate | null => {
      const recipeCards = pickCardsByDefinitionIds(remainingCards, recipe.definitions)

      if (!recipeCards) {
        return null
      }

      return {
        cards: recipeCards,
        priority: LONG_COMBO_GROUP_PRIORITY,
        strength: recipe.strength * 10 + recipe.definitions.length,
        order: Math.min(...recipeCards.map((card) => getDefinition(card)?.order ?? card.order)),
      }
    })
    .filter((candidate): candidate is ArrangementCandidate => Boolean(candidate))
}

/**
 * 根据同定义两张牌生成对子候选。没有 pairStrength 的丁三、丁六不会生成对子。
 */
function createPairCandidates(remainingCards: CardInstance[]): ArrangementCandidate[] {
  return Array.from(groupCardsByDefinition(remainingCards).entries())
    .map(([definitionId, groupCards]): ArrangementCandidate | null => {
      const definition = CARD_DEFINITION_MAP[definitionId]

      if (!definition?.pairStrength || groupCards.length < 2) {
        return null
      }

      return {
        cards: groupCards.slice(0, 2),
        priority: PAIR_GROUP_PRIORITY,
        strength: definition.pairStrength,
        order: definition.order,
      }
    })
    .filter((candidate): candidate is ArrangementCandidate => Boolean(candidate))
}

/**
 * 从当前剩余牌里挑一个最应该靠左展示的可出分组。
 */
function findBestArrangementCandidate(remainingCards: CardInstance[]): ArrangementCandidate | null {
  const candidates = [
    createRewardCandidate(remainingCards),
    ...createLongComboCandidates(remainingCards),
    ...createPairCandidates(remainingCards),
  ].filter((candidate): candidate is ArrangementCandidate => Boolean(candidate))

  if (candidates.length === 0) {
    return null
  }

  return candidates.sort((leftCandidate, rightCandidate) => {
    const priorityDiff = leftCandidate.priority - rightCandidate.priority

    if (priorityDiff !== 0) {
      return priorityDiff
    }

    const lengthDiff = rightCandidate.cards.length - leftCandidate.cards.length

    if (lengthDiff !== 0) {
      return lengthDiff
    }

    const strengthDiff = rightCandidate.strength - leftCandidate.strength

    if (strengthDiff !== 0) {
      return strengthDiff
    }

    return leftCandidate.order - rightCandidate.order
  })[0]
}

/**
 * 吉安打索子的手牌整理策略：
 * 脑子放最左边，其次把能一起出的赏、长门组合、对子聚在一起，
 * 最后剩余散牌按强弱从左到右排列，让最小的牌自然落在最右侧。
 */
export function arrangeJiAnDaSuoZiHand(cards: CardInstance[]): CardInstance[] {
  const { brainCards, remainingCards: cardsWithoutBrains } = takeBrainCards(cards)
  const arrangedGroups: CardInstance[][] = brainCards.length > 0 ? [brainCards] : []
  let remainingCards = [...cardsWithoutBrains]

  while (remainingCards.length > 0) {
    const candidate = findBestArrangementCandidate(remainingCards)

    if (!candidate) {
      break
    }

    arrangedGroups.push(candidate.cards)
    remainingCards = removePickedCards(remainingCards, candidate.cards)
  }

  return [
    ...arrangedGroups.flat(),
    ...sortCardsByStrength(remainingCards),
  ]
}

/**
 * 对外给 UI 控制器使用的稳定 id 顺序，避免组件关心牌实例排序细节。
 */
export function arrangeJiAnDaSuoZiHandIds(cards: CardInstance[]): string[] {
  return arrangeJiAnDaSuoZiHand(cards).map((card) => card.id)
}
