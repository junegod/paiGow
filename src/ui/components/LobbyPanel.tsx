import { useMemo, useState } from 'react'

import type {
  BotDifficulty,
  CardDefinition,
  CardInstance,
  StartRoundOptions,
} from '@/rules-core/types'
import { BOT_DIFFICULTY_OPTIONS } from '@/app/botDifficulty'
import {
  CARD_DEFINITION_MAP,
  createDeck,
  sortCardInstances,
} from '@/rules-variants/ji-an-da-suo-zi/cardCatalog'
import {
  type LocalUserPanelProps,
} from '@/ui/components/LocalUserPanel'
import { PaiCard } from '@/ui/components/PaiCard'
import { RulesPanel } from '@/ui/components/RulesPanel'

type LobbyMode = 'home' | 'custom'

/** 首页多人对战区域的展示状态，避免旧入口一直显示“敬请期待”。 */
type OnlineSectionMode = 'collapsed' | 'expanded'

const HOME_FEATURED_CARD_DEFINITION_IDS = [
  'long_tian',
  'yao_fu',
  'point_nine',
  'point_six',
  'point_three',
]

interface LobbyPanelProps {
  /** 开始一局，首页可携带指定真人手牌，牌桌菜单则直接强制新局。 */
  onStart: (options?: StartRoundOptions) => void
  /** 开始不计积分的定制牌局。 */
  onStartCustom?: (options?: StartRoundOptions) => void
  /** 关闭菜单并返回当前牌桌；初始大厅没有关闭入口。 */
  onClose?: () => void
  /** 是否允许编辑座位与调试手牌，避免牌局进行中切换配置污染当前局。 */
  canConfigureSeats?: boolean
  /** 本机用户面板配置，只在初始大厅展示。 */
  localUserPanel?: LocalUserPanelProps
  /** 创建联机房间；服务端地址由控制器统一管理。 */
  onCreateRoom?: (playerName: string) => void
  /** 输入房间码加入联机房间。 */
  onJoinRoom?: (roomCode: string, playerName: string) => void
  /** 联机连接状态，仅在首页传给大厅。 */
  onlineConnectionStatus?: 'idle' | 'connecting' | 'connected' | 'reconnecting'
  /** 用户输入的房间码。 */
  onlineRoomCode?: string
  /** 用户输入的联机昵称。 */
  onlinePlayerName?: string
  /** 联机服务端返回或本地连接异常提示。 */
  onlineError?: string | null
  /** 当前保存的机器人难度，三个机器人共用。 */
  botDifficulty: BotDifficulty
  /** 保存首页选择的机器人难度。 */
  onBotDifficultyChange: (difficulty: BotDifficulty) => void | Promise<void>
  /** 打开应用设置；首页和牌桌共用同一设置弹窗。 */
  onOpenSettings?: () => void
  /** 本地设置加载完成前禁止切换，避免旧设置被默认值覆盖。 */
  isBotDifficultyReady?: boolean
}

/**
 * 将牌定义转成局部映射，供首页 32 张牌选择器自绘牌面使用。
 */
function createCardDefinitionMap(): Record<string, CardDefinition> {
  return { ...CARD_DEFINITION_MAP }
}

/**
 * 将用户头像编号转换成 CSS 类；旧数据没有头像时回落到竹青头像。
 */
function getAvatarClassName(avatarKey: string | undefined): string {
  return `home-player-card__avatar home-player-card__avatar--${avatarKey || 'bamboo'}`
}

/**
 * 开局大厅负责单真人对机器人配置，并提供指定自己手牌的规则验证入口。
 */
export function LobbyPanel({
  onStart,
  onStartCustom,
  onClose,
  canConfigureSeats = true,
  localUserPanel,
  onCreateRoom,
  onJoinRoom,
  onlineConnectionStatus,
  onlineRoomCode = '',
  onlinePlayerName = '',
  onlineError,
  botDifficulty,
  onBotDifficultyChange,
  onOpenSettings,
  isBotDifficultyReady = true,
}: LobbyPanelProps) {
  const [selectedOpeningCardIds, setSelectedOpeningCardIds] = useState<string[]>([])
  const [isRulesVisible, setIsRulesVisible] = useState(false)
  const [lobbyMode, setLobbyMode] = useState<LobbyMode>('home')
  const [onlineCodeInput, setOnlineCodeInput] = useState(onlineRoomCode)
  const [onlineNameInput, setOnlineNameInput] = useState(onlinePlayerName)
  const [onlineSectionMode, setOnlineSectionMode] = useState<OnlineSectionMode>(
    onlineRoomCode || onlinePlayerName ? 'expanded' : 'collapsed',
  )
  const canUseOnline = Boolean(onCreateRoom && onJoinRoom)
  const deck = useMemo(() => sortCardInstances(createDeck()), [])
  const cardDefinitionMap = useMemo(createCardDefinitionMap, [])
  const canPickOpeningHand = canConfigureSeats && !onClose
  const selectedOpeningCards = deck.filter((card) => selectedOpeningCardIds.includes(card.id))
  const missingCardCount = 8 - selectedOpeningCardIds.length
  const activeUser = localUserPanel?.activeUser ?? null
  const activeScore = localUserPanel?.activeStats?.totalScore ?? 0
  const isHomeVisible = canPickOpeningHand && lobbyMode === 'home'
  const featuredHomeCards = HOME_FEATURED_CARD_DEFINITION_IDS
    .map((definitionId) => deck.find((card) => card.definitionId === definitionId))
    .filter((card): card is CardInstance => Boolean(card))

  /**
   * 首页选牌最多 8 张；再次点击已选牌会取消，方便快速重组选牌测试赏钱。
   */
  function toggleOpeningCard(card: CardInstance): void {
    setSelectedOpeningCardIds((previousCardIds) => {
      if (previousCardIds.includes(card.id)) {
        return previousCardIds.filter((cardId) => cardId !== card.id)
      }

      if (previousCardIds.length >= 8) {
        return previousCardIds
      }

      return [...previousCardIds, card.id]
    })
  }

  /**
   * 以当前座位和指定手牌开局；没有选满 8 张时由规则层随机补齐。
   */
  function startWithOpeningOptions(): void {
    ;(onStartCustom ?? onStart)({
      humanSeat: 0,
      selectedHandCardIds: selectedOpeningCardIds,
    })
  }

  /**
   * 单机开始直接随机开局，并走正常积分结算。
   */
  function startSinglePlayer(): void {
    onStart({ humanSeat: 0 })
  }

  /**
   * 提交联机加入请求；服务端会校验房间码并分配第一个空座位。
   */
  function joinOnlineRoom(): void {
    if (onlineCodeInput.trim().length === 6) {
      onJoinRoom?.(onlineCodeInput, onlineNameInput.trim() || activeUser?.nickname || '玩家')
    }
  }

  return (
    <section
      className={[
        'lobby-panel',
        onClose ? 'lobby-panel--overlay' : '',
        isHomeVisible ? 'lobby-panel--home' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {onClose ? (
        <button
          type="button"
          aria-label="关闭菜单并返回牌桌"
          className="lobby-panel__close"
          onClick={onClose}
        >
          ×
        </button>
      ) : null}

      {canPickOpeningHand && isRulesVisible ? (
        <RulesPanel onBack={() => setIsRulesVisible(false)} />
      ) : isHomeVisible ? (
        <div className="home-lobby">
          <div className="home-lobby__felt" aria-hidden="true" />
          <header className="home-lobby__top">
            <div className="home-player-card">
              <div className={getAvatarClassName(activeUser?.avatarKey)} aria-hidden="true">
                <span />
              </div>
              <div>
                <span>当前玩家</span>
                <strong>{activeUser?.nickname ?? '加载中'}</strong>
              </div>
              <em>{activeScore} 积分</em>
            </div>
            <div className="home-lobby__top-actions">
              {onOpenSettings ? (
                <button
                  type="button"
                  className="home-lobby__utility"
                  onClick={onOpenSettings}
                >
                  设置
                </button>
              ) : null}
              <button
                type="button"
                className="home-lobby__rules"
                onClick={() => setIsRulesVisible(true)}
              >
                规则
              </button>
            </div>
          </header>

          <section className="home-lobby__stage">
            <div className="home-lobby__brand">
              <p>江西吉安新居村非物质文化遗产</p>
              <h1>打索子</h1>
            </div>

            <div className="home-lobby__table-art" aria-hidden="true">
              <div className="home-lobby__card-fan">
                {featuredHomeCards.map((card, index) => {
                  const definition = cardDefinitionMap[card.definitionId]

                  return (
                    <span
                      key={card.id}
                      className={`home-lobby__show-card home-lobby__show-card--${index + 1}`}
                    >
                      <PaiCard card={card} definition={definition} />
                    </span>
                  )
                })}
              </div>
              <span className="home-lobby__gold-arc" />
            </div>

            <div className="home-lobby__actions">
              <fieldset className="home-difficulty" disabled={!isBotDifficultyReady}>
                <legend>机器人难度</legend>
                <div className="home-difficulty__options">
                  {BOT_DIFFICULTY_OPTIONS.map((option) => (
                    <label
                      key={option.value}
                      className={`home-difficulty__option ${botDifficulty === option.value ? 'home-difficulty__option--active' : ''}`}
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
                </div>
              </fieldset>
              <button type="button" className="home-action home-action--primary" onClick={startSinglePlayer}>
                单机开始
              </button>
              <div className="home-action-wrap">
                <button type="button" className="home-action" onClick={() => setLobbyMode('custom')}>
                  定制牌局
                </button>
                <span>不计积分</span>
              </div>
              <div className="home-action-wrap">
                <button
                  type="button"
                  className="home-action"
                  aria-expanded={onlineSectionMode === 'expanded'}
                  onClick={() => setOnlineSectionMode((previousMode) =>
                    previousMode === 'expanded' ? 'collapsed' : 'expanded',
                  )}
                >
                  多人对战
                </button>
                <span>{onlineSectionMode === 'expanded' ? '收起' : '朋友局'}</span>
              </div>
              {canUseOnline && onlineSectionMode === 'expanded' ? (
                <div className="online-form">
                  <p className="online-form__title">朋友局</p>
                  <input
                    className="online-form__input"
                    placeholder="你的名字"
                    value={onlineNameInput}
                    onChange={(event) => setOnlineNameInput(event.target.value)}
                  />
                  <button
                    type="button"
                    className="home-action"
                    onClick={() => onCreateRoom?.(onlineNameInput.trim() || activeUser?.nickname || '玩家')}
                  >
                    创建房间
                  </button>
                  <div className="online-form__join">
                    <input
                      className="online-form__input"
                      placeholder="6位房间码"
                      inputMode="numeric"
                      maxLength={6}
                      value={onlineCodeInput}
                      onChange={(event) => setOnlineCodeInput(event.target.value.replace(/\D/g, ''))}
                    />
                    <button
                      type="button"
                      className="home-action"
                      disabled={onlineCodeInput.length !== 6}
                      onClick={joinOnlineRoom}
                    >
                      加入
                    </button>
                  </div>
                  {onlineConnectionStatus === 'reconnecting' ? (
                    <p className="online-form__status">服务器连接中...</p>
                  ) : null}
                  {onlineError ? <p className="online-form__error">{onlineError}</p> : null}
                </div>
              ) : null}
            </div>
          </section>

          <p className="home-lobby__disclaimer">
            本游戏为村里非物质文化遗产传统棋盘游戏，仅村内部娱乐，非赌博工具。
          </p>
        </div>
      ) : (
        <>
          <div className="lobby-panel__hero">
            <div className="lobby-panel__hero-main">
              <div>
                <p className="lobby-panel__eyebrow">江西吉安新居村非物质文化遗产</p>
                <h1>打索子</h1>
              </div>
              {canPickOpeningHand ? (
                <button
                  type="button"
                  className="lobby-panel__rules-entry"
                  onClick={() => setIsRulesVisible(true)}
                >
                  规则
                </button>
              ) : null}
            </div>
            <p className="lobby-panel__summary">
              你固定坐在底部位置，对战 3 个机器人；首页可指定自己的开局牌，机器人继续随机发牌。
            </p>
          </div>

          {canPickOpeningHand ? (
            <div className="opening-hand-picker">
              <div className="opening-hand-picker__head">
                <div>
                  <strong>选择我的开局牌</strong>
                  <p>
                    已选 {selectedOpeningCardIds.length}/8
                    {missingCardCount > 0
                      ? `，还差 ${missingCardCount} 张随机补齐`
                      : '，将按这 8 张开局'}
                  </p>
                </div>
                <button
                  type="button"
                  className="opening-hand-picker__clear"
                  onClick={() => setSelectedOpeningCardIds([])}
                  disabled={selectedOpeningCardIds.length === 0}
                >
                  清空
                </button>
              </div>

              <div className="opening-deck-grid" aria-label="32 张牌选择区">
                {deck.map((card) => {
                  const definition = cardDefinitionMap[card.definitionId]
                  const isSelected = selectedOpeningCardIds.includes(card.id)

                  return (
                    <button
                      key={card.id}
                      type="button"
                      className={isSelected ? 'opening-card opening-card--selected' : 'opening-card'}
                      onClick={() => toggleOpeningCard(card)}
                      aria-label={`${isSelected ? '取消' : '选择'}${definition.name}`}
                    >
                      <PaiCard
                        card={card}
                        definition={definition}
                        tiny
                        selected={isSelected}
                      />
                    </button>
                  )
                })}
              </div>

              <div className="opening-hand-picker__selected">
                {selectedOpeningCards.length > 0 ? (
                  selectedOpeningCards.map((card) => {
                    const definition = cardDefinitionMap[card.definitionId]

                    return (
                      <PaiCard
                        key={card.id}
                        card={card}
                        definition={definition}
                        tiny
                        selected
                      />
                    )
                  })
                ) : (
                  <span>不选牌也可以直接开始，系统会随机给你 8 张。</span>
                )}
              </div>
            </div>
          ) : (
            <div className="lobby-panel__rules">
              <div>
                <strong>出牌节奏</strong>
                <p>轮到自己时按规则明打，不想打再掷骰定门。</p>
              </div>
              <div>
                <strong>信息公开</strong>
                <p>明牌可随时查看，弃牌整局结束后统一翻开。</p>
              </div>
              <div>
                <strong>本地模式</strong>
                <p>你固定在底部操作，其余座位全部机器人。</p>
              </div>
            </div>
          )}

          {!canConfigureSeats ? (
            <p className="lobby-panel__notice">
              当前牌局还在进行中，调试手牌只能回到首页后调整；点关闭可继续当前局。
            </p>
          ) : null}

          <div className="lobby-panel__actions">
            <button
              type="button"
              className="hero-button hero-button--ghost"
              onClick={() => {
                setLobbyMode('home')
                setSelectedOpeningCardIds([])
              }}
            >
              返回首页
            </button>
            <button
              type="button"
              className="hero-button hero-button--primary"
              onClick={canPickOpeningHand ? startWithOpeningOptions : () => onStart()}
            >
              {canPickOpeningHand && missingCardCount > 0
                ? `开始定制，随机补 ${missingCardCount} 张`
                : '开始定制局'}
            </button>
          </div>
        </>
      )}
    </section>
  )
}
