import { describe, expect, it } from 'vitest'

import { SeededRandom } from '@/rules-core/random'
import type {
  CardInstance,
  MatchState,
  PlayPattern,
  RandomSource,
  RoundState,
  SeatId,
  SeatState,
  TrickRecord,
} from '@/rules-core/types'
import {
  createDeck,
  DEFAULT_SEAT_CONFIGS,
  getCardDefinition,
  sortCardInstances,
} from '@/rules-variants/ji-an-da-suo-zi/cardCatalog'
import { createBotDecisionContext } from '@/rules-variants/ji-an-da-suo-zi/botObservation'
import {
  createInitialMatch,
  finishRoundAndReveal,
  listTurnActions,
  previewSelection,
  startRound,
  submitAction,
} from '@/rules-variants/ji-an-da-suo-zi/engine'
import {
  LONG_COMBO_RECIPES,
  REWARD_DEFINITION_IDS,
} from '@/rules-variants/ji-an-da-suo-zi/patternCatalog'
import { heuristicBotStrategy } from '@/rules-variants/ji-an-da-suo-zi/botStrategy'
import { calculateSettlement } from '@/rules-variants/ji-an-da-suo-zi/scoring'

class FixedRandom implements RandomSource {
  private index = 0

  private readonly values: number[]

  public constructor(values: number[]) {
    this.values = values
  }

  public next(): number {
    const value = this.values[this.index] ?? 0
    this.index += 1
    return value
  }

  public nextInt(maxExclusive: number): number {
    const value = this.values[this.index] ?? 0
    this.index += 1
    return value % maxExclusive
  }

  public shuffle<T>(items: T[]): T[] {
    return [...items]
  }
}

function takeCards(definitionIds: string[]): CardInstance[] {
  const pools = createDeck().reduce<Record<string, CardInstance[]>>((accumulator, card) => {
    accumulator[card.definitionId] ??= []
    accumulator[card.definitionId].push(card)
    return accumulator
  }, {})

  return definitionIds.map((definitionId) => {
    const card = pools[definitionId]?.shift()

    if (!card) {
      throw new Error(`测试牌池缺少 ${definitionId}`)
    }

    return card
  })
}

function createSeatState(seat: SeatId, definitionIds: string[]): SeatState {
  return {
    seat,
    config: { ...DEFAULT_SEAT_CONFIGS[seat], mode: 'human' },
    hand: sortCardInstances(takeCards(definitionIds)),
    wonTricks: [],
    wonPierCount: 0,
  }
}

function createRound(
  hands: Partial<Record<SeatId, string[]>>,
  currentSeat: SeatId = 0,
): RoundState {
  return {
    ruleSetId: 'ji-an-da-suo-zi',
    roundNumber: 1,
    phase: 'playing',
    seats: ([0, 1, 2, 3] as SeatId[]).map((seat) =>
      createSeatState(seat, hands[seat] ?? []),
    ),
    currentSeat,
    firstLeader: currentSeat,
    ceremony: {
      stage: 'first-round',
      roller: 0,
      roll: { first: 1, second: 1, sum: 2, key: '11', door: 'long' },
      firstLeader: currentSeat,
    },
    currentTrick: null,
    pendingDice: null,
    publicTrickLog: [],
    hiddenPlaysPendingReveal: 0,
    eventLog: [],
  }
}

function createMatchWithRound(round: RoundState): MatchState {
  return {
    matchId: 'test-match',
    ruleSetId: 'ji-an-da-suo-zi',
    seed: 1,
    phase: round.phase,
    seatConfigs: DEFAULT_SEAT_CONFIGS,
    roundNumber: round.roundNumber,
    currentRound: round,
    lastRoundLastTrickWinner: null,
    replayRounds: [],
  }
}

/**
 * 构造已有历史墩的局面，便于测试普通领出、最后一手等非首墩场景。
 */
function markAfterOpeningLead(round: RoundState): RoundState {
  round.publicTrickLog = [
    {
      trickIndex: 1,
      leader: 0,
      winner: 0,
      cardCount: 1,
      visibleWinningSeat: 0,
      plays: [],
      note: '测试中跳过开局首次领出。',
    },
  ]
  return round
}

/**
 * 向测试局面追加一组历史出牌。安全单张规则只关心牌面是否曾经明面出现，
 * 因此这里用最小 TrickRecord 构造公开或背面弃牌两种历史。
 */
function appendHistoryPlay(
  round: RoundState,
  definitionIds: string[],
  isOpen = true,
): RoundState {
  const cards = takeCards(definitionIds)
  const pattern: PlayPattern = {
    id: `history-${round.publicTrickLog.length + 1}`,
    label: isOpen ? '测试明牌' : `弃牌 ${cards.length} 张`,
    kind: 'single',
    group: isOpen ? 'safe-singles' : 'hidden',
    cardDefinitionIds: cards.map((card) => card.definitionId),
    cardInstanceIds: cards.map((card) => card.id),
    cardCount: cards.length,
    strength: 0,
    isOpen,
    source: isOpen ? 'natural' : 'hidden',
    note: isOpen ? '测试用历史明牌。' : '测试用历史弃牌。',
  }
  const trick: TrickRecord = {
    trickIndex: round.publicTrickLog.length + 1,
    leader: 0,
    winner: 0,
    cardCount: cards.length,
    visibleWinningSeat: 0,
    plays: [
      {
        seat: 0,
        pattern,
        revealed: isOpen,
        cards,
        message: pattern.note,
      },
    ],
    note: '测试历史墩。',
  }

  round.publicTrickLog.push(trick)
  return round
}

function selectCards(round: RoundState, seat: SeatId, definitionIds: string[]): string[] {
  const remainingHand = [...round.seats[seat].hand]

  return definitionIds.map((definitionId) => {
    const index = remainingHand.findIndex((card) => card.definitionId === definitionId)

    if (index < 0) {
      throw new Error(`座位 ${seat} 没有 ${definitionId}`)
    }

    const [card] = remainingHand.splice(index, 1)
    return card.id
  })
}

/**
 * 测试断言用的选牌集合比较，忽略前端拖动后可能产生的顺序差异。
 */
function selectedCardIdsMatchForTest(leftCardIds: string[], rightCardIds: string[]): boolean {
  if (leftCardIds.length !== rightCardIds.length) {
    return false
  }

  const rightCardIdSet = new Set(rightCardIds)
  return leftCardIds.every((cardId) => rightCardIdSet.has(cardId))
}

function countDefinitionIds(definitionIds: string[]): Record<string, number> {
  return definitionIds.reduce<Record<string, number>>((accumulator, definitionId) => {
    accumulator[definitionId] = (accumulator[definitionId] ?? 0) + 1
    return accumulator
  }, {})
}

/**
 * 普通主动明打测试需要避免误入“最后一手”分支，因此给待测组合补到 5 张以上。
 */
function createNonFinalHand(definitionIds: string[]): string[] {
  const result = [...definitionIds]
  const usedCount = countDefinitionIds(result)
  const deckCount = countDefinitionIds(createDeck().map((card) => card.definitionId))
  const fillerPool = [
    'long_tian',
    'long_di',
    'long_ren',
    'long_he',
    'long_mei',
    'long_chang',
    'long_ban',
    'yao_fu',
    'yao_si_liu',
    'yao_yao_liu',
    'yao_yao_wu',
    'point_nine',
    'point_eight',
    'point_seven',
    'point_five',
  ]

  for (const fillerDefinitionId of fillerPool) {
    if (result.length > 4) {
      break
    }

    if ((usedCount[fillerDefinitionId] ?? 0) >= (deckCount[fillerDefinitionId] ?? 0)) {
      continue
    }

    result.push(fillerDefinitionId)
    usedCount[fillerDefinitionId] = (usedCount[fillerDefinitionId] ?? 0) + 1
  }

  return result
}

function createSettlementRound(
  wonPierCounts: [number, number, number, number],
  lastTrickWinner: SeatId,
): RoundState {
  const round = createRound({}, lastTrickWinner)
  round.phase = 'awaiting-reveal'
  round.currentSeat = null
  round.lastTrickWinner = lastTrickWinner
  round.seats = round.seats.map((seatState, index) => ({
    ...seatState,
    wonPierCount: wonPierCounts[index],
  }))
  return round
}

describe('吉安打索子规则引擎', () => {
  it('长三牌面按上竖中横下竖绘制六个白点', () => {
    const longThreePips = getCardDefinition('long_chang').pips.map((pip) => ({
      x: pip.x,
      y: pip.y,
      color: pip.color,
    }))

    expect(longThreePips).toEqual([
      { x: 42, y: 28, color: 'white' },
      { x: 42, y: 55, color: 'white' },
      { x: 25, y: 100, color: 'white' },
      { x: 59, y: 100, color: 'white' },
      { x: 42, y: 145, color: 'white' },
      { x: 42, y: 172, color: 'white' },
    ])
  })

  it('完整识别规则文档允许主动明打的牌型', () => {
    const pairDefinitionIds = [
      'long_tian',
      'long_di',
      'long_ren',
      'long_he',
      'long_mei',
      'long_chang',
      'long_ban',
      'yao_fu',
      'yao_si_liu',
      'yao_yao_liu',
      'yao_yao_wu',
      'point_nine',
      'point_eight',
      'point_seven',
      'point_five',
    ]
    const leadCases = [
      { definitionIds: ['long_tian'], intent: 'lead-open' },
      { definitionIds: ['yao_fu'], intent: 'lead-open' },
      { definitionIds: ['point_nine'], intent: 'lead-open' },
      ...pairDefinitionIds.map((definitionId) => ({
        definitionIds: [definitionId, definitionId],
        intent: 'lead-open',
      })),
      { definitionIds: REWARD_DEFINITION_IDS, intent: 'lead-reward-live' },
      ...LONG_COMBO_RECIPES.map((recipe) => ({
        definitionIds: recipe.definitions,
        intent: 'lead-open',
      })),
    ]

    for (const leadCase of leadCases) {
      const round = markAfterOpeningLead(
        createRound({ 0: createNonFinalHand(leadCase.definitionIds) }, 0),
      )
      const selectedCardIds = selectCards(round, 0, leadCase.definitionIds)
      const preview = previewSelection(round, 0, selectedCardIds)

      expect(preview.actions.map((action) => action.intent)).toContain(leadCase.intent)
    }
  })

  it('拒绝普通非脑子单张主动明打', () => {
    const round = markAfterOpeningLead(createRound({ 0: createNonFinalHand(['long_di']) }, 0))
    const selectedCardIds = selectCards(round, 0, ['long_di'])

    expect(previewSelection(round, 0, selectedCardIds).actions).toHaveLength(0)
  })

  it('更大单张都已明面出现后，较小单张可以直接明打', () => {
    const round = appendHistoryPlay(
      markAfterOpeningLead(createRound({ 0: createNonFinalHand(['point_eight']) }, 0)),
      ['point_nine', 'point_nine'],
    )
    const selectedCardIds = selectCards(round, 0, ['point_eight'])
    const preview = previewSelection(round, 0, selectedCardIds)

    expect(preview.actions.map((action) => action.intent)).toEqual(['lead-open'])
    expect(
      listTurnActions(round, 0).some((action) =>
        selectedCardIdsMatchForTest(action.selectedCardIds, selectedCardIds),
      ),
    ).toBe(true)
  })

  it('背面弃掉的更大单张不算见过，不能解锁较小单张明打', () => {
    const round = appendHistoryPlay(
      markAfterOpeningLead(createRound({ 0: createNonFinalHand(['point_eight']) }, 0)),
      ['point_nine', 'point_nine'],
      false,
    )
    const selectedCardIds = selectCards(round, 0, ['point_eight'])

    expect(previewSelection(round, 0, selectedCardIds).actions).toHaveLength(0)
  })

  it('所有选中单张都已经无更大明牌可压时，可以跨门合并领出', () => {
    const round = markAfterOpeningLead(
      createRound({ 0: createNonFinalHand(['point_nine', 'yao_fu']) }, 0),
    )
    const selectedCardIds = selectCards(round, 0, ['point_nine', 'yao_fu'])
    const preview = previewSelection(round, 0, selectedCardIds)

    expect(preview.actions.map((action) => action.intent)).toEqual(['lead-open'])

    const afterLead = submitAction(
      createMatchWithRound(round),
      {
        seat: 0,
        intent: 'lead-open',
        selectedCardIds,
      },
      new SeededRandom(1),
    ).match.currentRound!

    expect(afterLead.currentTrick?.expectedCardCount).toBe(2)
    expect(afterLead.currentTrick?.currentTargetPattern?.group).toBe('safe-singles')
  })

  it('两张九点都明面出现后，天牌和八点可以作为安全单张一起领出', () => {
    const round = appendHistoryPlay(
      markAfterOpeningLead(
        createRound({ 0: createNonFinalHand(['long_tian', 'point_eight']) }, 0),
      ),
      ['point_nine', 'point_nine'],
    )
    const selectedCardIds = selectCards(round, 0, ['long_tian', 'point_eight'])
    const preview = previewSelection(round, 0, selectedCardIds)

    expect(preview.actions.map((action) => action.intent)).toEqual(['lead-open'])
  })

  it('九点和八点都明面出尽后，七点可以直接明打', () => {
    const round = appendHistoryPlay(
      appendHistoryPlay(
        markAfterOpeningLead(createRound({ 0: createNonFinalHand(['point_seven']) }, 0)),
        ['point_nine', 'point_nine'],
      ),
      ['point_eight', 'point_eight'],
    )
    const selectedCardIds = selectCards(round, 0, ['point_seven'])
    const preview = previewSelection(round, 0, selectedCardIds)

    expect(preview.actions.map((action) => action.intent)).toEqual(['lead-open'])
  })

  it('本局第一墩首次领出可以任意单张，但不能任意多张乱出', () => {
    const illegalRound = createRound(
      { 0: ['long_di', 'long_mei', 'long_chang', 'long_ban', 'yao_si_liu'] },
      0,
    )
    const illegalSelectedCardIds = selectCards(illegalRound, 0, ['long_di', 'long_mei'])
    const illegalPreview = previewSelection(illegalRound, 0, illegalSelectedCardIds)
    const singleSelectedCardIds = selectCards(illegalRound, 0, ['long_di'])
    const singlePreview = previewSelection(illegalRound, 0, singleSelectedCardIds)

    expect(illegalPreview.actions).toHaveLength(0)
    expect(singlePreview.actions.map((action) => action.intent)).toEqual(['lead-open'])
    expect(listTurnActions(illegalRound, 0).map((action) => action.intent)).not.toContain('roll-dice')
    expect(
      listTurnActions(illegalRound, 0).some((action) =>
        selectedCardIdsMatchForTest(action.selectedCardIds, singleSelectedCardIds),
      ),
    ).toBe(true)
    expect(() =>
      submitAction(
        createMatchWithRound(illegalRound),
        { seat: 0, intent: 'roll-dice', selectedCardIds: [] },
        new SeededRandom(1),
      ),
    ).toThrow('第一回合首次领出可以任意明出一张单牌，不用掷骰。')

    const pairRound = createRound(
      { 0: ['long_di', 'long_di', 'long_mei', 'long_chang', 'long_ban'] },
      0,
    )
    const pairSelectedCardIds = selectCards(pairRound, 0, ['long_di', 'long_di'])
    const pairPreview = previewSelection(pairRound, 0, pairSelectedCardIds)

    expect(pairPreview.actions.map((action) => action.intent)).toEqual(['lead-open'])

    const afterPairLead = submitAction(
      createMatchWithRound(pairRound),
      {
        seat: 0,
        intent: 'lead-open',
        selectedCardIds: pairSelectedCardIds,
      },
      new SeededRandom(1),
    ).match.currentRound!

    expect(afterPairLead.currentTrick?.plays[0].pattern.label).toBe('地地')
    expect(afterPairLead.currentTrick?.currentTargetPattern?.group).toBe('long-pair')
  })

  it('最后几张散牌时仍可领出其中的合法牌型，例如九点脑子或点子对子', () => {
    const round = markAfterOpeningLead(
      createRound({ 0: ['point_nine', 'point_eight', 'point_eight'] }, 0),
    )
    const nineSelectedCardIds = selectCards(round, 0, ['point_nine'])
    const pairSelectedCardIds = selectCards(round, 0, ['point_eight', 'point_eight'])
    const ninePreview = previewSelection(round, 0, nineSelectedCardIds)
    const pairPreview = previewSelection(round, 0, pairSelectedCardIds)

    expect(ninePreview.actions.map((action) => action.intent)).toEqual(['lead-open'])
    expect(pairPreview.actions.map((action) => action.intent)).toEqual(['lead-open'])
    expect(listTurnActions(round, 0).map((action) => action.label)).toEqual([
      '明打 八八',
      '明打 九',
      '掷骰子',
    ])

    const afterNineLead = submitAction(
      createMatchWithRound(round),
      {
        seat: 0,
        intent: 'lead-open',
        selectedCardIds: nineSelectedCardIds,
      },
      new SeededRandom(1),
    ).match.currentRound!

    expect(afterNineLead.currentTrick?.plays[0].pattern.label).toBe('九')
    expect(afterNineLead.currentTrick?.currentTargetPattern?.group).toBe('point-single')
  })

  it('赢下回合后下一次领出可以直接明打合法牌型，机器人不应优先掷骰', () => {
    const round = markAfterOpeningLead(
      createRound(
        {
          0: ['yao_si_liu', 'yao_si_liu', 'long_tian', 'point_nine', 'long_di'],
        },
        0,
      ),
    )
    const legalActions = listTurnActions(round, 0)
    const actionLabels = legalActions.map((action) => action.label)

    expect(actionLabels).toContain('明打 四六四六')
    expect(actionLabels).toContain('明打 天九')
    expect(legalActions.map((action) => action.intent)).toContain('roll-dice')

    const botAction = heuristicBotStrategy.chooseAction(
      createBotDecisionContext(round, 0, legalActions),
    )

    expect(botAction.intent).not.toBe('roll-dice')
  })

  it('机器人最后两墩赏会优先打孵赏争取翻倍赏钱', () => {
    const round = markAfterOpeningLead(
      createRound({ 0: REWARD_DEFINITION_IDS }, 0),
    )
    round.seats[0].config.mode = 'bot'
    round.seats[0].wonPierCount = 5
    const legalActions = listTurnActions(round, 0)

    expect(legalActions.map((action) => action.label)).toEqual(
      expect.arrayContaining(['打孵赏', '打死赏']),
    )

    const botAction = heuristicBotStrategy.chooseAction(
      createBotDecisionContext(round, 0, legalActions),
    )

    expect(botAction.intent).toBe('lead-reward-live')
    expect(selectedCardIdsMatchForTest(
      botAction.selectedCardIds,
      selectCards(round, 0, REWARD_DEFINITION_IDS),
    )).toBe(true)
  })

  it('机器人确认吃赏对子已经见光时，普通赏也会优先打活赏', () => {
    const round = appendHistoryPlay(
      appendHistoryPlay(
        appendHistoryPlay(
          markAfterOpeningLead(
            createRound(
              {
                0: ['point_three', 'point_six', 'long_ban', 'yao_yao_wu', 'long_chang'],
              },
              0,
            ),
          ),
          ['point_nine', 'point_nine'],
        ),
        ['point_seven', 'point_seven'],
      ),
      ['point_five', 'point_five'],
    )
    round.seats[0].config.mode = 'bot'
    const legalActions = listTurnActions(round, 0)

    expect(legalActions.map((action) => action.label)).toContain('打活赏')
    expect(legalActions.map((action) => action.label)).toContain('打死赏')

    const botAction = heuristicBotStrategy.chooseAction(
      createBotDecisionContext(round, 0, legalActions),
    )

    expect(botAction.intent).toBe('lead-reward-live')
  })

  it('机器人早期后手不会为了 1 墩浪费点子脑子', () => {
    const round = createRound(
      {
        0: ['point_five'],
        1: ['point_nine', 'long_ban', 'yao_yao_wu', 'long_chang', 'point_three'],
      },
      0,
    )
    const afterLead = submitAction(
      createMatchWithRound(round),
      {
        seat: 0,
        intent: 'lead-open',
        selectedCardIds: selectCards(round, 0, ['point_five']),
      },
      new SeededRandom(1),
    ).match.currentRound!
    afterLead.seats[1].config.mode = 'bot'
    const legalActions = listTurnActions(afterLead, 1)

    expect(legalActions.map((action) => action.label)).toContain('吃 九')

    const botAction = heuristicBotStrategy.chooseAction(
      createBotDecisionContext(afterLead, 1, legalActions),
    )

    expect(botAction.intent).toBe('respond-pass-hidden')
    expect(selectedCardIdsMatchForTest(
      botAction.selectedCardIds,
      selectCards(afterLead, 1, ['long_ban']),
    )).toBe(true)
  })

  it('机器人最后一墩能吃时会优先争最后控制权', () => {
    const round = createRound(
      {
        0: ['point_five'],
        1: ['point_nine'],
      },
      0,
    )
    const afterLead = submitAction(
      createMatchWithRound(round),
      {
        seat: 0,
        intent: 'lead-open',
        selectedCardIds: selectCards(round, 0, ['point_five']),
      },
      new SeededRandom(1),
    ).match.currentRound!
    afterLead.seats[1].config.mode = 'bot'
    const legalActions = listTurnActions(afterLead, 1)
    const botAction = heuristicBotStrategy.chooseAction(
      createBotDecisionContext(afterLead, 1, legalActions),
    )

    expect(botAction.intent).toBe('respond-eat')
    expect(selectedCardIdsMatchForTest(
      botAction.selectedCardIds,
      selectCards(afterLead, 1, ['point_nine']),
    )).toBe(true)
  })

  it('最后一张非脑子不用掷骰，直接作为最后一手明出', () => {
    const round = markAfterOpeningLead(createRound({ 0: ['long_di'] }, 0))
    const actions = listTurnActions(round, 0)

    expect(actions.map((action) => action.intent)).toEqual(['lead-final-open'])
    expect(actions.map((action) => action.intent)).not.toContain('roll-dice')
    expect(actions[0].selectedCardIds).toEqual(selectCards(round, 0, ['long_di']))
  })

  it('最后一手正好是对子或长门组合时不再提供掷骰', () => {
    const pairRound = markAfterOpeningLead(createRound({ 0: ['long_di', 'long_di'] }, 0))
    const pairActions = listTurnActions(pairRound, 0)

    expect(pairActions.map((action) => action.intent)).toEqual(['lead-final-open'])
    expect(pairActions.map((action) => action.intent)).not.toContain('roll-dice')

    const comboRound = markAfterOpeningLead(
      createRound(
        { 0: ['long_tian', 'long_tian', 'point_nine', 'point_nine'] },
        0,
      ),
    )
    const comboActions = listTurnActions(comboRound, 0)

    expect(comboActions.map((action) => action.intent)).toEqual(['lead-final-open'])
    expect(comboActions[0].selectedCardIds).toHaveLength(4)
  })

  it('最后几张散牌无法组成明牌时不能主动弃牌，只能掷骰', () => {
    const round = markAfterOpeningLead(createRound({ 0: ['long_di', 'point_five'] }, 0))
    const actions = listTurnActions(round, 0)

    expect(actions.map((action) => action.intent)).toEqual(['roll-dice'])

    expect(() =>
      submitAction(
        createMatchWithRound(round),
        {
          seat: 0,
          intent: 'respond-pass-hidden',
          selectedCardIds: selectCards(round, 0, ['long_di', 'point_five']),
        },
        new SeededRandom(1),
      ),
    ).toThrow('领打阶段只能明打牌型或掷骰。')

    const afterRoll = submitAction(
      createMatchWithRound(round),
      { seat: 0, intent: 'roll-dice', selectedCardIds: [] },
      new FixedRandom([0, 1]),
    ).match.currentRound!
    const afterDiceOpen = submitAction(
      createMatchWithRound(afterRoll),
      {
        seat: 0,
        intent: 'resolve-dice-open',
        selectedCardIds: selectCards(afterRoll, 0, ['point_five']),
      },
      new SeededRandom(1),
    ).match.currentRound!

    expect(afterDiceOpen.currentTrick?.expectedCardCount).toBe(1)
  })

  it('机器人最后四张散牌领出时不能整组弃牌，只能先掷骰', () => {
    const round = markAfterOpeningLead(
      createRound({ 0: ['long_di', 'long_ren', 'yao_si_liu', 'point_five'] }, 0),
    )
    round.seats[0].config.mode = 'bot'
    const legalActions = listTurnActions(round, 0)

    expect(legalActions.map((action) => action.intent)).toEqual(['roll-dice'])

    const botAction = heuristicBotStrategy.chooseAction(
      createBotDecisionContext(round, 0, legalActions),
    )

    expect(botAction).toEqual({
      seat: 0,
      intent: 'roll-dice',
      selectedCardIds: [],
    })
    expect(() =>
      submitAction(
        createMatchWithRound(round),
        {
          seat: 0,
          intent: 'respond-pass-hidden',
          selectedCardIds: selectCards(round, 0, [
            'long_di',
            'long_ren',
            'yao_si_liu',
            'point_five',
          ]),
        },
        new SeededRandom(1),
      ),
    ).toThrow('领打阶段只能明打牌型或掷骰。')
  })

  it('支持同组同张数更大牌明吃，且不同组不能明吃', () => {
    const round = createRound(
      {
        0: ['long_ren', 'point_seven'],
        1: ['long_di', 'point_eight', 'point_nine', 'point_nine'],
      },
      0,
    )
    const match = createMatchWithRound(round)
    const afterLead = submitAction(
      match,
      {
        seat: 0,
        intent: 'lead-open',
        selectedCardIds: selectCards(round, 0, ['long_ren', 'point_seven']),
      },
      new SeededRandom(1),
    ).match
    const currentRound = afterLead.currentRound!

    expect(
      previewSelection(
        currentRound,
        1,
        selectCards(currentRound, 1, ['long_di', 'point_eight']),
      ).actions.map((action) => action.intent),
    ).toContain('respond-eat')

    expect(
      previewSelection(
        currentRound,
        1,
        selectCards(currentRound, 1, ['point_nine', 'point_nine']),
      ).actions.map((action) => action.intent),
    ).not.toContain('respond-eat')
  })

  it('活赏遇到九九七七五五必须吃，八八不能吃活赏', () => {
    const mustEatRound = createRound(
      {
        0: ['point_three', 'point_six'],
        1: ['point_nine', 'point_nine'],
      },
      0,
    )
    const mustEatMatch = createMatchWithRound(mustEatRound)
    const afterLiveReward = submitAction(
      mustEatMatch,
      {
        seat: 0,
        intent: 'lead-reward-live',
        selectedCardIds: selectCards(mustEatRound, 0, REWARD_DEFINITION_IDS),
      },
      new SeededRandom(1),
    ).match.currentRound!
    const mustEatActions = listTurnActions(afterLiveReward, 1)

    expect(mustEatActions.map((action) => action.intent)).toContain('respond-eat')
    expect(mustEatActions.map((action) => action.intent)).not.toContain(
      'respond-pass-hidden',
    )

    const eightRound = createRound(
      {
        0: ['point_three', 'point_six'],
        1: ['point_eight', 'point_eight'],
      },
      0,
    )
    const afterEightLiveReward = submitAction(
      createMatchWithRound(eightRound),
      {
        seat: 0,
        intent: 'lead-reward-live',
        selectedCardIds: selectCards(eightRound, 0, REWARD_DEFINITION_IDS),
      },
      new SeededRandom(1),
    ).match.currentRound!
    const eightActions = listTurnActions(afterEightLiveReward, 1)

    expect(eightActions.map((action) => action.intent)).not.toContain('respond-eat')
    expect(eightActions.map((action) => action.intent)).toContain('respond-pass-hidden')
  })

  it('掷骰定门后有对应门必须明出，没有对应门才允许卖屁股弃牌', () => {
    const hasDoorRound = markAfterOpeningLead(
      createRound(
        { 0: ['long_ban', 'point_five', 'point_seven', 'point_eight', 'point_nine'] },
        0,
      ),
    )
    const afterRoll = submitAction(
      createMatchWithRound(hasDoorRound),
      { seat: 0, intent: 'roll-dice', selectedCardIds: [] },
      new FixedRandom([0, 0]),
    ).match.currentRound!

    expect(afterRoll.pendingDice?.forcedDoor).toBe('long')
    expect(listTurnActions(afterRoll, 0).map((action) => action.intent)).toEqual([
      'resolve-dice-open',
    ])

    const noDoorRound = markAfterOpeningLead(
      createRound(
        { 0: ['point_five', 'point_five', 'point_seven', 'point_seven', 'point_eight'] },
        0,
      ),
    )
    const afterNoDoorRoll = submitAction(
      createMatchWithRound(noDoorRound),
      { seat: 0, intent: 'roll-dice', selectedCardIds: [] },
      new FixedRandom([0, 0]),
    ).match.currentRound!

    expect(afterNoDoorRoll.pendingDice?.hasMatchingDoor).toBe(false)
    expect(new Set(listTurnActions(afterNoDoorRoll, 0).map((action) => action.intent))).toEqual(
      new Set(['resolve-dice-hidden']),
    )
  })

  it('掷到点子门但手里没有点子时，可以任选一张牌面朝下卖屁股', () => {
    const noPointRound = markAfterOpeningLead(
      createRound(
        { 0: ['long_tian', 'long_di', 'long_ren', 'yao_fu', 'yao_yao_wu'] },
        0,
      ),
    )
    const afterPointRoll = submitAction(
      createMatchWithRound(noPointRound),
      { seat: 0, intent: 'roll-dice', selectedCardIds: [] },
      new FixedRandom([4, 1]),
    ).match.currentRound!
    const selectedCardIds = selectCards(afterPointRoll, 0, ['long_tian'])
    const preview = previewSelection(afterPointRoll, 0, selectedCardIds)

    expect(afterPointRoll.pendingDice?.forcedDoor).toBe('point')
    expect(afterPointRoll.pendingDice?.hasMatchingDoor).toBe(false)
    expect(preview.actions.map((action) => action.intent)).toEqual(['resolve-dice-hidden'])

    const afterHidden = submitAction(
      createMatchWithRound(afterPointRoll),
      {
        seat: 0,
        intent: 'resolve-dice-hidden',
        selectedCardIds,
      },
      new SeededRandom(1),
    ).match.currentRound!

    expect(afterHidden.currentTrick?.plays[0].revealed).toBe(false)
    expect(afterHidden.currentTrick?.plays[0].pattern.isOpen).toBe(false)
    expect(afterHidden.currentTrick?.plays[0].pattern.source).toBe('dice')
    expect(afterHidden.currentTrick?.expectedCardCount).toBe(1)
    expect(afterHidden.currentTrick?.forcedDoor).toBe('point')
  })

  it('卖屁股开墩后，后手有定门单张可以明吃，后续更大同门单张可继续吃', () => {
    const round = markAfterOpeningLead(
      createRound(
        {
          0: ['point_eight'],
          1: ['long_tian', 'long_di', 'yao_fu'],
          2: ['long_ren'],
          3: ['point_six'],
        },
        1,
      ),
    )
    const afterPointRoll = submitAction(
      createMatchWithRound(round),
      { seat: 1, intent: 'roll-dice', selectedCardIds: [] },
      new FixedRandom([4, 1]),
    ).match.currentRound!
    const afterHiddenLead = submitAction(
      createMatchWithRound(afterPointRoll),
      {
        seat: 1,
        intent: 'resolve-dice-hidden',
        selectedCardIds: selectCards(afterPointRoll, 1, ['long_tian']),
      },
      new SeededRandom(1),
    ).match.currentRound!

    expect(afterHiddenLead.currentTrick?.currentTargetPattern).toBeNull()
    expect(afterHiddenLead.currentTrick?.forcedDoor).toBe('point')
    expect(listTurnActions(afterHiddenLead, 2).map((action) => action.intent)).toEqual([
      'respond-pass-hidden',
    ])

    const afterNorthDiscard = submitAction(
      createMatchWithRound(afterHiddenLead),
      {
        seat: 2,
        intent: 'respond-pass-hidden',
        selectedCardIds: selectCards(afterHiddenLead, 2, ['long_ren']),
      },
      new SeededRandom(1),
    ).match.currentRound!
    const eastPreview = previewSelection(
      afterNorthDiscard,
      3,
      selectCards(afterNorthDiscard, 3, ['point_six']),
    )

    expect(eastPreview.actions.map((action) => action.intent)).toEqual([
      'respond-eat',
      'respond-pass-hidden',
    ])

    const afterEastEat = submitAction(
      createMatchWithRound(afterNorthDiscard),
      {
        seat: 3,
        intent: 'respond-eat',
        selectedCardIds: selectCards(afterNorthDiscard, 3, ['point_six']),
      },
      new SeededRandom(1),
    ).match.currentRound!
    const southPreview = previewSelection(
      afterEastEat,
      0,
      selectCards(afterEastEat, 0, ['point_eight']),
    )

    expect(afterEastEat.currentTrick?.currentTargetPattern?.label).toBe('六')
    expect(afterEastEat.currentTrick?.currentWinningSeat).toBe(3)
    expect(southPreview.actions.map((action) => action.intent)).toEqual([
      'respond-eat',
      'respond-pass-hidden',
    ])
  })

  it('掷骰后无论明出还是卖屁股都只能出一张牌', () => {
    const noPointRound = markAfterOpeningLead(
      createRound(
        { 0: ['long_tian', 'long_di', 'long_ren', 'yao_fu', 'yao_yao_wu'] },
        0,
      ),
    )
    const afterPointRoll = submitAction(
      createMatchWithRound(noPointRound),
      { seat: 0, intent: 'roll-dice', selectedCardIds: [] },
      new FixedRandom([4, 1]),
    ).match.currentRound!
    const hiddenCardIds = selectCards(afterPointRoll, 0, ['long_tian', 'long_di'])

    expect(() =>
      submitAction(
        createMatchWithRound(afterPointRoll),
        {
          seat: 0,
          intent: 'resolve-dice-hidden',
          selectedCardIds: hiddenCardIds,
        },
        new SeededRandom(1),
      ),
    ).toThrow('掷骰后一次只能出 1 张牌。')

    const hasPointRound = markAfterOpeningLead(
      createRound(
        { 0: ['point_five', 'point_seven', 'long_tian', 'long_di', 'yao_fu'] },
        0,
      ),
    )
    const afterHasPointRoll = submitAction(
      createMatchWithRound(hasPointRound),
      { seat: 0, intent: 'roll-dice', selectedCardIds: [] },
      new FixedRandom([4, 1]),
    ).match.currentRound!
    const openCardIds = selectCards(afterHasPointRoll, 0, ['point_five', 'point_seven'])

    expect(() =>
      submitAction(
        createMatchWithRound(afterHasPointRoll),
        {
          seat: 0,
          intent: 'resolve-dice-open',
          selectedCardIds: openCardIds,
        },
        new SeededRandom(1),
      ),
    ).toThrow('掷骰后一次只能出 1 张牌。')

    expect(() =>
      submitAction(
        createMatchWithRound(afterHasPointRoll),
        {
          seat: 0,
          intent: 'resolve-dice-hidden',
          selectedCardIds: selectCards(afterHasPointRoll, 0, ['point_five']),
        },
        new SeededRandom(1),
      ),
    ).toThrow('掷骰定门后有对应门类时必须明出 1 张，不能弃牌。')

    expect(() =>
      submitAction(
        createMatchWithRound(afterPointRoll),
        {
          seat: 0,
          intent: 'resolve-dice-open',
          selectedCardIds: selectCards(afterPointRoll, 0, ['long_tian']),
        },
        new SeededRandom(1),
      ),
    ).toThrow('掷骰定门后没有对应门类时，只能背面卖屁股 1 张。')
  })

  it('第一局和后续局按规则掷骰决定先手', () => {
    const firstRoundResult = startRound(
      createInitialMatch(1, DEFAULT_SEAT_CONFIGS),
      new SeededRandom(1),
    )

    expect(firstRoundResult.match.currentRound?.ceremony.stage).toBe('first-round')
    expect(firstRoundResult.match.currentRound?.firstLeader).toBeGreaterThanOrEqual(0)
    expect(firstRoundResult.match.currentRound?.firstLeader).toBeLessThanOrEqual(3)

    const regularSeed = {
      ...firstRoundResult.match,
      roundNumber: 1,
      lastRoundLastTrickWinner: 0 as SeatId,
    }
    const regularRoundResult = startRound(regularSeed, new FixedRandom([0, 0]))

    expect(regularRoundResult.match.currentRound?.ceremony.stage).toBe('regular-round')
    expect(regularRoundResult.match.currentRound?.ceremony.roller).toBe(2)
  })

  it('结算覆盖 3接7 到满8墩带赏', () => {
    const collectorCases: Array<{
      counts: [number, number, number, number]
      expected: number
    }> = [
      { counts: [3, 0, 1, 4], expected: 7 },
      { counts: [4, 0, 0, 4], expected: 8 },
      { counts: [5, 0, 0, 3], expected: 9 },
      { counts: [6, 0, 0, 2], expected: 10 },
      { counts: [7, 0, 0, 1], expected: 11 },
    ]

    for (const collectorCase of collectorCases) {
      const settlement = calculateSettlement(
        createSettlementRound(collectorCase.counts, 0),
      )

      expect(settlement.seats[0].baseDelta).toBe(collectorCase.expected)
    }

    const sweepRound = createSettlementRound([8, 0, 0, 0], 0)
    expect(calculateSettlement(sweepRound).seats[0].totalDelta).toBe(24)

    sweepRound.rewardOutcome = {
      owner: 0,
      mode: 'live',
      wasLastTwo: false,
      wasEaten: false,
      trickIndex: 3,
      winner: 0,
    }
    const sweepWithReward = calculateSettlement(sweepRound)
    expect(sweepWithReward.seats[0].baseDelta).toBe(24)
    expect(sweepWithReward.seats[0].rewardDelta).toBe(6)
    expect(sweepWithReward.seats[0].totalDelta).toBe(30)
    expect(sweepWithReward.seats[1].baseDelta).toBe(-8)
    expect(sweepWithReward.seats[1].rewardDelta).toBe(-2)
    expect(sweepWithReward.seats[1].totalDelta).toBe(-10)
    expect(sweepWithReward.summary).toBe('满 8 墩结算，基础每家出 8 个，赏钱每家另出 2 个。')

    sweepRound.rewardOutcome.wasLastTwo = true
    const sweepWithLastTwoReward = calculateSettlement(sweepRound)
    expect(sweepWithLastTwoReward.seats[0].baseDelta).toBe(24)
    expect(sweepWithLastTwoReward.seats[0].rewardDelta).toBe(24)
    expect(sweepWithLastTwoReward.seats[0].totalDelta).toBe(48)
    expect(sweepWithLastTwoReward.seats[1].baseDelta).toBe(-8)
    expect(sweepWithLastTwoReward.seats[1].rewardDelta).toBe(-8)
    expect(sweepWithLastTwoReward.seats[1].totalDelta).toBe(-16)
    expect(sweepWithLastTwoReward.summary).toBe(
      '满 8 墩结算，基础每家出 8 个，孵赏钱每家另出 8 个。',
    )
  })

  it('未赢最后一墩但打到 5 墩时，基础仍然进 1 个', () => {
    const settlement = calculateSettlement(createSettlementRound([5, 3, 0, 0], 1))

    expect(settlement.seats[0].baseDelta).toBe(1)
    expect(settlement.seats[0].totalDelta).toBe(1)
    expect(settlement.seats[1].baseDelta).toBe(7)
    expect(settlement.seats[2].baseDelta).toBe(-4)
    expect(settlement.seats[3].baseDelta).toBe(-4)
  })

  it('未赢最后一墩但打到 7 墩时，基础仍然进 3 个', () => {
    const settlement = calculateSettlement(createSettlementRound([7, 1, 0, 0], 1))

    expect(settlement.seats[0].baseDelta).toBe(3)
    expect(settlement.seats[0].totalDelta).toBe(3)
    expect(settlement.seats[1].baseDelta).toBe(5)
    expect(settlement.seats[2].baseDelta).toBe(-4)
    expect(settlement.seats[3].baseDelta).toBe(-4)
  })

  it('普通活赏只向未满 3 墩的人收赏钱，3 墩及以上免出', () => {
    const round = createSettlementRound([5, 3, 0, 0], 1)

    round.rewardOutcome = {
      owner: 1,
      mode: 'live',
      wasLastTwo: false,
      wasEaten: false,
      trickIndex: 3,
      winner: 1,
    }

    const settlement = calculateSettlement(round)

    expect(settlement.seats[0].baseDelta).toBe(1)
    expect(settlement.seats[0].rewardDelta).toBe(0)
    expect(settlement.seats[0].totalDelta).toBe(1)
    expect(settlement.seats[1].rewardDelta).toBe(4)
    expect(settlement.seats[2].rewardDelta).toBe(-2)
    expect(settlement.seats[3].rewardDelta).toBe(-2)
    expect(settlement.summary).toBe(
      '基础分按 4 墩保本逐家进出，最后一回合赢家承接净额。中途赏未被吃，未满 3 墩的玩家每人另出 2 个赏钱。',
    )
  })

  it('孵赏只向未满 3 墩的人收孵赏钱，并在结算文案里使用传统叫法', () => {
    const round = createSettlementRound([2, 2, 3, 1], 0)

    round.rewardOutcome = {
      owner: 0,
      mode: 'live',
      wasLastTwo: true,
      wasEaten: false,
      trickIndex: 5,
      winner: 0,
    }

    const settlement = calculateSettlement(round)

    expect(settlement.seats[0].rewardDelta).toBe(8)
    expect(settlement.seats[1].rewardDelta).toBe(-4)
    expect(settlement.seats[2].rewardDelta).toBe(0)
    expect(settlement.seats[3].rewardDelta).toBe(-4)
    expect(settlement.seats[0].summary).toContain('孵赏钱收 8 个')
    expect(settlement.seats[1].summary).toContain('孵赏钱出 4 个')
    expect(settlement.summary).toBe(
      '基础分按 4 墩保本逐家进出，最后一回合赢家承接净额。孵赏未被吃，未满 3 墩的玩家每人另出 4 个孵赏钱。',
    )
  })

  it('死赏不能被吃但不产生额外赏钱', () => {
    const sweepRound = createSettlementRound([8, 0, 0, 0], 0)

    sweepRound.rewardOutcome = {
      owner: 0,
      mode: 'dead',
      wasLastTwo: true,
      wasEaten: false,
      trickIndex: 4,
      winner: 0,
    }

    const settlement = calculateSettlement(sweepRound)

    expect(settlement.seats[0].totalDelta).toBe(24)
    expect(settlement.seats[1].totalDelta).toBe(-8)
    expect(settlement.summary).toBe('满 8 墩结算，每家出 8 个。')
  })

  it('背面弃牌只在整局结束后统一翻开，并同步到赢墩堆', () => {
    const [card] = takeCards(['long_ban'])
    const hiddenPattern: PlayPattern = {
      id: 'hidden-test',
      label: '弃牌 1 张',
      kind: 'single',
      group: 'hidden',
      cardDefinitionIds: [card.definitionId],
      cardInstanceIds: [card.id],
      cardCount: 1,
      strength: 0,
      isOpen: false,
      source: 'hidden',
      note: '测试背面弃牌。',
    }
    const hiddenPlay = {
      seat: 1 as SeatId,
      pattern: hiddenPattern,
      revealed: false,
      cards: [card],
      message: '测试弃牌。',
    }
    const trick: TrickRecord = {
      trickIndex: 1,
      leader: 0,
      winner: 0,
      cardCount: 1,
      visibleWinningSeat: 0,
      plays: [hiddenPlay],
      note: '测试墩。',
    }
    const round = createSettlementRound([8, 0, 0, 0], 0)
    round.publicTrickLog = [trick]
    round.seats[0].wonTricks = [trick]
    const match = createMatchWithRound(round)
    match.phase = 'awaiting-reveal'

    expect(match.currentRound?.publicTrickLog[0].plays[0].revealed).toBe(false)

    const revealedMatch = finishRoundAndReveal(match).match

    expect(revealedMatch.currentRound?.publicTrickLog[0].plays[0].revealed).toBe(true)
    expect(revealedMatch.currentRound?.seats[0].wonTricks[0].plays[0].revealed).toBe(true)
    expect(getCardDefinition(card.definitionId).name).toBe('板')
  })
})
