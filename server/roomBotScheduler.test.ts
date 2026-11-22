import { afterEach, describe, expect, it, vi } from 'vitest'

import { SeededRandom } from '@/rules-core/random'
import { jiAnDaSuoZiRuleSet } from '@/rules-variants/ji-an-da-suo-zi/ruleSet'
import { DICE_TOTAL_DISPLAY_MS } from '@/shared/diceTiming'

import { RoomBotScheduler } from './roomBotScheduler'
import { createDefaultSeatConfigs, type OnlineRoom } from './roomModels'

/**
 * 用正式规则打完首墩，再让领出者掷骰，构造一次正在展示点数的牌局。
 *
 * @returns 等待机器人定门出牌的房间。
 */
function createRoomAwaitingDiceChoice(): OnlineRoom {
  const rng = new SeededRandom(42)
  const rules = jiAnDaSuoZiRuleSet
  let match = rules.startRound(rules.createMatch(42, createDefaultSeatConfigs()), rng).match
  // 首墩只能单张领出，四人各行动一次后才能进入允许掷骰的领出回合。
  for (let i = 0; i < 4; i += 1) {
    const round = match.currentRound!
    const seat = round.currentSeat!
    const action = rules.listTurnActions(round, seat)[0]
    match = rules.submitAction(match, { seat, intent: action.intent, selectedCardIds: action.selectedCardIds }, rng).match
  }
  const seat = match.currentRound!.currentSeat!
  match = rules.submitAction(match, { seat, intent: 'roll-dice', selectedCardIds: [] }, rng).match
  const hostSeat = seat === 0 ? 1 : 0
  return {
    roomCode: '123456', createdAt: Date.now(), lastActivityAt: Date.now(), hostSeat, match, rng,
    players: new Map([[hostSeat, {
      seat: hostSeat, name: '房主', token: 'test-token', online: true, disconnectedAt: null,
      socket: { readyState: 1, close() {}, send() {} },
    }]]),
    botDifficulty: 'standard', isPlaying: true, botMoveTimer: null, revision: 1,
  }
}

describe('联机机器人掷骰调度', () => {
  afterEach(() => vi.useRealTimers())

  it('完整展示点数后才定门出牌，临近到期重新排程也沿用原期限', () => {
    vi.useFakeTimers()
    const room = createRoomAwaitingDiceChoice()
    const onMatchChanged = vi.fn()
    const scheduler = new RoomBotScheduler(onMatchChanged)
    const pendingDice = room.match.currentRound?.pendingDice
    expect(pendingDice).toBeTruthy()

    scheduler.schedule(room)
    vi.advanceTimersByTime(DICE_TOTAL_DISPLAY_MS - 100)
    expect(room.match.currentRound?.pendingDice).toBe(pendingDice)
    expect(onMatchChanged).not.toHaveBeenCalled()

    // 模拟房间成员变化触发再次排程，重算后应该只等原来剩下的 100 毫秒。
    scheduler.schedule(room)
    vi.advanceTimersByTime(99)
    expect(onMatchChanged).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(room.match.currentRound?.pendingDice).toBeNull()
    expect(onMatchChanged).toHaveBeenCalledOnce()
    scheduler.clear(room)
  })
})
