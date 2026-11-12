import { describe, expect, it } from 'vitest'

import type { CardDefinition, MatchState, RoundState } from '@/rules-core/types'
import { CARD_DEFINITIONS, DEFAULT_SEAT_CONFIGS } from '@/rules-variants/ji-an-da-suo-zi/cardCatalog'
import { MockMatchApi } from '@/services/mock-match-api/MockMatchApi'
import { TILE_SIZE } from '@/ui/table3d/tableMetrics'
import { buildTableView, type TilePlacement } from '@/ui/table3d/tableView'

const cardDefinitions = Object.fromEntries(
  CARD_DEFINITIONS.map((definition) => [definition.id, definition]),
) as Record<string, CardDefinition>

/**
 * 以座位 0 的视角计算某一时刻的桌面摆位。
 *
 * @param round 单局状态
 * @returns 全部实体牌的摆位
 */
function viewOf(round: RoundState): TilePlacement[] {
  return buildTableView({
    round,
    reviewTrick: null,
    handSeat: 0,
    handCards: round.seats[0].hand,
    selectedCardIds: [],
    cardDefinitions,
    ceremony: null,
    collectStep: 0,
  })
}

/**
 * 用真实规则跑一局四机器人对局，并收集每一步之后的状态。
 *
 * @returns 从开局到揭牌结算的全部整场状态快照
 */
function playWholeRound(): MatchState[] {
  const api = new MockMatchApi(42)
  api.configureSeats(DEFAULT_SEAT_CONFIGS.map((seat) => ({ ...seat, mode: 'bot' })))
  const snapshots = [api.startRound()]
  for (let step = 0; step < 100 && snapshots[snapshots.length - 1].currentRound?.phase === 'playing'; step += 1) {
    snapshots.push(api.requestBotMove())
  }
  snapshots.push(api.finishRoundAndReveal())
  return snapshots
}

describe('buildTableView', () => {
  const snapshots = playWholeRound()
  const rounds = snapshots.flatMap((match) => (match.currentRound ? [match.currentRound] : []))

  it('开局仪式用的就是开局后的 32 张实体牌，随手垒成六到九墩且每墩从桌面连续垒起', () => {
    const base = { round: rounds[0], reviewTrick: null, handSeat: 0 as const, handCards: rounds[0].seats[0].hand, selectedCardIds: [], cardDefinitions, collectStep: 0 }
    const stacked = buildTableView({ ...base, ceremony: { phase: 'stack', shuffleStep: 0 } })
    const dealt = buildTableView({ ...base, ceremony: null })
    expect(stacked.map((placement) => placement.key).sort()).toEqual(dealt.map((placement) => placement.key).sort())

    /*
     * 所有牌墩排成一条线：横向都在桌子中线附近；同一墩的牌纵向位置相同，按它归并检查墩数、张数和层数连续。
     */
    const stacks = new Map<string, number[]>()
    const scale = stacked[0].scale ?? 1
    for (const placement of stacked) {
      const key = placement.position.z.toFixed(4)
      expect(Math.abs(placement.position.x)).toBeLessThan(0.4)
      expect(Math.abs(placement.position.z)).toBeLessThan(7.2)
      expect(placement.scale).toBe(scale)
      /*
       * 牌竖着放：长边朝向本方和对家，只允许随手摆放的小角度歪斜。
       */
      expect(Math.abs(placement.pose.yaw)).toBeLessThan(0.3)
      const layer = Math.round((placement.position.y / scale - TILE_SIZE.depth / 2) / TILE_SIZE.depth)
      stacks.set(key, [...(stacks.get(key) ?? []), layer])
      expect(placement.pose.faceDown).toBe(true)
    }
    expect(stacks.size).toBeGreaterThanOrEqual(6)
    expect(stacks.size).toBeLessThanOrEqual(9)
    for (const layers of stacks.values()) {
      expect(layers.length).toBeGreaterThanOrEqual(2)
      expect([...layers].sort((left, right) => left - right)).toEqual(layers.map((_, index) => index))
    }
  })

  it('抓牌阶段从先手开始，每家每次抓两张', () => {
    const round = rounds[0]
    const dealing = buildTableView({
      round,
      reviewTrick: null,
      handSeat: 0,
      handCards: round.seats[0].hand,
      selectedCardIds: [],
      cardDefinitions,
      ceremony: { phase: 'deal', shuffleStep: 0 },
      collectStep: 0,
    })
    /*
     * 最先起飞的两张牌必须属于先手：先手是本方时是手牌，否则是先手面前的牌背。
     */
    const earliest = [...dealing].sort((left, right) => left.moveDelay - right.moveDelay).slice(0, 2)
    const expectedMarker = round.firstLeader === 0 ? ':hand:' : `:back:${round.firstLeader}:`
    expect(earliest.every((placement) => placement.key.includes(expectedMarker))).toBe(true)
  })

  it('整局任意时刻桌面上都恰好是 32 张实体牌且标识不重复', () => {
    for (const round of rounds) {
      const placements = viewOf(round)
      expect(placements).toHaveLength(32)
      expect(new Set(placements.map((placement) => placement.key)).size).toBe(32)
    }
  })

  it('未公开的暗牌不向渲染层输出牌面', () => {
    for (const round of rounds.filter((item) => item.phase !== 'settled')) {
      const hiddenPlayCount = [...round.publicTrickLog, ...(round.currentTrick ? [round.currentTrick] : [])]
        .flatMap((trick) => trick.plays)
        .filter((play) => !play.pattern.isOpen && !play.revealed)
        .reduce((total, play) => total + play.cards.length, 0)
      const faceless = viewOf(round).filter((placement) => placement.key.includes(':play:') && placement.pips === null)
      expect(faceless).toHaveLength(hiddenPlayCount)
      expect(faceless.every((placement) => placement.pose.faceDown)).toBe(true)
    }
  })

  it('本方打出的牌沿用手里的实体牌', () => {
    const afterOwnPlay = rounds.find((round) => round.currentTrick?.plays.some((play) => play.seat === 0))
    const ownPlay = afterOwnPlay?.currentTrick?.plays.find((play) => play.seat === 0)
    expect(ownPlay).toBeDefined()
    const placement = viewOf(afterOwnPlay as RoundState).find((item) =>
      item.key.endsWith(`:play:${afterOwnPlay?.currentTrick?.trickIndex}:0:0`),
    )
    expect(placement?.inheritKey).toBe(`r1:hand:${ownPlay?.cards[0].id}`)
  })

  it('收墩时赢家的牌依次叠到左手边、对家、右手边的牌上，最后一步四家的牌叠成一摞', () => {
    const round = rounds.find((item) => item.publicTrickLog.length > 0 && item.phase === 'playing') as RoundState
    const trick = round.publicTrickLog[round.publicTrickLog.length - 1]
    const single = trick.plays.every((play) => play.cards.length === 1)
    const view = (collectStep: number) =>
      buildTableView({
        round: { ...round, currentTrick: null },
        reviewTrick: trick,
        handSeat: 0,
        handCards: round.seats[0].hand,
        selectedCardIds: [],
        cardDefinitions,
        ceremony: null,
        collectStep,
      }).filter((placement) => placement.key.includes(`:play:${trick.trickIndex}:`))
    const layerOf = (placement: TilePlacement) =>
      Math.round((placement.position.y - TILE_SIZE.depth / 2) / TILE_SIZE.depth)
    const keyOf = (seat: number) => `r1:play:${trick.trickIndex}:${seat}:0`
    const leftOfWinner = (trick.winner + 3) % 4

    /*
     * 还没开始收：所有牌都贴着桌面。
     */
    expect(view(0).every((placement) => layerOf(placement) === 0 || !single)).toBe(true)
    /*
     * 第一步：赢家的牌压在左手边那家的牌上，两张牌位置相同、赢家在上。
     */
    const first = view(1)
    const winnerTile = first.find((placement) => placement.key === keyOf(trick.winner)) as TilePlacement
    const leftTile = first.find((placement) => placement.key === keyOf(leftOfWinner)) as TilePlacement
    expect(winnerTile.position.x).toBeCloseTo(leftTile.position.x)
    expect(winnerTile.position.z).toBeCloseTo(leftTile.position.z)
    expect(layerOf(winnerTile) - layerOf(leftTile)).toBe(1)
    /*
     * 最后一步：每一摞四张，赢家的牌在最上面。
     */
    const last = view(3).filter((placement) => placement.key.endsWith(':0'))
    expect(new Set(last.map((placement) => `${placement.position.x.toFixed(2)}:${placement.position.z.toFixed(2)}`)).size).toBe(1)
    expect(Math.max(...last.map(layerOf)) - Math.min(...last.map(layerOf))).toBe(3)
    const top = [...last].sort((a, b) => layerOf(b) - layerOf(a))[0]
    expect(top.key).toBe(keyOf(trick.winner))
  })

  it('结算后全部牌垒成四张一摞，摞数等于各家赢的墩数，暗牌全部翻出牌面', () => {
    const settled = rounds[rounds.length - 1]
    expect(settled.phase).toBe('settled')
    const placements = viewOf(settled)
    expect(placements.every((placement) => placement.pips !== null)).toBe(true)

    /*
     * 同一摞的牌横纵坐标相同；每摞必须正好四张、最高只到第四层，绝不往上叠第二墩。
     */
    const piles = new Map<string, number>()
    for (const placement of placements) {
      const layer = Math.round((placement.position.y - TILE_SIZE.depth / 2) / TILE_SIZE.depth)
      expect(layer).toBeLessThan(4)
      const key = `${placement.position.x.toFixed(2)}:${placement.position.z.toFixed(2)}`
      piles.set(key, (piles.get(key) ?? 0) + 1)
    }
    expect([...piles.values()].every((count) => count === 4)).toBe(true)
    expect(piles.size).toBe(8)
    expect(settled.seats.reduce((total, seat) => total + seat.wonPierCount, 0)).toBe(8)
  })
})
