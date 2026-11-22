import { useEffect, useEffectEvent, useRef, useState } from 'react'

import type { DiceRoll, MatchState } from '@/rules-core/types'
import { DICE_TOTAL_DISPLAY_MS } from '@/shared/diceTiming'

/**
 * 当前正在播放的掷骰演出；保留点数，避免后续出牌快照打断翻滚。
 */
interface DiceReview {
  /**
   * 对局与局号的组合，切桌或开始下一局时不沿用动画。
   */
  roundKey: string
  /**
   * 从实时快照取得的服务端或单机规则点数。
   */
  roll: DiceRoll
}

/**
 * 得到牌局与当前局的组合标识，用于在换局或离开时丢弃旧动画。
 *
 * @param matchState 当前牌局快照。
 * @returns 正在进行或刚结束的局标识；尚未开局时返回空。
 */
function getRoundKey(matchState: MatchState | null): string | null {
  return matchState?.currentRound ? `${matchState.matchId}:${matchState.currentRound.roundNumber}` : null
}

/**
 * 标识一个等待定门的回合；同一回合只掷一次骰，不使用可能重复的点数或随视角变化的座位。
 *
 * @param matchState 当前牌局快照。
 * @returns 当前掷骰的标识；没有待定门的掷骰时返回空。
 */
export function getPendingDiceReviewKey(matchState: MatchState | null): string | null {
  const round = matchState?.currentRound
  return round?.pendingDice ? `${getRoundKey(matchState)}:${round.publicTrickLog.length}` : null
}

/**
 * 为单机和联机共用局内掷骰动画。每个回合只允许掷骰一次，因此同点数的下一回合仍会播放。
 *
 * @param matchState 当前权威牌局。
 * @param animatePendingRoll 是否由实时动作触发；恢复身份时只同步已有结果。
 * @returns 正在展示的骰子结果；演出结束或切换牌局后返回空。
 */
export function useDiceReview(matchState: MatchState | null, animatePendingRoll = true): DiceRoll | null {
  const [review, setReview] = useState<DiceReview | null>(null)
  const lastRollKey = useRef<string | null>(null)
  const round = matchState?.currentRound
  const roundKey = getRoundKey(matchState)
  const rollKey = getPendingDiceReviewKey(matchState)

  /**
   * 只在首次看到该回合的掷骰时读取快照来源，同一次掷骰后续推送不重新计时。
   *
   * @returns 可以播放时返回本次点数。
   */
  const readLiveRoll = useEffectEvent(() => animatePendingRoll ? round?.pendingDice?.roll : undefined)

  useEffect(() => {
    if (!rollKey || !roundKey || lastRollKey.current === rollKey) {
      return
    }

    // 恢复快照也记录事件标识，避免随后的重复推送把已经存在的点数当成新动作。
    lastRollKey.current = rollKey
    const roll = readLiveRoll()
    if (roll) {
      setReview({ roundKey, roll })
    }
  }, [rollKey, roundKey])

  useEffect(() => {
    if (!review || review.roundKey !== roundKey) {
      return
    }

    // 不随 pendingDice 清空而取消；旧版联机服务可能提前推进，仍让本次翻滚完整结束。
    const timer = window.setTimeout(() => setReview(null), DICE_TOTAL_DISPLAY_MS)
    return () => window.clearTimeout(timer)
  }, [review, roundKey])

  return review && review.roundKey === roundKey ? review.roll : null
}
