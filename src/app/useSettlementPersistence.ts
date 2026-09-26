import { useEffect, useEffectEvent, useRef, useState } from 'react'

import type { MatchState, RoundState } from '@/rules-core/types'

/** 结算落账参数；定制局与联机局不写本机积分。 */
interface SettlementPersistenceOptions {
  /** 当前整场状态，未开局时为空。 */
  match: MatchState | null
  /** 当前本机用户，参与局唯一键计算。 */
  userId: string | null
  /** 是否属于需要本机记分的普通单机局。 */
  enabled: boolean
  /** 已有的幂等落账入口，失败必须拒绝 Promise。 */
  record: (match: MatchState, round: RoundState) => Promise<void>
}

/** 同一局的自动落账与离局按钮共享一笔正在执行的写入。 */
interface PendingSettlement {
  /** 用户、整场和局号共同构成的唯一键。 */
  key: string
  /** 写入结果；失败返回 false，由界面提供显式重试。 */
  promise: Promise<boolean>
}

/**
 * 协调自动记分、失败重试和成功后离局，防止快速连点漏记或重复推进下一局。
 *
 * @param options 当前计分范围与服务层写入入口。
 * @returns 保存状态、重试入口和受落账结果保护的离局入口。
 */
export function useSettlementPersistence({ match, userId, enabled, record }: SettlementPersistenceOptions) {
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const pendingRef = useRef<PendingSettlement | null>(null)
  const savedKeyRef = useRef<string | null>(null)
  const leavingRef = useRef(false)
  const round = match?.currentRound
  // 不计分的定制局也有局号，离局锁不能仅依赖积分键，否则下一局会无法退出。
  const navigationKey = match ? `${match.matchId}:${round?.roundNumber}:${round?.phase}` : null
  const key = enabled && match && round?.phase === 'settled' && round.settlement
    ? `${userId ?? 'missing-user'}:${match.matchId}:${round.roundNumber}`
    : null

  /**
   * 写入当前局；失败留在原页面，不进行自动循环重试。
   *
   * @returns 是否已落账或当前局无需计分。
   */
  async function persist(): Promise<boolean> {
    if (!key || !match || !round || savedKeyRef.current === key) {
      return true
    }
    if (pendingRef.current?.key === key) {
      return pendingRef.current.promise
    }

    setIsSaving(true)
    setError(null)
    // 放到微任务后调用，使同步异常和异步拒绝都经过同一条失败处理路径。
    const promise = Promise.resolve().then(() => record(match, round)).then(() => {
      savedKeyRef.current = key
      return true
    }).catch(() => {
      setError('积分保存失败，本局已保留。请重试保存后再离开。')
      return false
    }).finally(() => {
      pendingRef.current = null
      setIsSaving(false)
    })
    pendingRef.current = { key, promise }
    return promise
  }

  const saveAutomatically = useEffectEvent(() => { void persist() })
  useEffect(() => {
    setError(null)
    leavingRef.current = false
    saveAutomatically()
  }, [key, navigationKey])

  /**
   * 保存成功后执行一次导航。失败释放锁，成功则等待局唯一键变化后解锁。
   *
   * @param action 返回首页或开始下一局的同步操作。
   * @returns 操作处理完成；落账失败已转成界面提示。
   */
  async function persistAndRun(action: () => void): Promise<void> {
    if (leavingRef.current) {
      return
    }
    leavingRef.current = true
    if (await persist()) {
      action()
    } else {
      leavingRef.current = false
    }
  }

  return { isSaving, error, retry: persist, persistAndRun }
}
