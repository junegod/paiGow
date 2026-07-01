import {
  useEffect,
  useEffectEvent,
  useState,
} from 'react'

import type { LocalDataSnapshot } from '@/local-data/types'
import {
  createLocalUser,
  loadLocalDataSnapshot,
  recordAbandonedRoundPenaltyForUser,
  recordSettledRoundForUser,
  switchLocalUser,
} from '@/local-data/localDataService'
import type {
  MatchState,
  RoundState,
} from '@/rules-core/types'

export type LocalDataStatus = 'loading' | 'ready' | 'error'

/**
 * 本地用户数据 hook。它只负责 IndexedDB 读写和快照刷新，不参与任何出牌规则。
 */
export function useLocalPlayerData() {
  const [snapshot, setSnapshot] = useState<LocalDataSnapshot | null>(null)
  const [status, setStatus] = useState<LocalDataStatus>('loading')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const applySnapshot = useEffectEvent((nextSnapshot: LocalDataSnapshot) => {
    setSnapshot(nextSnapshot)
    setStatus('ready')
    setErrorMessage(null)
  })

  const handleError = useEffectEvent((error: unknown) => {
    const message = error instanceof Error ? error.message : '本地数据操作失败。'

    setStatus('error')
    setErrorMessage(message)
  })

  /**
   * 首次进入应用时加载本地数据。服务层会负责创建默认本机用户。
   */
  useEffect(() => {
    let isMounted = true

    loadLocalDataSnapshot()
      .then((nextSnapshot) => {
        if (isMounted) {
          applySnapshot(nextSnapshot)
        }
      })
      .catch((error: unknown) => {
        if (isMounted) {
          handleError(error)
        }
      })

    return () => {
      isMounted = false
    }
  }, [])

  /**
   * 创建用户后会自动切换到新用户，适合大厅里快速建多个测试档案。
   */
  async function createUser(nickname: string): Promise<void> {
    try {
      setStatus('loading')
      applySnapshot(await createLocalUser(nickname))
    } catch (error) {
      handleError(error)
    }
  }

  /**
   * 切换当前用户。这里只切换本机档案，不会影响正在进行的牌局。
   */
  async function switchUser(userId: string): Promise<void> {
    try {
      setStatus('loading')
      applySnapshot(await switchLocalUser(userId))
    } catch (error) {
      handleError(error)
    }
  }

  /**
   * 结算后记录当前用户积分。服务层用局唯一键去重，重复调用不会重复加分。
   */
  async function recordSettledRound(matchState: MatchState, round: RoundState): Promise<void> {
    const activeUserId = snapshot?.activeUserId

    if (!activeUserId) {
      return
    }

    try {
      applySnapshot(await recordSettledRoundForUser(activeUserId, matchState, round))
    } catch (error) {
      handleError(error)
    }
  }

  /**
   * 主动中途离局时立即扣分，避免用户反复重新开局刷好手牌。
   */
  async function recordAbandonedRoundPenalty(
    matchState: MatchState,
    round: RoundState,
  ): Promise<void> {
    const activeUserId = snapshot?.activeUserId

    if (!activeUserId) {
      return
    }

    try {
      applySnapshot(await recordAbandonedRoundPenaltyForUser(activeUserId, matchState, round))
    } catch (error) {
      handleError(error)
    }
  }

  return {
    snapshot,
    status,
    errorMessage,
    createUser,
    switchUser,
    recordSettledRound,
    recordAbandonedRoundPenalty,
  }
}
