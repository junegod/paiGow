import { useCallback, useEffect, useEffectEvent, useRef, useState } from 'react'

import type { DiceRoll, MatchState } from '@/rules-core/types'
import { DICE_SHOWCASE_MS } from '@/shared/diceTiming'

/**
 * 当前正在播放的掷骰演出；保留掷骰时的快照，等骰碗落桌后才展示之后的出牌。
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
  /**
   * 掷骰发生时的牌局快照，展示期间只用于渲染，权威牌局仍可继续接收服务端更新。
   */
  matchState: MatchState
  /**
   * 镜头前展示结束后进入回桌阶段，收到画布的落位回调才算播放完成。
   */
  phase: 'showcase' | 'returning'
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
 * @param isOpeningCeremonyActive 开局仪式优先播放，结束后再计时局内掷骰展示。
 * @returns 当前展示的快照和骰碗落桌时调用的结束入口。
 */
export function useDiceReview(
  matchState: MatchState | null,
  animatePendingRoll = true,
  isOpeningCeremonyActive = false,
) {
  const [review, setReview] = useState<DiceReview | null>(null)
  const lastRollKey = useRef<string | null>(null)
  const roundKey = getRoundKey(matchState)
  const rollKey = getPendingDiceReviewKey(matchState)
  const activeReview = review?.roundKey === roundKey ? review : null
  const isReviewActive = activeReview !== null

  /**
   * 只在首次看到该回合的掷骰时读取快照来源，同一次掷骰后续推送不重新计时。
   *
   * @param key 掷骰所属的牌局和局号。
   * @returns 可以播放时返回掷骰演出初始状态，否则返回空。
   */
  const readLiveReview = useEffectEvent((key: string): DiceReview | null => {
    const roll = matchState?.currentRound?.pendingDice?.roll
    return animatePendingRoll && matchState && roll
      ? { roundKey: key, roll, matchState, phase: 'showcase' }
      : null
  })

  useEffect(() => {
    if (isReviewActive || !rollKey || !roundKey || lastRollKey.current === rollKey) {
      return
    }

    // 恢复快照也记录事件标识，避免随后的重复推送把已经存在的点数当成新动作。
    lastRollKey.current = rollKey
    const nextReview = readLiveReview(roundKey)
    if (nextReview) {
      setReview(nextReview)
    }
  }, [isReviewActive, rollKey, roundKey])

  useEffect(() => {
    if (activeReview?.phase !== 'showcase' || isOpeningCeremonyActive) {
      return
    }

    // 服务端可能提前推进；展示计时只负责开始回桌，牌面和操作继续锁到实际落位。
    const timer = window.setTimeout(() => setReview({ ...activeReview, phase: 'returning' }), DICE_SHOWCASE_MS)
    return () => window.clearTimeout(timer)
  }, [activeReview, isOpeningCeremonyActive])

  /**
   * 只结束这次正在回桌的演出，忽略重新开局或之后掷骰时迟到的画布回调。
   */
  const finishReview = useCallback(() => {
    if (activeReview?.phase === 'returning') {
      setReview((current) => current === activeReview ? null : current)
    }
  }, [activeReview])

  return { review: activeReview, finishReview }
}
