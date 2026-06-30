import {
  useState,
  type FormEvent,
} from 'react'

import type {
  MatchHistory,
  UserProfile,
  UserStats,
} from '@/local-data/types'
import type { LocalDataStatus } from '@/local-data/useLocalPlayerData'

export interface LocalUserPanelProps {
  /** 当前本机用户列表。 */
  users: UserProfile[]
  /** 当前选中的本机用户。 */
  activeUser: UserProfile | null
  /** 当前用户统计，未加载时为空。 */
  activeStats: UserStats | null
  /** 当前用户最近几局历史，用于在大厅给一个快速反馈。 */
  recentHistories: MatchHistory[]
  /** 本地数据加载状态。 */
  status: LocalDataStatus
  /** 本地数据错误提示。 */
  errorMessage: string | null
  /** 创建本机用户。 */
  onCreateUser: (nickname: string) => void | Promise<void>
  /** 切换本机用户。 */
  onSwitchUser: (userId: string) => void | Promise<void>
}

/**
 * 将分数转成带符号的短文本。
 */
function formatSignedScore(score: number): string {
  return score > 0 ? `+${score}` : `${score}`
}

/**
 * 大厅里的本机用户面板，负责创建用户、切换用户和展示当前总积分。
 */
export function LocalUserPanel({
  users,
  activeUser,
  activeStats,
  recentHistories,
  status,
  errorMessage,
  onCreateUser,
  onSwitchUser,
}: LocalUserPanelProps) {
  const [nickname, setNickname] = useState('')
  const isBusy = status === 'loading'
  const totalScore = activeStats?.totalScore ?? 0

  /**
   * 提交创建用户表单。空昵称会交给本地服务生成默认昵称。
   */
  function handleCreateUser(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    void onCreateUser(nickname)
    setNickname('')
  }

  return (
    <section className="local-user-panel" aria-label="本机用户档案">
      <div className="local-user-panel__main">
        <div>
          <span>当前用户</span>
          <strong>{activeUser?.nickname ?? (isBusy ? '加载中' : '未创建')}</strong>
        </div>
        <div className="local-user-panel__score">
          <span>总积分</span>
          <strong>{formatSignedScore(totalScore)}</strong>
        </div>
      </div>

      <div className="local-user-panel__meta">
        <span>局数 {activeStats?.roundsPlayed ?? 0}</span>
        <span>最高 {formatSignedScore(activeStats?.bestRoundDelta ?? 0)}</span>
        <span>满 8 次数 {activeStats?.sweepCount ?? 0}</span>
        {recentHistories[0] ? (
          <span>上局 {formatSignedScore(recentHistories[0].delta)}</span>
        ) : null}
      </div>

      <form className="local-user-panel__form" onSubmit={handleCreateUser}>
        <input
          value={nickname}
          maxLength={12}
          placeholder="输入昵称创建用户"
          aria-label="输入昵称创建用户"
          disabled={isBusy}
          onChange={(event) => setNickname(event.currentTarget.value)}
        />
        <button type="submit" disabled={isBusy}>
          创建用户
        </button>
      </form>

      {users.length > 1 ? (
        <div className="local-user-panel__switch" aria-label="切换本机用户">
          {users.map((user) => (
            <button
              key={user.id}
              type="button"
              className={user.id === activeUser?.id ? 'local-user-panel__chip local-user-panel__chip--active' : 'local-user-panel__chip'}
              disabled={isBusy || user.id === activeUser?.id}
              onClick={() => {
                void onSwitchUser(user.id)
              }}
            >
              {user.nickname}
            </button>
          ))}
        </div>
      ) : null}

      {errorMessage ? (
        <p className="local-user-panel__error">{errorMessage}</p>
      ) : null}
    </section>
  )
}
