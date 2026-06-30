import { describe, expect, it } from 'vitest'

import type { CardInstance } from '@/rules-core/types'
import { createDeck } from '@/rules-variants/ji-an-da-suo-zi/cardCatalog'
import { arrangeJiAnDaSuoZiHand } from '@/rules-variants/ji-an-da-suo-zi/handArrangement'

/**
 * 按定义 id 从完整牌堆里取测试牌。相同定义可重复传入，
 * 会依次取不同副本，保证测试能覆盖对子和四张组合。
 */
function takeCards(definitionIds: string[]): CardInstance[] {
  const cardPools = createDeck().reduce<Record<string, CardInstance[]>>((pools, card) => {
    pools[card.definitionId] ??= []
    pools[card.definitionId].push(card)
    return pools
  }, {})

  return definitionIds.map((definitionId) => {
    const card = cardPools[definitionId]?.shift()

    if (!card) {
      throw new Error(`测试牌池缺少 ${definitionId}`)
    }

    return card
  })
}

function arrangeDefinitionIds(definitionIds: string[]): string[] {
  return arrangeJiAnDaSuoZiHand(takeCards(definitionIds)).map((card) => card.definitionId)
}

describe('吉安打索子自动理牌', () => {
  it('把脑子放最左边，赏和长门组合挨着，小牌放到最右', () => {
    expect(arrangeDefinitionIds([
      'long_ban',
      'point_three',
      'long_di',
      'point_eight',
      'point_six',
      'yao_fu',
      'point_nine',
      'long_tian',
    ])).toEqual([
      'long_tian',
      'yao_fu',
      'point_nine',
      'point_three',
      'point_six',
      'long_di',
      'point_eight',
      'long_ban',
    ])
  })

  it('优先保留四张可出组合，不拆成两个对子', () => {
    expect(arrangeDefinitionIds([
      'point_eight',
      'long_he',
      'long_di',
      'point_five',
      'point_eight',
      'long_di',
      'long_ban',
      'yao_yao_wu',
    ])).toEqual([
      'long_di',
      'long_di',
      'point_eight',
      'point_eight',
      'long_he',
      'point_five',
      'long_ban',
      'yao_yao_wu',
    ])
  })
})
