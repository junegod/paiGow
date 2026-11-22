import type { PendingDiceChoice } from '@/rules-core/types'
import { DICE_TOTAL_DISPLAY_MS } from '@/shared/diceTiming'
import { createBotDecisionContext } from '@/rules-variants/ji-an-da-suo-zi/botObservation'
import { jiAnDaSuoZiRuleSet } from '@/rules-variants/ji-an-da-suo-zi/ruleSet'

import type { OnlineRoom } from './roomModels'

/**
 * 未掷骰时，服务端机器人的常规思考间隔。
 */
const BOT_MOVE_DELAY_MS = 700

/**
 * 一次掷骰的展示期限；重连或房主变动重新排程时不延长同一次掷骰。
 */
interface DiceReviewDeadline {
  /**
   * 规则引擎生成的当次定门信息；下一次掷骰会得到新对象。
   */
  pendingDice: PendingDiceChoice
  /**
   * 机器人最早可以继续定门出牌的服务端时间戳。
   */
  endsAt: number
}

/**
 * 负责房间内机器人和断线真人的临时代打调度，不处理连接与广播细节。
 */
export class RoomBotScheduler {
  /**
   * 仅供调度使用，房间销毁后随对象释放，无需写入房间协议。
   */
  private readonly diceReviewDeadlines = new WeakMap<OnlineRoom, DiceReviewDeadline>()

  public constructor(private readonly onMatchChanged: (room: OnlineRoom) => void) {}

  /** 清理房间现有机器人计时器。 */
  public clear(room: OnlineRoom): void {
    if (room.botMoveTimer !== null) {
      clearTimeout(room.botMoveTimer)
      room.botMoveTimer = null
    }
  }

  /**
   * 根据当前回合安排下一次机器人动作或整局揭示。
   *
   * @param room 当前仍在进行的联机房间。
   */
  public schedule(room: OnlineRoom): void {
    this.clear(room)
    if (!room.isPlaying || room.players.size === 0) {
      return
    }

    const delay = room.match.currentRound?.phase === 'awaiting-reveal'
      ? 2_000
      : this.getMoveDelay(room)
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

  /**
   * 机器人定门出牌前至少等满共用的翻滚和点数停留时间。
   *
   * @param room 需要排程的房间。
   * @returns 距离下次机器人动作的等待毫秒数。
   */
  private getMoveDelay(room: OnlineRoom): number {
    const pendingDice = room.match.currentRound?.pendingDice
    if (!pendingDice) {
      this.diceReviewDeadlines.delete(room)
      return BOT_MOVE_DELAY_MS
    }

    const now = Date.now()
    const previous = this.diceReviewDeadlines.get(room)
    const endsAt = previous?.pendingDice === pendingDice ? previous.endsAt : now + DICE_TOTAL_DISPLAY_MS
    // 房间因掉线或恢复重新排程时沿用同一次掷骰的期限，避免把停留时间反复重置。
    if (previous?.pendingDice !== pendingDice) {
      this.diceReviewDeadlines.set(room, { pendingDice, endsAt })
    }

    // 若点数已展示完才发生断线，仍给临时代打留出常规思考间隔。
    return endsAt > now ? endsAt - now : BOT_MOVE_DELAY_MS
  }
}
