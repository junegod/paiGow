import {
  advanceSeat,
  countBy,
  createStableId,
  getCombinations,
  groupCardsByDefinition,
  nextSeat,
} from '@/rules-core/collections'
import type {
  ActionResult,
  CardInstance,
  CurrentTrickState,
  DiceCeremony,
  DiceRoll,
  DoorId,
  EventLogEntry,
  MatchState,
  PendingDiceChoice,
  PlayGroup,
  PlayPattern,
  PreparedAction,
  RandomSource,
  RewardMode,
  RoundState,
  SeatConfig,
  SeatId,
  SeatState,
  SelectionPreview,
  StartRoundOptions,
  TurnAction,
} from '@/rules-core/types'
import {
  CARD_DEFINITIONS,
  createDeck,
  DEFAULT_SEAT_CONFIGS,
  getCardDefinition,
  sortCardInstances,
} from '@/rules-variants/ji-an-da-suo-zi/cardCatalog'
import {
  LIVE_REWARD_EATERS,
  LONG_COMBO_FOUR_RECIPES,
  LONG_COMBO_RECIPES,
  LONG_COMBO_THREE_RECIPES,
  LONG_COMBO_TWO_RECIPES,
  REWARD_DEFINITION_IDS,
} from '@/rules-variants/ji-an-da-suo-zi/patternCatalog'
import { calculateSettlement } from '@/rules-variants/ji-an-da-suo-zi/scoring'

const DICE_TO_DOOR: Record<string, 'long' | 'yao' | 'point'> = {
  '11': 'long',
  '13': 'long',
  '22': 'long',
  '33': 'long',
  '44': 'long',
  '55': 'long',
  '66': 'long',
  '15': 'yao',
  '16': 'yao',
  '46': 'yao',
  '56': 'yao',
}

/**
 * 规则实现版本号。开发期热更新后若旧 mock 实例仍在浏览器内存中，
 * UI 会用该版本号丢弃旧局，避免旧规则继续自动走牌。
 */
export const RULE_ENGINE_REVISION = '2026-06-29-fixed-player-view-v1'

const CARDS_PER_SEAT = 8

interface OpenSelectionOptions {
  /** 首回合首次领出允许任意单张。 */
  allowAnySingle?: boolean
  /** 当前已经确认没有更大明牌能压住的单张定义。 */
  safeSingleDefinitionIds?: ReadonlySet<string>
}

/**
 * 使用完整规则创建大厅初始态。
 */
export function createInitialMatch(
  seed: number,
  seatConfigs: SeatConfig[] = DEFAULT_SEAT_CONFIGS,
): MatchState {
  return {
    matchId: createStableId('match', [seed]),
    ruleSetId: 'ji-an-da-suo-zi',
    seed,
    phase: 'lobby',
    seatConfigs: seatConfigs.map((seatConfig) => ({ ...seatConfig })),
    roundNumber: 0,
    currentRound: null,
    lastRoundLastTrickWinner: null,
    replayRounds: [],
  }
}

/**
 * 获取某位玩家当前运行态。
 */
export function getSeatState(round: RoundState, seat: SeatId): SeatState {
  const seatState = round.seats.find((item) => item.seat === seat)

  if (!seatState) {
    throw new Error(`未找到座位 ${seat} 的状态。`)
  }

  return seatState
}

/**
 * 将实例 id 还原为玩家当前手中的具体牌。
 */
function getSelectedCards(seatState: SeatState, selectedCardIds: string[]): CardInstance[] {
  const selectedCards = selectedCardIds.map((selectedCardId) => {
    const matchedCard = seatState.hand.find((card) => card.id === selectedCardId)

    if (!matchedCard) {
      throw new Error(`座位 ${seatState.seat} 试图使用不存在的手牌 ${selectedCardId}。`)
    }

    return matchedCard
  })

  const uniqueCardIds = new Set(selectedCardIds)

  if (uniqueCardIds.size !== selectedCardIds.length) {
    throw new Error('同一张牌不能重复提交。')
  }

  return sortCardInstances(selectedCards)
}

/**
 * 统一生成事件流记录。
 */
function pushEvent(
  round: RoundState,
  tone: EventLogEntry['tone'],
  message: string,
  trickIndex?: number,
): void {
  round.eventLog.push({
    id: createStableId('event', [round.roundNumber, round.eventLog.length + 1]),
    tone,
    message,
    trickIndex,
  })
}

/**
 * 将若干牌名拼成易读文本。
 */
function formatCardsLabel(cards: CardInstance[]): string {
  return cards
    .map((card) => getCardDefinition(card.definitionId).shortName)
    .join('')
}

/**
 * 统计选择牌的定义序列，并按规则顺序排序。
 */
function getDefinitionIds(cards: CardInstance[]): string[] {
  return cards.map((card) => card.definitionId).sort((leftId, rightId) => {
    const leftOrder = getCardDefinition(leftId).order
    const rightOrder = getCardDefinition(rightId).order
    return leftOrder - rightOrder
  })
}

/**
 * 检查一组牌是否满足某个固定配方。
 */
function matchesRecipe(cards: CardInstance[], definitionIds: string[]): boolean {
  const selectedDefinitionIds = getDefinitionIds(cards)
  return (
    selectedDefinitionIds.length === definitionIds.length &&
    selectedDefinitionIds.every((definitionId, index) => definitionId === definitionIds[index])
  )
}

/**
 * 构造标准明牌牌型。
 */
function createPattern(
  cards: CardInstance[],
  options: {
    id: string
    label: string
    kind: PlayPattern['kind']
    group: PlayGroup
    strength: number
    note: string
    source: PlayPattern['source']
    door?: PlayPattern['door']
    rewardMode?: RewardMode
    isOpen?: boolean
  },
): PlayPattern {
  return {
    id: options.id,
    label: options.label,
    kind: options.kind,
    group: options.group,
    cardDefinitionIds: getDefinitionIds(cards),
    cardInstanceIds: cards.map((card) => card.id),
    cardCount: cards.length,
    strength: options.strength,
    isOpen: options.isOpen ?? true,
    source: options.source,
    note: options.note,
    door: options.door,
    rewardMode: options.rewardMode,
  }
}

/**
 * 弃牌只有张数和所属玩家公开，直到整局结束后才翻牌。
 * source 用来区分普通弃牌与掷骰无门后的卖屁股弃牌。
 */
function createHiddenPattern(
  cards: CardInstance[],
  note: string,
  source: PlayPattern['source'] = 'hidden',
): PlayPattern {
  return createPattern(cards, {
    id: createStableId('hidden', [formatCardsLabel(cards), cards.length]),
    label: `弃牌 ${cards.length} 张`,
    kind: 'single',
    group: 'hidden',
    strength: 0,
    note,
    source,
    isOpen: false,
  })
}

/**
 * 判断当前是否进入“最后一手候选”领出场景。真正能否一次性出完，
 * 还必须继续检查全部剩牌是否正好组成合法明牌型。
 */
function isFinalLeadHand(seatState: SeatState): boolean {
  return seatState.hand.length > 0 && seatState.hand.length <= 4
}

/**
 * 最后一手必须一次性使用当前玩家全部剩余手牌，避免误点子集后破坏规则节奏。
 */
function selectsEntireRemainingHand(
  seatState: SeatState,
  selectedCardIds: string[],
): boolean {
  if (selectedCardIds.length !== seatState.hand.length) {
    return false
  }

  const selectedCardIdSet = new Set(selectedCardIds)
  return seatState.hand.every((card) => selectedCardIdSet.has(card.id))
}

/**
 * 判断两个选牌集合是否完全一致。拖动排序会改变前端传入顺序，
 * 因此这里不能依赖字符串顺序比较。
 */
function selectedCardIdsMatch(leftCardIds: string[], rightCardIds: string[]): boolean {
  if (leftCardIds.length !== rightCardIds.length) {
    return false
  }

  const rightCardIdSet = new Set(rightCardIds)
  return leftCardIds.every((cardId) => rightCardIdSet.has(cardId))
}

/**
 * 统计已经明面出现过的牌。弃牌虽然整局结束会翻开，
 * 但打出当时不是公开信息，所以不能用于“见过更大牌”的提速判断。
 */
function countFaceUpDefinitions(round: RoundState): Record<string, number> {
  const faceUpDefinitionIds = [
    ...round.publicTrickLog.flatMap((trick) =>
      trick.plays.flatMap((play) => play.pattern.isOpen
        ? play.cards.map((card) => card.definitionId)
        : []),
    ),
    ...(round.currentTrick?.plays.flatMap((play) => play.pattern.isOpen
      ? play.cards.map((card) => card.definitionId)
      : []) ?? []),
  ]

  return countBy(faceUpDefinitionIds)
}

/**
 * 判断某张单牌在本次明出后是否已经没有更大牌可压。
 * 计算时把本次准备明出的牌也算作公开牌，因为它们会同时牌面朝上。
 */
function isSingleSafeAfterOpen(
  round: RoundState,
  definitionId: string,
  selectedCards: CardInstance[],
): boolean {
  const definition = getCardDefinition(definitionId)

  if (!definition.singleStrength) {
    return false
  }

  const selectedSingleStrength = definition.singleStrength
  const visibleCounts = countFaceUpDefinitions(round)
  const selectedCounts = countBy(selectedCards.map((card) => card.definitionId))

  return CARD_DEFINITIONS
    .filter((candidate) =>
      candidate.door === definition.door &&
      (candidate.singleStrength ?? 0) > selectedSingleStrength,
    )
    .every((candidate) =>
      (visibleCounts[candidate.id] ?? 0) + (selectedCounts[candidate.id] ?? 0) >= candidate.count,
    )
}

/**
 * 为一次领出构建明牌识别上下文。普通脑子天然安全；
 * 非脑子必须在所有更大单张都已明面出现后才可作为提速单张。
 */
function createLeadOpenSelectionOptions(
  round: RoundState,
  selectedCards: CardInstance[],
  allowAnySingle = false,
): OpenSelectionOptions {
  const safeSingleDefinitionIds = new Set(
    selectedCards
      .map((card) => card.definitionId)
      .filter((definitionId) => isSingleSafeAfterOpen(round, definitionId, selectedCards)),
  )

  return {
    allowAnySingle,
    safeSingleDefinitionIds,
  }
}

/**
 * 整局第一回合的第一位领出者有额外自由度：除常规可明打牌型外，
 * 还可以任意明出一张单牌。
 */
function isOpeningLead(round: RoundState): boolean {
  return !round.pendingDice && !round.currentTrick && round.publicTrickLog.length === 0
}

/**
 * 子规则：响应当前公开牌时，后手是否拥有“必须吃”的约束。
 */
function mustEatLiveReward(round: RoundState, seat: SeatId): boolean {
  if (!round.currentTrick?.currentTargetPattern) {
    return false
  }

  if (round.currentTrick.currentTargetPattern.group !== 'reward-live') {
    return false
  }

  return enumerateEatPatterns(getSeatState(round, seat).hand, round.currentTrick.currentTargetPattern)
    .length > 0
}

/**
 * 根据选牌尝试识别自然明打牌型。
 */
function classifyOpenSelection(
  cards: CardInstance[],
  source: 'natural' | 'dice',
  intent: TurnAction['intent'],
  options: OpenSelectionOptions = {},
): PlayPattern[] {
  if (cards.length === 0) {
    return []
  }

  const definitionIds = getDefinitionIds(cards)

  if (
    cards.length === 2 &&
    REWARD_DEFINITION_IDS.every((definitionId) => definitionIds.includes(definitionId))
  ) {
    return [
      createPattern(cards, {
        id: 'reward-live',
        label: '活赏',
        kind: 'reward',
        group: 'reward-live',
        strength: 99,
        rewardMode: 'live',
        note: '三和六组成的一对赏，允许特定点子对子吃掉。',
        source,
      }),
      createPattern(cards, {
        id: 'reward-dead',
        label: '死赏',
        kind: 'reward',
        group: 'reward-dead',
        strength: 100,
        rewardMode: 'dead',
        note: '死赏不能被吃，也不产生赏钱。',
        source,
      }),
    ]
  }

  if (cards.length === 1) {
    const [card] = cards
    const definition = getCardDefinition(card.definitionId)
    const isFinalLead = intent === 'lead-final-open'

    if (!definition.singleStrength) {
      return []
    }

    if (
      source === 'natural' &&
      intent === 'lead-open' &&
      !definition.isBrain &&
      !options.allowAnySingle &&
      !options.safeSingleDefinitionIds?.has(definition.id)
    ) {
      return []
    }

    return [
      createPattern(cards, {
        id: createStableId('single', [definition.id, source]),
        label: definition.name,
        kind: 'single',
        group: `${definition.door}-single` as PlayGroup,
        strength: definition.singleStrength,
        note:
          isFinalLead
            ? `最后只剩 ${definition.name}，不再掷骰，直接明出。`
            : source === 'dice'
            ? `掷骰定门后明打 ${definition.name}。`
            : options.allowAnySingle && !definition.isBrain
            ? `首回合首次领出，${definition.name} 可以作为任意单张明打。`
            : options.safeSingleDefinitionIds?.has(definition.id) && !definition.isBrain
            ? `${definition.name} 的更大单张都已明面出尽，可以直接明打。`
            : `脑子 ${definition.name} 可以单独明打。`,
        source,
        door: definition.door,
      }),
    ]
  }

  if (cards.length === 2 && definitionIds[0] === definitionIds[1]) {
    const definition = getCardDefinition(definitionIds[0])

    if (!definition.pairStrength) {
      return []
    }

    return [
      createPattern(cards, {
        id: createStableId('pair', [definition.id]),
        label: `${definition.name}${definition.name}`,
        kind: 'pair',
        group: `${definition.door}-pair` as PlayGroup,
        strength: definition.pairStrength,
        note: `${definition.name}${definition.name} 属于${definition.door === 'long' ? '长门' : definition.door === 'yao' ? '幺门' : '点子门'}对子。`,
        source,
        door: definition.door,
      }),
    ]
  }

  for (const recipe of LONG_COMBO_TWO_RECIPES) {
    if (cards.length === 2 && matchesRecipe(cards, recipe.definitions)) {
      return [
        createPattern(cards, {
          id: recipe.id,
          label: recipe.label,
          kind: 'combo',
          group: recipe.group,
          strength: recipe.strength,
          note: '长门两张混搭组合。',
          source,
        }),
      ]
    }
  }

  for (const recipe of LONG_COMBO_THREE_RECIPES) {
    if (cards.length === 3 && matchesRecipe(cards, recipe.definitions)) {
      return [
        createPattern(cards, {
          id: recipe.id,
          label: recipe.label,
          kind: 'combo',
          group: recipe.group,
          strength: recipe.strength,
          note: '长门三张组合，两种写法同级。',
          source,
        }),
      ]
    }
  }

  for (const recipe of LONG_COMBO_FOUR_RECIPES) {
    if (cards.length === 4 && matchesRecipe(cards, recipe.definitions)) {
      return [
        createPattern(cards, {
          id: recipe.id,
          label: recipe.label,
          kind: 'combo',
          group: recipe.group,
          strength: recipe.strength,
          note: '长门四张组合。',
          source,
        }),
      ]
    }
  }

  if (
    cards.length > 1 &&
    options.safeSingleDefinitionIds &&
    cards.every((card) => options.safeSingleDefinitionIds?.has(card.definitionId))
  ) {
    return [
      createPattern(cards, {
        id: createStableId('safe-singles', cards.map((card) => card.id)),
        label: formatCardsLabel(cards),
        kind: 'single',
        group: 'safe-singles',
        strength: cards.reduce(
          (total, card) => total + (getCardDefinition(card.definitionId).singleStrength ?? 0),
          0,
        ),
        note: '这些单张已经没有更大的明牌可以压，可以合并明打。',
        source,
      }),
    ]
  }

  return []
}

/**
 * 判断 candidate 是否能吃掉 target。
 */
function canEatPattern(target: PlayPattern, candidate: PlayPattern): boolean {
  if (!candidate.isOpen || candidate.cardCount !== target.cardCount) {
    return false
  }

  if (target.group === 'reward-live') {
    return (
      candidate.group === 'point-pair' &&
      LIVE_REWARD_EATERS.includes(candidate.cardDefinitionIds[0] ?? '')
    )
  }

  if (target.group === 'reward-dead' || target.group === 'hidden' || target.group === 'safe-singles') {
    return false
  }

  return candidate.group === target.group && candidate.strength > target.strength
}

/**
 * 枚举一手牌中所有可以主动明打的自然牌型。
 */
function enumerateLeadPatterns(
  hand: CardInstance[],
  round: RoundState,
  options: OpenSelectionOptions = {},
): PlayPattern[] {
  const groupedCards = groupCardsByDefinition(hand)
  const patterns: PlayPattern[] = []

  for (const cards of Object.values(groupedCards)) {
    const singleCards = cards.slice(0, 1)
    const openSingles = classifyOpenSelection(
      singleCards,
      'natural',
      'lead-open',
      createLeadOpenSelectionOptions(round, singleCards, options.allowAnySingle),
    )
    patterns.push(...openSingles)

    if (cards.length >= 2) {
      patterns.push(...classifyOpenSelection(cards.slice(0, 2), 'natural', 'lead-open'))
    }
  }

  for (const recipe of LONG_COMBO_RECIPES) {
    const recipeCount = countBy(recipe.definitions)
    const selectedCards = Object.entries(recipeCount).flatMap(([definitionId, count]) =>
      (groupedCards[definitionId] ?? []).slice(0, count),
    )

    if (selectedCards.length === recipe.definitions.length) {
      patterns.push(...classifyOpenSelection(selectedCards, 'natural', 'lead-open'))
    }
  }

  const rewardCards = REWARD_DEFINITION_IDS.flatMap((definitionId) =>
    (groupedCards[definitionId] ?? []).slice(0, 1),
  )

  if (rewardCards.length === 2) {
    const rewardPatterns = classifyOpenSelection(rewardCards, 'natural', 'lead-open')
    patterns.push(...rewardPatterns)
  }

  /**
   * “没有更大明牌可压”的提速组合允许跨门合并明打。
   * 这里按组合枚举是为了让机器人和空选状态也能知道这些动作合法，
   * 玩家手动点选时仍会在 previewSelection 中用同一套规则二次校验。
   */
  for (let cardCount = 2; cardCount <= hand.length; cardCount += 1) {
    for (const selectedCards of getCombinations(hand, cardCount)) {
      const safeOptions = createLeadOpenSelectionOptions(
        round,
        selectedCards,
        options.allowAnySingle,
      )
      const safePatterns = classifyOpenSelection(
        selectedCards,
        'natural',
        'lead-open',
        safeOptions,
      ).filter((pattern) => pattern.group === 'safe-singles')

      patterns.push(...safePatterns)
    }
  }

  return deduplicatePatterns(patterns)
}

/**
 * 最后一手只检查“全部剩余牌”这一组。能整体组成合法牌型时才明出；
 * 若整体不是合法牌型，就回到普通领出规则，允许其中的脑子、对子等合法牌型先出。
 */
function enumerateFinalLeadPatterns(hand: CardInstance[], round: RoundState): PlayPattern[] {
  const finalCards = sortCardInstances(hand)
  return deduplicatePatterns(
    classifyOpenSelection(
      finalCards,
      'natural',
      'lead-final-open',
      createLeadOpenSelectionOptions(round, finalCards),
    ),
  )
}

/**
 * 将领出牌型统一转换成前端按钮，普通领出和最后一手共用同一套文案分支。
 */
function createLeadPreparedActions(
  seat: SeatId,
  pattern: PlayPattern,
  isFinalHand: boolean,
): PreparedAction[] {
  if (pattern.group === 'reward-live') {
    return [
      {
        id: createStableId('action', [
          seat,
          isFinalHand ? 'final-reward-live' : 'reward-live',
          ...pattern.cardInstanceIds,
        ]),
        label: isFinalHand ? '最后一手打活赏' : '打活赏',
        description: isFinalHand
          ? '最后两张是一对赏，不掷骰；活赏仍可能被九九、七七、五五吃掉。'
          : '活赏可被九九、七七、五五吃掉。',
        intent: 'lead-reward-live',
        selectedCardIds: pattern.cardInstanceIds,
        emphasis: 'primary',
      },
    ]
  }

  if (pattern.group === 'reward-dead') {
    return [
      {
        id: createStableId('action', [
          seat,
          isFinalHand ? 'final-reward-dead' : 'reward-dead',
          ...pattern.cardInstanceIds,
        ]),
        label: isFinalHand ? '最后一手打死赏' : '打死赏',
        description: isFinalHand
          ? '最后两张是一对赏，不掷骰；死赏不能被吃，也不产生赏钱。'
          : '死赏不能被吃，也不产生赏钱。',
        intent: 'lead-reward-dead',
        selectedCardIds: pattern.cardInstanceIds,
        emphasis: isFinalHand ? 'primary' : 'secondary',
      },
    ]
  }

  return [
    {
      id: createStableId('action', [
        seat,
        isFinalHand ? 'lead-final-open' : 'lead-open',
        ...pattern.cardInstanceIds,
      ]),
      label: isFinalHand ? `最后一手明出 ${pattern.label}` : `明打 ${pattern.label}`,
      description: isFinalHand
        ? `${pattern.note} 最后一手不用掷骰。`
        : pattern.note,
      intent: isFinalHand ? 'lead-final-open' : 'lead-open',
      selectedCardIds: pattern.cardInstanceIds,
      emphasis: 'primary',
    },
  ]
}

/**
 * 枚举最后一手按钮。只有“全部剩余牌”整体能组成合法明牌牌型时才自动出完；
 * 整体不是合法牌型时，继续走普通领出或掷骰定门。
 */
function enumerateFinalLeadActions(seatState: SeatState, round: RoundState): PreparedAction[] {
  const finalPatterns = enumerateFinalLeadPatterns(seatState.hand, round)

  if (finalPatterns.length > 0) {
    return finalPatterns.flatMap((pattern) =>
      createLeadPreparedActions(seatState.seat, pattern, true),
    )
  }

  return []
}

/**
 * 领出阶段只允许明打牌型或主动掷骰。弃牌只能发生在后手响应，
 * 或掷骰定门后确实没有该门牌的“卖屁股”单张场景。
 */
function isLeadStageIntent(intent: TurnAction['intent']): boolean {
  return (
    intent === 'lead-open' ||
    intent === 'lead-final-open' ||
    intent === 'lead-reward-live' ||
    intent === 'lead-reward-dead' ||
    intent === 'roll-dice'
  )
}

/**
 * 枚举后手可以明吃的所有牌型。
 */
function enumerateEatPatterns(hand: CardInstance[], targetPattern: PlayPattern): PlayPattern[] {
  const groupedCards = groupCardsByDefinition(hand)
  const patterns: PlayPattern[] = []

  for (const cards of Object.values(groupedCards)) {
    const singlePatterns = classifyOpenSelection(cards.slice(0, 1), 'natural', 'respond-eat')
    const pairPatterns = cards.length >= 2
      ? classifyOpenSelection(cards.slice(0, 2), 'natural', 'respond-eat')
      : []

    patterns.push(...singlePatterns.filter((pattern) => canEatPattern(targetPattern, pattern)))
    patterns.push(...pairPatterns.filter((pattern) => canEatPattern(targetPattern, pattern)))
  }

  for (const recipe of LONG_COMBO_RECIPES) {
    const recipeCount = countBy(recipe.definitions)
    const selectedCards = Object.entries(recipeCount).flatMap(([definitionId, count]) =>
      (groupedCards[definitionId] ?? []).slice(0, count),
    )

    if (selectedCards.length === recipe.definitions.length) {
      const comboPatterns = classifyOpenSelection(selectedCards, 'natural', 'respond-eat')
      patterns.push(...comboPatterns.filter((pattern) => canEatPattern(targetPattern, pattern)))
    }
  }

  return deduplicatePatterns(patterns)
}

/**
 * 卖屁股开墩时没有明面目标牌，但骰子定门仍然有效。
 * 后手若有该门单张，可以明吃并成为当前明面最大牌。
 */
function enumerateForcedDoorEatPatterns(
  hand: CardInstance[],
  forcedDoor: DoorId,
): PlayPattern[] {
  const patterns = hand
    .filter((card) => getCardDefinition(card.definitionId).door === forcedDoor)
    .flatMap((card) => classifyOpenSelection([card], 'dice', 'respond-eat'))

  return deduplicatePatterns(patterns)
}

/**
 * 预备动作生成时去重，避免同一牌型重复出现。
 */
function deduplicatePatterns(patterns: PlayPattern[]): PlayPattern[] {
  const uniqueMap = new Map<string, PlayPattern>()

  for (const pattern of patterns) {
    const signature = `${pattern.id}:${pattern.cardInstanceIds.join(',')}`
    uniqueMap.set(signature, pattern)
  }

  return [...uniqueMap.values()].sort((leftPattern, rightPattern) => {
    if (leftPattern.cardCount !== rightPattern.cardCount) {
      return rightPattern.cardCount - leftPattern.cardCount
    }

    return rightPattern.strength - leftPattern.strength
  })
}

/**
 * 基于当前轮到的玩家枚举所有可执行动作。
 */
export function listTurnActions(round: RoundState, seat: SeatId): PreparedAction[] {
  if (round.currentSeat !== seat) {
    return []
  }

  const seatState = getSeatState(round, seat)

  if (round.pendingDice) {
    if (round.pendingDice.hasMatchingDoor) {
      return seatState.hand
        .filter((card) => getCardDefinition(card.definitionId).door === round.pendingDice?.forcedDoor)
        .map((card) => ({
          id: createStableId('action', [seat, 'dice-open', card.id]),
          label: `定门出 ${getCardDefinition(card.definitionId).name}`,
          description: `掷到${round.pendingDice?.forcedDoor === 'long' ? '长门' : round.pendingDice?.forcedDoor === 'yao' ? '幺门' : '点子门'}，必须明出同门单张。`,
          intent: 'resolve-dice-open' as const,
          selectedCardIds: [card.id],
          emphasis: 'primary' as const,
        }))
    }

    return seatState.hand.map((card) => ({
      id: createStableId('action', [seat, 'dice-hidden', card.id]),
      label: `卖屁股弃牌 ${getCardDefinition(card.definitionId).name}`,
      description: '掷骰所定门类缺牌，只能背面弃牌一张。',
      intent: 'resolve-dice-hidden' as const,
      selectedCardIds: [card.id],
      emphasis: 'secondary' as const,
    }))
  }

  if (!round.currentTrick) {
    const finalActions = isFinalLeadHand(seatState)
      ? enumerateFinalLeadActions(seatState, round)
      : []

    if (finalActions.length > 0) {
      return finalActions
    }

    const leadActions = enumerateLeadPatterns(seatState.hand, round, {
      allowAnySingle: isOpeningLead(round),
    }).flatMap<PreparedAction>((pattern) => createLeadPreparedActions(seat, pattern, false))

    /**
     * 每局第一回合首次领出已经允许任意单张明打，
     * 此时再提供掷骰没有规则价值，也容易误导玩家。
     */
    if (isOpeningLead(round)) {
      return leadActions
    }

    return [
      ...leadActions,
      {
        id: createStableId('action', [seat, 'roll-dice']),
        label: '掷骰子',
        description: '不想直接明打时，可掷骰定门后再出单张。',
        intent: 'roll-dice' as const,
        selectedCardIds: [],
        emphasis: 'secondary' as const,
      },
    ]
  }

  const eatPatterns = round.currentTrick.currentTargetPattern
    ? enumerateEatPatterns(seatState.hand, round.currentTrick.currentTargetPattern)
    : round.currentTrick.forcedDoor && round.currentTrick.expectedCardCount === 1
    ? enumerateForcedDoorEatPatterns(seatState.hand, round.currentTrick.forcedDoor)
    : []
  const eatActions = eatPatterns.map((pattern) => ({
    id: createStableId('action', [seat, 'respond-eat', ...pattern.cardInstanceIds]),
    label: `吃 ${pattern.label}`,
    description: round.currentTrick?.currentTargetPattern
      ? `用 ${pattern.label} 明吃当前牌。`
      : `卖屁股开墩后，用定门 ${pattern.label} 明吃。`,
    intent: 'respond-eat' as const,
    selectedCardIds: pattern.cardInstanceIds,
    emphasis: 'primary' as const,
  }))

  const passActions = mustEatLiveReward(round, seat)
    ? []
    : getCombinations(seatState.hand, round.currentTrick.expectedCardCount).map((cards) => ({
        id: createStableId('action', [seat, 'pass-hidden', ...cards.map((card) => card.id)]),
        label: `弃牌 ${cards.length} 张`,
        description: `背面弃牌 ${formatCardsLabel(cards)}，本回合结束前不公开。`,
        intent: 'respond-pass-hidden' as const,
        selectedCardIds: cards.map((card) => card.id),
        emphasis: 'secondary' as const,
      }))

  return [...eatActions, ...passActions]
}

/**
 * 将当前选牌解释成前端可以展示的按钮与提示。
 */
export function previewSelection(
  round: RoundState,
  seat: SeatId,
  selectedCardIds: string[],
): SelectionPreview {
  if (round.currentSeat !== seat) {
    return {
      selectedCardIds,
      actions: [],
      hint: '当前不是你的回合。',
    }
  }

  const seatState = getSeatState(round, seat)

  if (selectedCardIds.length === 0) {
    const allActions = listTurnActions(round, seat)
    const finalActions = !round.pendingDice && !round.currentTrick && isFinalLeadHand(seatState)
      ? enumerateFinalLeadActions(seatState, round)
      : []

    return {
      selectedCardIds,
      actions: finalActions.length > 0
        ? finalActions
        : allActions.filter((action) => action.selectedCardIds.length === 0),
      hint: getTurnHint(round, seat),
    }
  }

  const selectedCards = getSelectedCards(seatState, selectedCardIds)

  if (round.pendingDice) {
    if (selectedCards.length !== 1) {
      return {
        selectedCardIds,
        actions: [],
        hint: '掷骰后只能补选 1 张牌。',
      }
    }

    const selectedDoor = getCardDefinition(selectedCards[0].definitionId).door

    if (round.pendingDice.hasMatchingDoor && selectedDoor !== round.pendingDice.forcedDoor) {
      return {
        selectedCardIds,
        actions: [],
        hint: '掷骰定门后，必须明出对应门类的一张牌。',
      }
    }

    return {
      selectedCardIds,
      actions: listTurnActions(round, seat).filter(
        (action) => selectedCardIdsMatch(action.selectedCardIds, selectedCardIds),
      ),
      hint: round.pendingDice.hasMatchingDoor
        ? '这张牌会作为定门明牌打出。'
        : '没有对应门类，可以任选 1 张背面卖屁股。',
    }
  }

  if (!round.currentTrick) {
    const finalActions = isFinalLeadHand(seatState)
      ? enumerateFinalLeadActions(seatState, round)
      : []

    if (finalActions.length > 0) {
      if (!selectsEntireRemainingHand(seatState, selectedCardIds)) {
        return {
          selectedCardIds,
          actions: [],
          hint: '最后剩牌正好能组成合法牌型，需要一次性明出。',
        }
      }

      const matchedFinalActions = finalActions.filter((action) =>
        selectedCardIdsMatch(action.selectedCardIds, selectedCardIds),
      )

      return {
        selectedCardIds,
        actions: matchedFinalActions,
        hint: matchedFinalActions.length > 0
          ? '最后一手是合法牌型，可以直接明出。'
          : '最后剩牌不是合法明打牌型，不能弃牌，请改用掷骰子。',
      }
    }

    const patterns = classifyOpenSelection(selectedCards, 'natural', 'lead-open', {
      ...createLeadOpenSelectionOptions(round, selectedCards, isOpeningLead(round)),
    })
    const actions = patterns.flatMap<PreparedAction>((pattern) =>
      createLeadPreparedActions(seat, pattern, false),
    )

    return {
      selectedCardIds,
      actions,
      hint:
        actions.length > 0
          ? '当前选牌可以直接明打。'
          : '这组牌不是当前规则允许主动明打的牌型。',
    }
  }

  if (selectedCards.length !== round.currentTrick.expectedCardCount) {
    return {
      selectedCardIds,
      actions: [],
      hint: `当前必须选择 ${round.currentTrick.expectedCardCount} 张牌。`,
    }
  }

  const actions: PreparedAction[] = []
  const patterns = round.currentTrick.currentTargetPattern
    ? classifyOpenSelection(selectedCards, 'natural', 'respond-eat')
    : round.currentTrick.forcedDoor && selectedCards.length === 1
    ? classifyOpenSelection(selectedCards, 'dice', 'respond-eat')
    : []

  for (const pattern of patterns) {
    const canEatCurrentTarget = round.currentTrick.currentTargetPattern
      ? canEatPattern(round.currentTrick.currentTargetPattern, pattern)
      : false
    const canEatForcedDoorLead =
      !round.currentTrick.currentTargetPattern &&
      round.currentTrick.forcedDoor !== undefined &&
      pattern.door === round.currentTrick.forcedDoor

    if (canEatCurrentTarget || canEatForcedDoorLead) {
      actions.push({
        id: createStableId('action', [seat, 'preview-eat', ...pattern.cardInstanceIds]),
        label: `吃 ${pattern.label}`,
        description: canEatCurrentTarget
          ? `用 ${pattern.label} 明吃当前公开牌。`
          : `卖屁股开墩后，用定门 ${pattern.label} 明吃。`,
        intent: 'respond-eat',
        selectedCardIds,
        emphasis: 'primary',
      })
    }
  }

  if (!mustEatLiveReward(round, seat)) {
    actions.push({
      id: createStableId('action', [seat, 'preview-hidden', ...selectedCardIds]),
      label: `弃牌 ${selectedCards.length} 张`,
      description: '背面弃牌，不参与明面比较。',
      intent: 'respond-pass-hidden',
      selectedCardIds,
      emphasis: 'secondary',
    })
  }

  return {
    selectedCardIds,
    actions,
    hint:
      actions.length > 0
        ? '可以选择吃，或按规则背面弃牌。'
        : '当前选牌不能明吃，且你此刻可能处于必须吃活赏的状态。',
  }
}

/**
 * 当前轮到谁时，给出一条简洁的规则提示。
 */
export function getTurnHint(round: RoundState, seat: SeatId): string {
  if (round.currentSeat !== seat) {
    return '等待其他玩家操作。'
  }

  if (round.pendingDice) {
    return round.pendingDice.hasMatchingDoor
      ? '掷骰已定门，请选择该门的一张牌明打。'
      : '掷骰所定门类缺牌，请背面弃牌 1 张卖屁股。'
  }

  if (!round.currentTrick) {
    const finalActions = isFinalLeadHand(getSeatState(round, seat))
      ? enumerateFinalLeadActions(getSeatState(round, seat), round)
      : []

    if (finalActions.length > 0) {
      return '最后一手是合法牌型，不用掷骰，直接明出。'
    }

    if (isOpeningLead(round)) {
      return '第一回合首次领出：可出合法明打牌型，也可任意明出一张单牌。'
    }

    return '请选择允许明打的牌型，或掷骰子定门。'
  }

  return mustEatLiveReward(round, seat)
    ? '对方打了活赏，你手里有可吃对子，必须明吃。'
    : `请选择 ${round.currentTrick.expectedCardCount} 张牌吃或弃牌。`
}

/**
 * 掷骰规则采用无序组合映射。
 */
function rollDice(rng: RandomSource): DiceRoll {
  const first = rng.nextInt(6) + 1
  const second = rng.nextInt(6) + 1
  const min = Math.min(first, second)
  const max = Math.max(first, second)
  const key = `${min}${max}`

  return {
    first,
    second,
    sum: first + second,
    key,
    door: DICE_TO_DOOR[key] ?? 'point',
  }
}

/**
 * 第 1 局与后续每局的先手决定规则不同。
 */
function createCeremony(
  roundNumber: number,
  lastRoundWinner: SeatId | null,
  rng: RandomSource,
): DiceCeremony {
  if (roundNumber === 1) {
    const firstRoller = rng.nextInt(4) as SeatId
    const firstRoll = rollDice(rng)
    const secondRoller = advanceSeat(firstRoller, firstRoll.sum - 1)
    const secondRoll = rollDice(rng)
    const firstLeader = advanceSeat(secondRoller, secondRoll.sum - 1)

    return {
      stage: 'first-round',
      firstRoller,
      firstRoll,
      secondRoller,
      secondRoll,
      roller: secondRoller,
      roll: secondRoll,
      firstLeader,
    }
  }

  const roller = advanceSeat(lastRoundWinner ?? 0, 2)
  const roll = rollDice(rng)
  const firstLeader = advanceSeat(roller, roll.sum - 1)

  return {
    stage: 'regular-round',
    roller,
    roll,
    firstLeader,
  }
}

/**
 * 从先抓牌的人开始按顺时针轮流发牌。
 */
function createSeatStates(
  seatConfigs: SeatConfig[],
  firstLeader: SeatId,
  shuffledDeck: CardInstance[],
  options: StartRoundOptions = {},
): SeatState[] {
  const seatStates = seatConfigs.map<SeatState>((seatConfig) => ({
    seat: seatConfig.seat,
    config: { ...seatConfig },
    hand: [],
    wonTricks: [],
    wonPierCount: 0,
  }))
  const selectedHandCardIds = options.selectedHandCardIds ?? []

  if (selectedHandCardIds.length > 0) {
    return createSeatStatesWithSelectedHumanHand(
      seatStates,
      firstLeader,
      shuffledDeck,
      options,
    )
  }

  shuffledDeck.forEach((card, index) => {
    const targetSeat = advanceSeat(firstLeader, index % 4)
    const seatState = seatStates.find((item) => item.seat === targetSeat)

    if (!seatState) {
      throw new Error('发牌时缺少座位信息。')
    }

    seatState.hand.push(card)
  })

  return seatStates.map((seatState) => ({
    ...seatState,
    hand: sortCardInstances(seatState.hand),
  }))
}

/**
 * 从开局选项里解析真人座位。UI 当前只允许一个真人，但规则层仍保留兜底，
 * 避免测试或未来后端忘记传 humanSeat 时无法指定手牌。
 */
function resolveOpeningHumanSeat(
  seatStates: SeatState[],
  options: StartRoundOptions,
): SeatId {
  if (options.humanSeat !== undefined) {
    return options.humanSeat
  }

  return seatStates.find((seatState) => seatState.config.mode === 'human')?.seat ?? 0
}

/**
 * 校验首页指定的真人手牌，并按用户点选顺序取出真实牌实例。
 */
function pickSelectedOpeningCards(
  shuffledDeck: CardInstance[],
  selectedHandCardIds: string[],
): CardInstance[] {
  if (selectedHandCardIds.length > CARDS_PER_SEAT) {
    throw new Error('真人开局指定手牌最多只能选择 8 张。')
  }

  const selectedCardIdSet = new Set(selectedHandCardIds)

  if (selectedCardIdSet.size !== selectedHandCardIds.length) {
    throw new Error('真人开局指定手牌不能包含重复牌。')
  }

  const deckByCardId = new Map(shuffledDeck.map((card) => [card.id, card]))

  return selectedHandCardIds.map((cardId) => {
    const card = deckByCardId.get(cardId)

    if (!card) {
      throw new Error(`真人开局指定了不存在的牌 ${cardId}。`)
    }

    return card
  })
}

/**
 * 测试开局发牌：真人先拿到指定牌，不足 8 张由洗牌堆随机补齐；
 * 三个机器人再从剩余牌中随机发满，保证全局 32 张牌不重复。
 */
function createSeatStatesWithSelectedHumanHand(
  seatStates: SeatState[],
  firstLeader: SeatId,
  shuffledDeck: CardInstance[],
  options: StartRoundOptions,
): SeatState[] {
  const humanSeat = resolveOpeningHumanSeat(seatStates, options)
  const humanSeatState = seatStates.find((seatState) => seatState.seat === humanSeat)

  if (!humanSeatState) {
    throw new Error('指定真人座位不存在，无法按指定手牌开局。')
  }

  const selectedCards = pickSelectedOpeningCards(
    shuffledDeck,
    options.selectedHandCardIds ?? [],
  )
  const selectedCardIdSet = new Set(selectedCards.map((card) => card.id))
  const remainingDeck = shuffledDeck.filter((card) => !selectedCardIdSet.has(card.id))
  const fillerCards = remainingDeck.slice(0, CARDS_PER_SEAT - selectedCards.length)
  const robotDeck = remainingDeck.slice(fillerCards.length)
  const robotSeatOrder = Array.from({ length: 4 }, (_, index) => advanceSeat(firstLeader, index))
    .filter((seat) => seat !== humanSeat)

  humanSeatState.hand.push(...selectedCards, ...fillerCards)
  robotDeck.forEach((card, index) => {
    const targetSeat = robotSeatOrder[index % robotSeatOrder.length]
    const seatState = seatStates.find((item) => item.seat === targetSeat)

    if (!seatState) {
      throw new Error('发牌时缺少机器人座位信息。')
    }

    seatState.hand.push(card)
  })

  return seatStates.map((seatState) => ({
    ...seatState,
    hand: sortCardInstances(seatState.hand),
  }))
}

/**
 * 启动新一局。
 */
export function startRound(
  match: MatchState,
  rng: RandomSource,
  options: StartRoundOptions = {},
): ActionResult {
  const nextMatch = structuredClone(match)
  const roundNumber = nextMatch.roundNumber + 1
  const ceremony = createCeremony(roundNumber, nextMatch.lastRoundLastTrickWinner, rng)
  const shuffledDeck = rng.shuffle(createDeck())
  const seats = createSeatStates(
    nextMatch.seatConfigs,
    ceremony.firstLeader,
    shuffledDeck,
    options,
  )

  nextMatch.roundNumber = roundNumber
  nextMatch.phase = 'playing'
  nextMatch.currentRound = {
    ruleSetId: nextMatch.ruleSetId,
    roundNumber,
    phase: 'playing',
    seats,
    currentSeat: ceremony.firstLeader,
    firstLeader: ceremony.firstLeader,
    ceremony,
    currentTrick: null,
    pendingDice: null,
    publicTrickLog: [],
    hiddenPlaysPendingReveal: 0,
    eventLog: [],
  }

  const messages = [
    `第 ${roundNumber} 局开始，${getSeatState(nextMatch.currentRound, ceremony.firstLeader).config.name} 先出。`,
  ]

  pushEvent(nextMatch.currentRound, 'info', messages[0])

  return { match: nextMatch, messages }
}

/**
 * 从玩家手牌里移除已经打出的牌。
 */
function removeCardsFromHand(seatState: SeatState, cards: CardInstance[]): void {
  const cardIdSet = new Set(cards.map((card) => card.id))
  seatState.hand = seatState.hand.filter((card) => !cardIdSet.has(card.id))
}

/**
 * 生成一条桌面公开出牌记录。
 */
function createPlayedAction(
  seat: SeatId,
  pattern: PlayPattern,
  cards: CardInstance[],
  message: string,
): CurrentTrickState['plays'][number] {
  return {
    seat,
    pattern,
    revealed: pattern.isOpen,
    cards,
    message,
  }
}

/**
 * 领打一墩。
 */
function createLeadTrick(
  round: RoundState,
  seat: SeatId,
  pattern: PlayPattern,
  cards: CardInstance[],
  message: string,
  forcedDoor?: DoorId,
): void {
  const isReward = pattern.group === 'reward-live' || pattern.group === 'reward-dead'

  round.currentTrick = {
    trickIndex: round.publicTrickLog.length + 1,
    leader: seat,
    expectedCardCount: cards.length,
    plays: [createPlayedAction(seat, pattern, cards, message)],
    currentWinningSeat: seat,
    currentTargetPattern: pattern.isOpen ? pattern : null,
    forcedDoor,
    responseSeat: nextSeat(seat),
    isHiddenLead: !pattern.isOpen,
    rewardOwner: isReward ? seat : undefined,
    rewardMode: pattern.rewardMode,
    rewardWasLastTwo: isReward ? getSeatState(round, seat).hand.length === 0 : undefined,
  }
  round.currentSeat = nextSeat(seat)
}

/**
 * 四家都出完后，按本回合张数结算墩数并推进下一轮次。
 */
function settleCurrentTrick(round: RoundState): void {
  if (!round.currentTrick) {
    throw new Error('没有可结算的当前墩。')
  }

  const trick = round.currentTrick
  const winnerSeat = getSeatState(round, trick.currentWinningSeat)
  const record = {
    trickIndex: trick.trickIndex,
    leader: trick.leader,
    winner: trick.currentWinningSeat,
    cardCount: trick.expectedCardCount,
    visibleWinningSeat: trick.currentWinningSeat,
    forcedDoor: trick.forcedDoor,
    plays: trick.plays,
    note: `${winnerSeat.config.name} 赢下第 ${trick.trickIndex} 回合，共 ${trick.expectedCardCount} 墩。`,
    rewardOwner: trick.rewardOwner,
    rewardMode: trick.rewardMode,
    rewardWasEaten: Boolean(trick.rewardOwner !== undefined && trick.currentWinningSeat !== trick.rewardOwner),
    rewardWasLastTwo: trick.rewardWasLastTwo,
  }

  winnerSeat.wonTricks.push(record)
  winnerSeat.wonPierCount += trick.expectedCardCount
  round.publicTrickLog.push(record)
  round.hiddenPlaysPendingReveal += trick.plays.filter((play) => !play.pattern.isOpen).length

  if (trick.rewardOwner !== undefined && trick.rewardMode) {
    round.rewardOutcome = {
      owner: trick.rewardOwner,
      mode: trick.rewardMode,
      wasLastTwo: Boolean(trick.rewardWasLastTwo),
      wasEaten: trick.currentWinningSeat !== trick.rewardOwner,
      trickIndex: trick.trickIndex,
      winner: trick.currentWinningSeat,
    }
  }

  pushEvent(round, 'result', record.note, trick.trickIndex)

  const allHandsEmpty = round.seats.every((seat) => seat.hand.length === 0)

  if (allHandsEmpty) {
    round.lastTrickWinner = trick.currentWinningSeat
    round.phase = 'awaiting-reveal'
    round.currentSeat = null
    round.currentTrick = null
    round.pendingDice = null
    pushEvent(
      round,
      'info',
      `${winnerSeat.config.name} 赢下最后一回合，整局结束，准备统一翻开背面弃牌。`,
    )
    return
  }

  round.currentSeat = trick.currentWinningSeat
  round.currentTrick = null
  round.pendingDice = null
}

/**
 * 将动作写入当前墩，然后在必要时更新明面最大牌。
 */
function appendResponsePlay(
  round: RoundState,
  seat: SeatId,
  pattern: PlayPattern,
  cards: CardInstance[],
  message: string,
): void {
  if (!round.currentTrick) {
    throw new Error('当前没有可响应的墩。')
  }

  round.currentTrick.plays.push(createPlayedAction(seat, pattern, cards, message))

  if (
    pattern.isOpen &&
    (
      (
        round.currentTrick.currentTargetPattern &&
        canEatPattern(round.currentTrick.currentTargetPattern, pattern)
      ) ||
      (
        !round.currentTrick.currentTargetPattern &&
        round.currentTrick.forcedDoor === pattern.door
      )
    )
  ) {
    round.currentTrick.currentTargetPattern = pattern
    round.currentTrick.currentWinningSeat = seat
  }

  if (round.currentTrick.plays.length === 4) {
    settleCurrentTrick(round)
    return
  }

  round.currentTrick.responseSeat = nextSeat(seat)
  round.currentSeat = round.currentTrick.responseSeat
}

/**
 * 根据动作意图与选牌得到最终牌型。
 */
function resolvePatternFromAction(
  seatState: SeatState,
  action: TurnAction,
  options: OpenSelectionOptions = {},
): { cards: CardInstance[]; pattern: PlayPattern } {
  const cards = getSelectedCards(seatState, action.selectedCardIds)

  if (
    action.intent === 'respond-pass-hidden' ||
    action.intent === 'resolve-dice-hidden'
  ) {
    return {
      cards,
      pattern: createHiddenPattern(
        cards,
        action.intent === 'resolve-dice-hidden'
          ? '无定门牌，卖屁股弃牌。'
          : '后手选择弃牌，背面放置。',
        action.intent === 'resolve-dice-hidden' ? 'dice' : 'hidden',
      ),
    }
  }

  const source = action.intent.startsWith('resolve-dice') ? 'dice' : 'natural'
  const patterns = classifyOpenSelection(cards, source, action.intent, options)

  if (action.intent === 'lead-reward-live') {
    const pattern = patterns.find((item) => item.group === 'reward-live')

    if (!pattern) {
      throw new Error('当前选牌无法组成活赏。')
    }

    return { cards, pattern }
  }

  if (action.intent === 'lead-reward-dead') {
    const pattern = patterns.find((item) => item.group === 'reward-dead')

    if (!pattern) {
      throw new Error('当前选牌无法组成死赏。')
    }

    return { cards, pattern }
  }

  const [pattern] = patterns

  if (!pattern) {
    throw new Error('当前选牌不能组成合法明牌。')
  }

  return { cards, pattern }
}

/**
 * 应用一条玩家动作。
 */
export function submitAction(
  match: MatchState,
  action: TurnAction,
  rng: RandomSource,
): ActionResult {
  const nextMatch = structuredClone(match)
  const round = nextMatch.currentRound

  if (!round || round.phase !== 'playing') {
    throw new Error('当前没有进行中的牌局。')
  }

  if (round.currentSeat !== action.seat) {
    throw new Error('还没有轮到该玩家操作。')
  }

  const seatState = getSeatState(round, action.seat)
  const messages: string[] = []

  if (action.intent === 'roll-dice') {
    if (round.currentTrick || round.pendingDice) {
      throw new Error('只有领打前才能掷骰子。')
    }

    if (isOpeningLead(round)) {
      throw new Error('第一回合首次领出可以任意明出一张单牌，不用掷骰。')
    }

    if (isFinalLeadHand(seatState) && enumerateFinalLeadActions(seatState, round).length > 0) {
      throw new Error('最后一手是合法牌型，不用掷骰，必须直接明出。')
    }

    const roll = rollDice(rng)
    const hasMatchingDoor = seatState.hand.some(
      (card) => getCardDefinition(card.definitionId).door === roll.door,
    )

    round.pendingDice = {
      seat: action.seat,
      roll,
      forcedDoor: roll.door,
      hasMatchingDoor,
    } satisfies PendingDiceChoice
    round.lastDiceRoll = roll

    const seatName = seatState.config.name
    const message = `${seatName} 掷出 ${roll.first}+${roll.second}，定到${roll.door === 'long' ? '长门' : roll.door === 'yao' ? '幺门' : '点子门'}。`
    messages.push(message)
    pushEvent(round, 'action', message)
    return { match: nextMatch, messages }
  }

  if (round.pendingDice) {
    if (action.intent !== 'resolve-dice-open' && action.intent !== 'resolve-dice-hidden') {
      throw new Error('掷骰后的回合只能执行定门出牌。')
    }

    if (action.selectedCardIds.length !== 1) {
      throw new Error('掷骰后一次只能出 1 张牌。')
    }

    const [selectedCard] = getSelectedCards(seatState, action.selectedCardIds)

    if (round.pendingDice.hasMatchingDoor) {
      if (action.intent !== 'resolve-dice-open') {
        throw new Error('掷骰定门后有对应门类时必须明出 1 张，不能弃牌。')
      }

      const selectedDoor = getCardDefinition(selectedCard.definitionId).door

      if (selectedDoor !== round.pendingDice.forcedDoor) {
        throw new Error('掷骰定门后必须打出对应门类的一张牌。')
      }
    } else if (action.intent !== 'resolve-dice-hidden') {
      throw new Error('掷骰定门后没有对应门类时，只能背面卖屁股 1 张。')
    }

    const { cards, pattern } = resolvePatternFromAction(seatState, action)
    removeCardsFromHand(seatState, cards)
    const trickIndex = round.publicTrickLog.length + 1
    const message = pattern.isOpen
      ? `${seatState.config.name} 定门明打 ${pattern.label}。`
      : `${seatState.config.name} 无定门牌，卖屁股弃牌 1 张。`
    createLeadTrick(
      round,
      action.seat,
      pattern,
      cards,
      message,
      pattern.isOpen ? undefined : round.pendingDice.forcedDoor,
    )
    round.pendingDice = null
    messages.push(message)
    pushEvent(round, 'action', message, trickIndex)
    return { match: nextMatch, messages }
  }

  if (!round.currentTrick) {
    if (!isLeadStageIntent(action.intent)) {
      throw new Error('领打阶段只能明打牌型或掷骰。')
    }

    const selectedCards = getSelectedCards(seatState, action.selectedCardIds)
    const { cards, pattern } = resolvePatternFromAction(
      seatState,
      action,
      createLeadOpenSelectionOptions(round, selectedCards, isOpeningLead(round)),
    )
    const finalActions = isFinalLeadHand(seatState)
      ? enumerateFinalLeadActions(seatState, round)
      : []
    const mustPlayFinalHand = finalActions.length > 0
    const isPlayingEntireFinalHand = selectsEntireRemainingHand(seatState, action.selectedCardIds)

    if (mustPlayFinalHand && !isPlayingEntireFinalHand) {
      throw new Error('最后一手必须一次性出完全部剩余牌。')
    }

    removeCardsFromHand(seatState, cards)
    const trickIndex = round.publicTrickLog.length + 1
    const message =
      action.intent === 'lead-final-open' || (mustPlayFinalHand && isPlayingEntireFinalHand)
          ? `${seatState.config.name} 最后一手明出 ${pattern.label}。`
          : `${seatState.config.name} 明打 ${pattern.label}。`
    createLeadTrick(round, action.seat, pattern, cards, message)
    messages.push(message)
    pushEvent(round, 'action', message, trickIndex)
    return { match: nextMatch, messages }
  }

  const { cards, pattern } = resolvePatternFromAction(seatState, action)

  if (cards.length !== round.currentTrick.expectedCardCount) {
    throw new Error('响应出牌张数与本回合要求不一致。')
  }

  if (action.intent === 'respond-pass-hidden') {
    if (mustEatLiveReward(round, action.seat)) {
      throw new Error('当前存在必须吃活赏的约束，不能弃牌。')
    }

    removeCardsFromHand(seatState, cards)
    const trickIndex = round.currentTrick.trickIndex
    const message = `${seatState.config.name} 选择不吃，弃牌 ${cards.length} 张。`
    appendResponsePlay(round, action.seat, pattern, cards, message)
    messages.push(message)
    pushEvent(round, 'action', message, trickIndex)
    return { match: nextMatch, messages }
  }

  const canEatCurrentTarget = round.currentTrick.currentTargetPattern
    ? canEatPattern(round.currentTrick.currentTargetPattern, pattern)
    : false
  const canEatForcedDoorLead =
    !round.currentTrick.currentTargetPattern &&
    round.currentTrick.forcedDoor !== undefined &&
    pattern.cardCount === 1 &&
    pattern.door === round.currentTrick.forcedDoor

  if (!canEatCurrentTarget && !canEatForcedDoorLead) {
    throw new Error('当前选牌不能吃掉桌面的公开牌。')
  }

  removeCardsFromHand(seatState, cards)
  const trickIndex = round.currentTrick.trickIndex
  const message = `${seatState.config.name} 用 ${pattern.label} 吃牌。`
  appendResponsePlay(round, action.seat, pattern, cards, message)
  messages.push(message)
  pushEvent(round, 'action', message, trickIndex)
  return { match: nextMatch, messages }
}

/**
 * 整局结束后统一翻开背面弃牌并生成结算。
 */
export function finishRoundAndReveal(match: MatchState): ActionResult {
  const nextMatch = structuredClone(match)
  const round = nextMatch.currentRound

  if (!round || round.phase !== 'awaiting-reveal') {
    return {
      match: nextMatch,
      messages: [],
    }
  }

  round.publicTrickLog.forEach((trick) => {
    trick.plays.forEach((play) => {
      if (!play.pattern.isOpen) {
        play.revealed = true
      }
    })
  })

  round.hiddenPlaysPendingReveal = 0
  round.settlement = calculateSettlement(round)
  round.phase = 'settled'
  nextMatch.phase = 'settled'
  nextMatch.lastRoundLastTrickWinner = round.lastTrickWinner ?? null
  nextMatch.replayRounds = [...nextMatch.replayRounds, structuredClone(round)]

  const message = '整局背面弃牌已统一翻开，可以查看完整复盘与结算。'
  pushEvent(round, 'result', message)

  return {
    match: nextMatch,
    messages: [message],
  }
}

/**
 * 优先返回当前局，便于结算页或回放页直接消费。
 */
export function getReplayState(match: MatchState): RoundState | null {
  return match.currentRound ?? match.replayRounds.at(-1) ?? null
}
