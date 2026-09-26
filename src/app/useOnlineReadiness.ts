import { useCallback, useEffect, useRef, useState } from 'react'

import type { OnlineClient } from '@/services/online/OnlineClient'

/** 房间身份恢复必须有独立期限，心跳正常也不能无限等待快照。 */
const SNAPSHOT_TIMEOUT_MS = 10_000

/**
 * 将传输层连通与房间状态就绪分开，重连期间保留牌桌但禁止用旧状态操作。
 *
 * @param client 当前控制器持有的联机连接。
 * @returns 就绪状态与开始、完成、撤销同步的入口。
 */
export function useOnlineReadiness(client: OnlineClient) {
  const [isReady, setIsReady] = useState(false)
  const timerRef = useRef<number | null>(null)

  /** 清理旧期限，迟到计时器不得再次关闭已经恢复的连接。 */
  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  /** 撤销旧房间的操作许可，断线或主动离开均需调用。 */
  const reset = useCallback(() => {
    clearTimer()
    setIsReady(false)
  }, [clearTimer])

  /** 发起身份恢复时锁定操作；没有收到确认快照则重建连接后重试。 */
  const begin = useCallback(() => {
    reset()
    timerRef.current = window.setTimeout(() => client.reconnect(), SNAPSHOT_TIMEOUT_MS)
  }, [client, reset])

  /** 仅在创建、加入或恢复房间的身份快照应用成功后放行操作。 */
  const finish = useCallback(() => {
    clearTimer()
    setIsReady(true)
  }, [clearTimer])

  useEffect(() => clearTimer, [clearTimer])

  return { isReady, begin, finish, reset }
}
