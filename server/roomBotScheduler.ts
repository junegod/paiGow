import { createBotDecisionContext } from '@/rules-variants/ji-an-da-suo-zi/botObservation'
import { jiAnDaSuoZiRuleSet } from '@/rules-variants/ji-an-da-suo-zi/ruleSet'

import type { OnlineRoom } from './roomModels'

/** 服务端机器人行动间隔，客户端仍会播放自己的动画。 */
const BOT_MOVE_DELAY_MS = 700

/**
 * 负责房间内机器人和断线真人的临时代打调度，不处理连接与广播细节。
 */
export class RoomBotScheduler {
  public constructor(private readonly onMatchChanged: (room: OnlineRoom) => void) {}

  /** 清理房间现有机器人计时器。 */
  public clear(room: OnlineRoom): void {
    if (room.botMoveTimer !== null) {
      clearTimeout(room.botMoveTimer)
      room.botMoveTimer = null
    }
  }

  /** 根据当前回合安排下一次机器人动作。 */
  public schedule(room: OnlineRoom): void {
    this.clear(room)
    if (!room.isPlaying || room.players.size === 0) {
      return
    }

    const delay = room.match.currentRound?.phase === 'awaiting-reveal' ? 2_000 : BOT_MOVE_DELAY_MS
    room.botMoveTimer = setTimeout(() => {
      room.botMoveTimer = null
      this.advanceOnce(room)
    }, delay)
    room.botMoveTimer.unref()
  }

  /** 执行一次机器人动作或统一揭示，并继续调度后续动作。 */
  private advanceOnce(room: OnlineRoom): void {
    const round = room.match.currentRound
    if (!round || room.match.phase === 'settled' || room.players.size === 0) {
      return
    }

    if (round.phase === 'awaiting-reveal') {
      room.match = jiAnDaSuoZiRuleSet.finishRoundAndReveal(room.match).match
      this.onMatchChanged(room)
      this.schedule(room)
      return
    }

    const currentSeat = round.currentSeat
    const currentSeatState = currentSeat === null
      ? null
      : round.seats.find((seatState) => seatState.seat === currentSeat) ?? null
    const connectedHuman = currentSeat === null ? null : room.players.get(currentSeat)
    if (
      currentSeat === null ||
      !currentSeatState ||
      (currentSeatState.config.mode !== 'bot' && connectedHuman?.online)
    ) {
      return
    }

    const legalActions = jiAnDaSuoZiRuleSet.listTurnActions(round, currentSeat)
    const botAction = jiAnDaSuoZiRuleSet.getBotStrategy().chooseAction(
      createBotDecisionContext(round, currentSeat, legalActions),
    )
    room.match = jiAnDaSuoZiRuleSet.submitAction(room.match, botAction, room.rng).match
    this.onMatchChanged(room)
    this.schedule(room)
  }
}
