import { useMemo, useState } from 'react'

import type {
  CardDefinition,
  CardInstance,
  StartRoundOptions,
} from '@/rules-core/types'
import {
  CARD_DEFINITION_MAP,
  createDeck,
  sortCardInstances,
} from '@/rules-variants/ji-an-da-suo-zi/cardCatalog'
import { PaiCard } from '@/ui/components/PaiCard'

interface LobbyPanelProps {
  /** 开始一局，首页可携带指定真人手牌，牌桌菜单则直接强制新局。 */
  onStart: (options?: StartRoundOptions) => void
  /** 重置整场牌局并回到初始大厅。 */
  onRestartMatch: () => void
  /** 关闭菜单并返回当前牌桌；初始大厅没有关闭入口。 */
  onClose?: () => void
  /** 是否允许编辑座位与调试手牌，避免牌局进行中切换配置污染当前局。 */
  canConfigureSeats?: boolean
  /** 主按钮文案，牌桌菜单和初始大厅使用不同语义。 */
  startLabel?: string
  /** 重置按钮文案，牌桌菜单里会强调重置整场。 */
  restartLabel?: string
}

/**
 * 将牌定义转成局部映射，供首页 32 张牌选择器自绘牌面使用。
 */
function createCardDefinitionMap(): Record<string, CardDefinition> {
  return { ...CARD_DEFINITION_MAP }
}

/**
 * 开局大厅负责单真人对机器人配置，并提供指定自己手牌的规则验证入口。
 */
export function LobbyPanel({
  onStart,
  onRestartMatch,
  onClose,
  canConfigureSeats = true,
  startLabel = '开始新一局',
  restartLabel = '重置牌局',
}: LobbyPanelProps) {
  const [selectedOpeningCardIds, setSelectedOpeningCardIds] = useState<string[]>([])
  const deck = useMemo(() => sortCardInstances(createDeck()), [])
  const cardDefinitionMap = useMemo(createCardDefinitionMap, [])
  const canPickOpeningHand = canConfigureSeats && !onClose
  const selectedOpeningCards = deck.filter((card) => selectedOpeningCardIds.includes(card.id))
  const missingCardCount = 8 - selectedOpeningCardIds.length

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
    onStart({
      humanSeat: 0,
      selectedHandCardIds: selectedOpeningCardIds,
    })
  }

  return (
    <section className={`lobby-panel ${onClose ? 'lobby-panel--overlay' : ''}`}>
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

      <div className="lobby-panel__hero">
        <p className="lobby-panel__eyebrow">江西吉安传统牌九</p>
        <h1>打索子</h1>
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
                {missingCardCount > 0 ? `，还差 ${missingCardCount} 张随机补齐` : '，将按这 8 张开局'}
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
          当前牌局还在进行中，调试手牌只能回到大厅后调整；点关闭可继续当前局。
        </p>
      ) : null}

      <div className="lobby-panel__actions">
        {onClose ? (
          <button type="button" className="hero-button hero-button--ghost" onClick={onClose}>
            继续牌桌
          </button>
        ) : null}
        <button type="button" className="hero-button hero-button--ghost" onClick={onRestartMatch}>
          {restartLabel}
        </button>
        <button
          type="button"
          className="hero-button hero-button--primary"
          onClick={canPickOpeningHand ? startWithOpeningOptions : () => onStart()}
        >
          {canPickOpeningHand && missingCardCount > 0
            ? `开始，随机补 ${missingCardCount} 张`
            : startLabel}
        </button>
      </div>
    </section>
  )
}
