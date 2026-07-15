import type {
  BotDecisionContext,
  CardDefinition,
} from '@/rules-core/types'
import { countBy } from '@/rules-core/collections'
import {
  CARD_DEFINITIONS,
  getCardDefinition,
} from '@/rules-variants/ji-an-da-suo-zi/cardCatalog'
import type { ActionShape } from '@/rules-variants/ji-an-da-suo-zi/botStrategyAnalysis'
import {
  LIVE_REWARD_EATERS,
  LONG_COMBO_RECIPES,
} from '@/rules-variants/ji-an-da-suo-zi/patternCatalog'

/** 专家档每个候选动作使用的未知牌分布抽样次数。 */
const EXPERT_SIMULATION_COUNT = 64

/**
 * 根据自己手牌和桌面明牌统计已知不可再分配给对手的牌。
 * 背面弃牌不在这里扣除，因为机器人并不知道其真实牌面。
 */
function countKnownDefinitions(context: BotDecisionContext): Record<string, number> {
  const historyDefinitions = context.observation.round.publicTrickLog.flatMap((trick) =>
    trick.plays.flatMap((play) => play.publicCards.map((card) => card.definitionId)),
  )
  const currentDefinitions =
    context.observation.round.currentTrick?.plays.flatMap((play) =>
      play.publicCards.map((card) => card.definitionId),
    ) ?? []
  const ownDefinitions = context.observation.self.hand.map((card) => card.definitionId)

  return countBy([...historyDefinitions, ...currentDefinitions, ...ownDefinitions])
}

/**
 * 构造仍然未知的牌池。牌池同时包含对手当前手牌和已经背面弃出的牌，
 * 抽样时只按对手剩余张数取牌，剩余部分自然视为未知弃牌。
 */
function createUnknownDefinitionPool(context: BotDecisionContext): string[] {
  const knownCount = countKnownDefinitions(context)

  return CARD_DEFINITIONS.flatMap((definition) => {
    const remainingCount = Math.max(0, definition.count - (knownCount[definition.id] ?? 0))
    return Array.from({ length: remainingCount }, () => definition.id)
  })
}

/** 为专家抽样构造只依赖公开局面和自己手牌的稳定种子。 */
function createSimulationSeed(context: BotDecisionContext, shape: ActionShape): number {
  const value = [
    context.observation.seat,
    context.observation.round.roundNumber,
    context.observation.round.currentTrick?.trickIndex ?? 0,
    context.observation.round.currentTrick?.plays.length ?? 0,
    context.observation.self.hand.map((card) => card.id).sort().join('|'),
    shape.kind,
    shape.definitionIds.join('|'),
  ].join('#')
  let hash = 2166136261

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }

  return hash >>> 0
}

/** 创建可复现的轻量伪随机源，保证固定牌局的专家决策可以稳定测试。 */
function createDeterministicRandom(seed: number): () => number {
  let state = seed || 0x6d2b79f5

  return () => {
    state += 0x6d2b79f5
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

/** 使用局部随机源复制并打乱未知牌池，不能修改共享数组。 */
function shuffleDefinitions(definitionIds: string[], random: () => number): string[] {
  const shuffled = [...definitionIds]

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const targetIndex = Math.floor(random() * (index + 1))
    const current = shuffled[index]
    shuffled[index] = shuffled[targetIndex]
    shuffled[targetIndex] = current
  }

  return shuffled
}

/** 判断某张定义牌是否能以同门单张压过当前候选动作。 */
function canSingleBeat(definition: CardDefinition, shape: ActionShape): boolean {
  const shapeDefinition = getCardDefinition(shape.definitionIds[0])
  return (
    definition.door === shapeDefinition.door &&
    (definition.singleStrength ?? 0) > shape.strength
  )
}

/** 判断一手抽样牌能否组成同门更大对子。 */
function canPairBeat(definitionCount: Record<string, number>, shape: ActionShape): boolean {
  const shapeDefinition = getCardDefinition(shape.definitionIds[0])

  return CARD_DEFINITIONS.some((definition) =>
    definition.door === shapeDefinition.door &&
    (definition.pairStrength ?? 0) > shape.strength &&
    (definitionCount[definition.id] ?? 0) >= 2,
  )
}

/** 判断一手抽样牌能否组成相同张数但更大的长门组合。 */
function canLongComboBeat(definitionCount: Record<string, number>, shape: ActionShape): boolean {
  return LONG_COMBO_RECIPES
    .filter((recipe) => recipe.group === shape.group && recipe.strength > shape.strength)
    .some((recipe) => {
      const recipeCount = countBy(recipe.definitions)
      return Object.entries(recipeCount).every(
        ([definitionId, requiredCount]) =>
          (definitionCount[definitionId] ?? 0) >= requiredCount,
      )
    })
}

/** 判断一手抽样牌是否拥有九、七、五对子之一，可以吃当前活赏。 */
function canEatLiveReward(definitionCount: Record<string, number>): boolean {
  return LIVE_REWARD_EATERS.some(
    (definitionId) => (definitionCount[definitionId] ?? 0) >= 2,
  )
}

/** 判断抽样得到的某家手牌是否能压过候选动作。 */
function canSampledHandBeat(handDefinitionIds: string[], shape: ActionShape): boolean {
  const definitionCount = countBy(handDefinitionIds)

  if (shape.kind === 'reward-live') {
    return canEatLiveReward(definitionCount)
  }

  if (shape.kind === 'single') {
    return handDefinitionIds.some((definitionId) =>
      canSingleBeat(getCardDefinition(definitionId), shape),
    )
  }

  if (shape.kind === 'pair') {
    return canPairBeat(definitionCount, shape)
  }

  if (shape.kind === 'long-combo') {
    return canLongComboBeat(definitionCount, shape)
  }

  return false
}

/**
 * 读取候选动作之后仍有权响应的对手。已经在当前墩出过牌的人不能再次响应，
 * 领出阶段则三位对手都需要纳入风险抽样。
 */
function getFutureRespondingSeatIds(context: BotDecisionContext): Set<number> {
  const playedSeatIds = new Set(
    context.observation.round.currentTrick?.plays.map((play) => play.seat) ?? [],
  )

  return new Set(
    context.observation.opponents
      .filter((opponent) => !playedSeatIds.has(opponent.seat))
      .map((opponent) => opponent.seat),
  )
}

/**
 * 通过未知牌池随机分配估算动作守住本墩的概率。
 * 模拟只使用自己手牌、明牌历史、对手剩余张数和规则牌目录，不读取真实暗牌。
 *
 * @param context 当前脱敏机器人上下文。
 * @param shape 当前候选动作摘要。
 * @returns 0 到 1 之间的预计守墩概率。
 */
export function estimateExpertHoldProbability(
  context: BotDecisionContext,
  shape: ActionShape,
): number {
  if (shape.kind === 'reward-dead' || shape.kind === 'safe-singles') {
    return 1
  }

  if (!['single', 'pair', 'long-combo', 'reward-live'].includes(shape.kind)) {
    return 0.5
  }

  const respondingSeatIds = getFutureRespondingSeatIds(context)

  if (respondingSeatIds.size === 0) {
    return 1
  }

  const unknownPool = createUnknownDefinitionPool(context)
  const random = createDeterministicRandom(createSimulationSeed(context, shape))
  let holdCount = 0

  for (let simulationIndex = 0; simulationIndex < EXPERT_SIMULATION_COUNT; simulationIndex += 1) {
    const shuffledPool = shuffleDefinitions(unknownPool, random)
    let cursor = 0
    let wasBeaten = false

    for (const opponent of context.observation.opponents) {
      const sampledHand = shuffledPool.slice(cursor, cursor + opponent.remainingCardCount)
      cursor += opponent.remainingCardCount

      if (respondingSeatIds.has(opponent.seat) && canSampledHandBeat(sampledHand, shape)) {
        wasBeaten = true
        break
      }
    }

    if (!wasBeaten) {
      holdCount += 1
    }
  }

  return holdCount / EXPERT_SIMULATION_COUNT
}
