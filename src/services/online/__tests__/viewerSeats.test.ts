import { describe, expect, it } from 'vitest'

import { SeededRandom } from '@/rules-core/random'
import type { SeatConfig } from '@/rules-core/types'
import { jiAnDaSuoZiRuleSet } from '@/rules-variants/ji-an-da-suo-zi/ruleSet'
import { createMatchStateForViewer } from '@/services/online/OnlineClient'

const SEATS: SeatConfig[] = [
  { seat: 0, name: '零号', mode: 'human', color: '#1' },
  { seat: 1, name: '一号', mode: 'human', color: '#2' },
  { seat: 2, name: '二号', mode: 'bot', color: '#3' },
  { seat: 3, name: '三号', mode: 'bot', color: '#4' },
]

/**
 * 使用规则引擎推进到至少完成一个回合，确保测试覆盖当前回合、赢墩记录和历史局深层座位。
 */
function createPlayedMatch() {
  const rng = new SeededRandom(20260905)
  let match = jiAnDaSuoZiRuleSet.createMatch(20260905, SEATS)
  match = jiAnDaSuoZiRuleSet.startRound(match, rng).match

  for (let step = 0; step < 20; step += 1) {
    const round = match.currentRound
    if (!round || round.publicTrickLog.length > 0) {
      break
    }

    const seat = round.currentSeat
    if (seat === null) {
      break
    }

    const action = jiAnDaSuoZiRuleSet.listTurnActions(round, seat)[0]
    match = jiAnDaSuoZiRuleSet.submitAction(match, {
      seat,
      intent: action.intent,
      selectedCardIds: action.selectedCardIds,
    }, rng).match
  }

  if (!match.currentRound || match.currentRound.publicTrickLog.length === 0) {
    throw new Error('测试牌局没有完成首个回合。')
  }

  match.replayRounds = [structuredClone(match.currentRound)]
  return match
}

describe('createMatchStateForViewer', () => {
  it('把当前玩家、当前回合、赢墩记录和历史局统一映射到底部座位零', () => {
    const serverState = createPlayedMatch()
    const viewerState = createMatchStateForViewer(serverState, 1)
    const round = viewerState.currentRound
    const serverRound = serverState.currentRound

    if (!serverRound) {
      throw new Error('服务端测试状态缺少当前局。')
    }

    expect(viewerState.seatConfigs[0].name).toBe('一号')
    expect(round?.seats[0].config.name).toBe('一号')
    expect(round?.currentSeat).toBe(
      serverRound.currentSeat === null
        ? null
        : ((serverRound.currentSeat + 3) % 4),
    )
    expect(round?.publicTrickLog[0].leader).toBe(
      ((serverRound.publicTrickLog[0].leader + 3) % 4),
    )
    expect(viewerState.replayRounds[0].seats[0].config.name).toBe('一号')

    const wonTrick = round?.seats.flatMap((seat) => seat.wonTricks)[0]
    if (wonTrick) {
      expect(wonTrick.winner).toBe(round?.publicTrickLog[0].winner)
    }
  })
})
