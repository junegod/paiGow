import { describe, expect, it } from 'vitest'

import type {
  BotDifficulty,
  CardInstance,
  PlayPattern,
  PreparedAction,
  RoundState,
  SeatId,
} from '@/rules-core/types'
import {
  createDeck,
  DEFAULT_SEAT_CONFIGS,
  sortCardInstances,
} from '@/rules-variants/ji-an-da-suo-zi/cardCatalog'
import { createBotDecisionContext } from '@/rules-variants/ji-an-da-suo-zi/botObservation'
import { getHeuristicBotStrategy } from '@/rules-variants/ji-an-da-suo-zi/botStrategy'
import { scoreBotAction } from '@/rules-variants/ji-an-da-suo-zi/botStrategyScoring'
import { listTurnActions } from '@/rules-variants/ji-an-da-suo-zi/engine'
import { REWARD_DEFINITION_IDS } from '@/rules-variants/ji-an-da-suo-zi/patternCatalog'

/**
 * 从同一副测试牌池按定义顺序取牌，保证四个座位不会重复使用同一牌实例。
 *
 * @param pools 按牌定义分组的剩余牌池。
 * @param definitionIds 当前座位需要的牌定义顺序。
 * @returns 已按规则顺序整理的牌实例。
 */
function takeCards(
  pools: Record<string, CardInstance[]>,
  definitionIds: string[],
): CardInstance[] {
  const cards = definitionIds.map((definitionId) => {
    const card = pools[definitionId]?.shift()

    if (!card) {
      throw new Error(`机器人测试牌池缺少 ${definitionId}。`)
    }

    return card
  })

  return sortCardInstances(cards)
}

/**
 * 构造已经完成开局首墩的机器人测试局面。
 * 测试只关心决策边界与合法动作，不依赖完整发牌和掷骰流程。
 *
 * @param hands 四个座位各自需要的牌定义。
 * @returns 可直接交给规则引擎枚举合法动作的单局状态。
 */
function createBotTestRound(hands: Record<SeatId, string[]>): RoundState {
  const pools = createDeck().reduce<Record<string, CardInstance[]>>((result, card) => {
    result[card.definitionId] ??= []
    result[card.definitionId].push(card)
    return result
  }, {})

  return {
    ruleSetId: 'ji-an-da-suo-zi',
    roundNumber: 2,
    phase: 'playing',
    seats: ([0, 1, 2, 3] as SeatId[]).map((seat) => ({
      seat,
      config: { ...DEFAULT_SEAT_CONFIGS[seat], mode: 'bot' },
      hand: takeCards(pools, hands[seat]),
      wonTricks: [],
      wonPierCount: seat === 0 ? 5 : 1,
    })),
    currentSeat: 0,
    firstLeader: 0,
    lastTrickWinner: 0,
    ceremony: {
      stage: 'regular-round',
      roller: 0,
      roll: { first: 1, second: 1, sum: 2, key: '11', door: 'long' },
      firstLeader: 0,
    },
    currentTrick: null,
    pendingDice: null,
    publicTrickLog: [
      {
        trickIndex: 1,
        leader: 0,
        winner: 0,
        cardCount: 1,
        visibleWinningSeat: 0,
        plays: [],
        note: '机器人测试中跳过开局首墩。',
      },
    ],
    hiddenPlaysPendingReveal: 0,
    eventLog: [],
  }
}

/**
 * 在测试局面中写入一条包含真实牌面的暗牌记录。
 * 规则运行态会保留该牌面用于结算，但机器人观察必须将其完全剥离。
 *
 * @param round 需要追加暗牌历史的完整单局状态。
 * @param seat 暗牌所属对手座位。
 * @param card 规则运行态中保存的真实暗牌实例。
 */
function appendHiddenOpponentPlay(
  round: RoundState,
  seat: SeatId,
  card: CardInstance,
): void {
  const pattern: PlayPattern = {
    id: 'hidden-opponent-play',
    label: '弃牌 1 张',
    kind: 'single',
    group: 'hidden',
    cardDefinitionIds: [card.definitionId],
    cardInstanceIds: [card.id],
    cardCount: 1,
    strength: 0,
    isOpen: false,
    source: 'hidden',
    note: '测试用对手暗牌。',
  }

  round.publicTrickLog.push({
    trickIndex: 2,
    leader: seat,
    winner: seat,
    cardCount: 1,
    visibleWinningSeat: seat,
    plays: [
      {
        seat,
        pattern,
        revealed: false,
        cards: [{ ...card }],
        message: '对手背面弃牌。',
      },
    ],
    note: '测试用暗牌历史墩。',
  })
  round.hiddenPlaysPendingReveal += 1
}

/**
 * 判断最终动作是否原样来自规则引擎合法动作列表。
 *
 * @param action 机器人最终选择的动作。
 * @param legalActions 规则引擎枚举出的合法动作。
 * @returns 意图和选牌集合是否与某个合法动作完全一致。
 */
function isLegalBotAction(
  action: ReturnType<ReturnType<typeof getHeuristicBotStrategy>['chooseAction']>,
  legalActions: PreparedAction[],
): boolean {
  return legalActions.some((legalAction) => {
    if (legalAction.intent !== action.intent) {
      return false
    }

    const selectedCardIdSet = new Set(legalAction.selectedCardIds)
    return (
      selectedCardIdSet.size === action.selectedCardIds.length &&
      action.selectedCardIds.every((cardId) => selectedCardIdSet.has(cardId))
    )
  })
}

describe('机器人脱敏观察与难度策略', () => {
  it('决策上下文不包含对手真实手牌，也不暴露暗牌牌面身份', () => {
    const round = createBotTestRound({
      0: ['yao_si_liu', 'yao_si_liu', 'long_tian', 'point_nine', 'long_di'],
      1: ['point_seven', 'point_five'],
      2: ['long_ren', 'yao_yao_wu'],
      3: ['point_eight', 'long_chang'],
    })
    const hiddenCard = round.seats[1].hand[0]
    appendHiddenOpponentPlay(round, 1, hiddenCard)
    const legalActions = listTurnActions(round, 0)
    const context = createBotDecisionContext(round, 0, legalActions)
    const unsafeContext = context as unknown as Record<string, unknown>
    const serializedObservation = JSON.stringify(context.observation)
    const hiddenObservedPlay = context.observation.round.publicTrickLog[1].plays[0]

    expect(unsafeContext.round).toBeUndefined()
    expect(unsafeContext.seatState).toBeUndefined()
    expect(context.observation.self.hand).toEqual(round.seats[0].hand)
    expect(context.observation.opponents).toEqual([
      { seat: 1, remainingCardCount: 2, wonPierCount: 1, wonTrickCount: 0 },
      { seat: 2, remainingCardCount: 2, wonPierCount: 1, wonTrickCount: 0 },
      { seat: 3, remainingCardCount: 2, wonPierCount: 1, wonTrickCount: 0 },
    ])
    expect('hand' in context.observation.opponents[0]).toBe(false)
    expect(hiddenObservedPlay.publicPattern).toBeNull()
    expect(hiddenObservedPlay.publicCards).toEqual([])
    expect(serializedObservation).not.toContain(hiddenCard.id)
    expect(serializedObservation).not.toContain(hiddenCard.definitionId)
    round.seats.slice(1).flatMap((seatState) => seatState.hand).forEach((opponentCard) => {
      expect(serializedObservation).not.toContain(opponentCard.id)
    })
  })

  it('入门、标准、专家三档均可调用且只会选择规则引擎合法动作', () => {
    const round = createBotTestRound({
      0: ['yao_si_liu', 'yao_si_liu', 'long_tian', 'point_nine', 'long_di'],
      1: ['point_seven', 'point_five'],
      2: ['long_ren', 'yao_yao_wu'],
      3: ['point_eight', 'long_chang'],
    })
    const legalActions = listTurnActions(round, 0)
    const difficulties: BotDifficulty[] = ['beginner', 'standard', 'expert']

    difficulties.forEach((difficulty) => {
      const strategy = getHeuristicBotStrategy(difficulty)
      const context = createBotDecisionContext(round, 0, legalActions)
      const action = strategy.chooseAction(context)

      expect(strategy.difficulty).toBe(difficulty)
      expect(isLegalBotAction(action, legalActions)).toBe(true)
    })

    const beginnerStrategy = getHeuristicBotStrategy('beginner')
    const firstAction = beginnerStrategy.chooseAction(
      createBotDecisionContext(round, 0, legalActions),
    )
    const secondAction = beginnerStrategy.chooseAction(
      createBotDecisionContext(round, 0, legalActions),
    )

    expect(secondAction).toEqual(firstAction)
  })

  it('专家档显著放大孵赏相对死赏的收官价值', () => {
    const round = createBotTestRound({
      0: [...REWARD_DEFINITION_IDS],
      1: ['point_seven', 'point_five'],
      2: ['long_ren', 'yao_yao_wu'],
      3: ['point_eight', 'long_chang'],
    })
    const legalActions = listTurnActions(round, 0)
    const liveRewardAction = legalActions.find((action) => action.intent === 'lead-reward-live')
    const deadRewardAction = legalActions.find((action) => action.intent === 'lead-reward-dead')

    expect(liveRewardAction).toBeDefined()
    expect(deadRewardAction).toBeDefined()

    const context = createBotDecisionContext(round, 0, legalActions)
    const standardSpread =
      scoreBotAction(context, liveRewardAction!, 'standard') -
      scoreBotAction(context, deadRewardAction!, 'standard')
    const expertSpread =
      scoreBotAction(context, liveRewardAction!, 'expert') -
      scoreBotAction(context, deadRewardAction!, 'expert')

    expect(expertSpread).toBeGreaterThan(standardSpread + 500)
  })
})
