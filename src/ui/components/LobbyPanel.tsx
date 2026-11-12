import { lazy, Suspense, useState } from 'react'

import { BOT_DIFFICULTY_OPTIONS } from '@/app/botDifficulty'
import type { UserProfile } from '@/local-data/types'
import type { BotDifficulty, StartRoundOptions } from '@/rules-core/types'
import { BrandMark } from '@/ui/components/BrandMark'
import { OpeningHandPicker } from '@/ui/components/OpeningHandPicker'
import { RulesPanel } from '@/ui/components/RulesPanel'

/**
 * 首页三维背景及其渲染库体积较大，首页文字和按钮先显示，背景加载完再出现。
 */
const LobbyBackdrop = lazy(() => import('@/ui/components/LobbyBackdrop'))

/**
 * 首页当前展示的内容：主页、规则说明或定制牌局选牌。
 */
type LobbyView = 'home' | 'rules' | 'custom'

/**
 * 本机用户头像编号对应的底色；旧数据没有编号时用竹青色。
 */
const AVATAR_COLORS: Record<string, string> = {
  bamboo: '#1e7b58',
  ember: '#9b3430',
  river: '#276fa3',
  plum: '#7c3e7e',
  sun: '#b57c1a',
  jade: '#2f8d78',
}

/**
 * 首页的入参。
 */
interface LobbyPanelProps {
  /**
   * 开始一局计积分的单机对局。
   */
  onStart: (options?: StartRoundOptions) => void
  /**
   * 开始一局不计积分的定制牌局。
   */
  onStartCustom: (options?: StartRoundOptions) => void
  /**
   * 进入联机大厅。
   */
  onOpenBrowser: () => void
  /**
   * 打开应用设置。
   */
  onOpenSettings: () => void
  /**
   * 当前保存的机器人难度，三个机器人共用。
   */
  botDifficulty: BotDifficulty
  /**
   * 保存首页选择的机器人难度。
   */
  onBotDifficultyChange: (difficulty: BotDifficulty) => void | Promise<void>
  /**
   * 本地设置是否已加载完成；加载完成前禁止切换难度，避免旧设置被默认值覆盖。
   */
  isBotDifficultyReady: boolean
  /**
   * 当前本机用户；本地数据尚未加载完成时为空。
   */
  activeUser: UserProfile | null
  /**
   * 当前本机用户的积分。
   */
  activeScore: number
  /**
   * 需要在首页提示的错误，例如联机失败或本地数据异常。
   */
  errorMessage: string | null
}

/**
 * 首页：品牌、当前玩家、难度选择和三个开局入口。
 *
 * @param props 开局入口、难度设置与当前玩家信息
 * @returns 首页界面；点规则或定制牌局时在同一页面内切换内容
 */
export function LobbyPanel({
  onStart,
  onStartCustom,
  onOpenBrowser,
  onOpenSettings,
  botDifficulty,
  onBotDifficultyChange,
  isBotDifficultyReady,
  activeUser,
  activeScore,
  errorMessage,
}: LobbyPanelProps) {
  const [view, setView] = useState<LobbyView>('home')
  const nickname = activeUser?.nickname ?? '加载中'

  return (
    <section className="lobby">
      <Suspense fallback={null}>
        <LobbyBackdrop />
      </Suspense>
      <div className="lobby__shade" aria-hidden="true" />

      {view === 'rules' ? (
        <div className="lobby__sheet">
          <RulesPanel onBack={() => setView('home')} />
        </div>
      ) : view === 'custom' ? (
        <OpeningHandPicker onStart={onStartCustom} onBack={() => setView('home')} />
      ) : (
        <div className="lobby__home">
          <header className="lobby__top">
            <div className="lobby__player">
              <span
                className="lobby__avatar"
                style={{ background: AVATAR_COLORS[activeUser?.avatarKey ?? ''] ?? AVATAR_COLORS.bamboo }}
                aria-hidden="true"
              >
                {nickname.slice(-1)}
              </span>
              <span className="lobby__player-name">{nickname}</span>
              <span className="lobby__player-score">{activeScore} 积分</span>
            </div>
            <div className="lobby__tools">
              <button type="button" className="lobby__ghost" onClick={() => setView('rules')}>
                规则
              </button>
              <button type="button" className="lobby__ghost" onClick={onOpenSettings}>
                设置
              </button>
            </div>
          </header>

          <div className="lobby__brand">
            <BrandMark size={52} />
            <h1>打索子</h1>
            <p>江西吉安 · 新居村传统骨牌</p>
          </div>

          <div className="lobby__actions">
            <fieldset className="lobby__difficulty" disabled={!isBotDifficultyReady}>
              <legend>机器人难度</legend>
              {BOT_DIFFICULTY_OPTIONS.map((option) => (
                <label
                  key={option.value}
                  className={botDifficulty === option.value ? 'lobby__level lobby__level--active' : 'lobby__level'}
                >
                  <input
                    type="radio"
                    name="bot-difficulty"
                    value={option.value}
                    checked={botDifficulty === option.value}
                    onChange={() => {
                      void onBotDifficultyChange(option.value)
                    }}
                  />
                  <strong>{option.label}</strong>
                  <span>{option.description}</span>
                </label>
              ))}
            </fieldset>

            <button type="button" className="lobby__primary" onClick={() => onStart({ humanSeat: 0 })}>
              单机开始
            </button>
            <div className="lobby__secondary">
              <button type="button" className="lobby__entry" onClick={onOpenBrowser}>
                多人对战
                <span>朋友局</span>
              </button>
              <button type="button" className="lobby__entry" onClick={() => setView('custom')}>
                定制牌局
                <span>不计积分</span>
              </button>
            </div>

            {errorMessage ? (
              <p className="lobby__error" role="alert">
                {errorMessage}
              </p>
            ) : null}
            <p className="lobby__disclaimer">地方传统骨牌游戏；积分仅记录游戏表现，不可购买、转让或兑换。</p>
          </div>
        </div>
      )}
    </section>
  )
}
