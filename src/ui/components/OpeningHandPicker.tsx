import { useMemo, useState } from 'react'

import type { CardInstance, StartRoundOptions } from '@/rules-core/types'
import {
  CARD_DEFINITION_MAP,
  createDeck,
  sortCardInstances,
} from '@/rules-variants/ji-an-da-suo-zi/cardCatalog'
import { PaiCard } from '@/ui/components/PaiCard'

/**
 * 定制牌局最多能指定的起手牌张数。
 */
const HAND_LIMIT = 8

/**
 * 定制牌局选牌面板的入参。
 */
interface OpeningHandPickerProps {
  /**
   * 按选好的起手牌开始一局不计积分的定制牌局。
   */
  onStart: (options: StartRoundOptions) => void
  /**
   * 放弃定制，回到首页。
   */
  onBack: () => void
}

/**
 * 定制牌局的选牌面板。
 *
 * 从 32 张牌里指定自己的部分或全部起手牌，用来练习和验证规则；
 * 没选满的由规则层随机补齐，机器人的牌始终随机。
 *
 * @param props 开局与返回回调
 * @returns 选牌面板
 */
export function OpeningHandPicker({ onStart, onBack }: OpeningHandPickerProps) {
  const [selectedCardIds, setSelectedCardIds] = useState<string[]>([])
  const deck = useMemo(() => sortCardInstances(createDeck()), [])
  const missingCount = HAND_LIMIT - selectedCardIds.length

  /**
   * 点一张牌：已选则取消，未选且没满八张则选中。
   *
   * @param card 被点的牌
   * @returns 无返回值
   */
  function toggleCard(card: CardInstance): void {
    setSelectedCardIds((previousIds) => {
      if (previousIds.includes(card.id)) {
        return previousIds.filter((cardId) => cardId !== card.id)
      }
      /*
       * 一手牌只有八张，选满后再点其他牌不生效，需要先取消已选的牌。
       */
      return previousIds.length >= HAND_LIMIT ? previousIds : [...previousIds, card.id]
    })
  }

  return (
    <div className="lobby__sheet hand-picker">
      <header className="hand-picker__head">
        <div>
          <h2>定制牌局</h2>
          <p>
            已选 {selectedCardIds.length}/{HAND_LIMIT}
            {missingCount > 0 ? `，还差 ${missingCount} 张由系统随机补齐` : '，将按这 8 张开局'}。本局不计积分。
          </p>
        </div>
        <button
          type="button"
          className="lobby__ghost"
          onClick={() => setSelectedCardIds([])}
          disabled={selectedCardIds.length === 0}
        >
          清空
        </button>
      </header>

      <div className="hand-picker__grid" aria-label="32 张牌选择区">
        {deck.map((card) => {
          const definition = CARD_DEFINITION_MAP[card.definitionId]
          const isSelected = selectedCardIds.includes(card.id)
          return (
            <button
              key={card.id}
              type="button"
              className={isSelected ? 'hand-picker__card hand-picker__card--selected' : 'hand-picker__card'}
              onClick={() => toggleCard(card)}
              aria-pressed={isSelected}
              aria-label={`${isSelected ? '取消' : '选择'}${definition.name}`}
            >
              <PaiCard card={card} definition={definition} compact selected={isSelected} />
            </button>
          )
        })}
      </div>

      <div className="hand-picker__actions">
        <button type="button" className="lobby__ghost" onClick={onBack}>
          返回首页
        </button>
        <button
          type="button"
          className="lobby__primary"
          onClick={() => onStart({ humanSeat: 0, selectedHandCardIds: selectedCardIds })}
        >
          {missingCount > 0 ? `开始，随机补 ${missingCount} 张` : '开始定制局'}
        </button>
      </div>
    </div>
  )
}
