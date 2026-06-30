import type { PlayGroup } from '@/rules-core/types'

/**
 * 长门混搭组合与普通对子不共用比较序列，因此单独维护配方表。
 */
export interface ComboRecipe {
  id: string
  label: string
  group: Extract<PlayGroup, 'long-combo-2' | 'long-combo-3' | 'long-combo-4'>
  strength: number
  definitions: string[]
}

export const REWARD_DEFINITION_IDS = ['point_three', 'point_six']

export const LONG_COMBO_TWO_RECIPES: ComboRecipe[] = [
  {
    id: 'combo-he-five',
    label: '和五',
    group: 'long-combo-2',
    strength: 1,
    definitions: ['long_he', 'point_five'],
  },
  {
    id: 'combo-ren-seven',
    label: '人七',
    group: 'long-combo-2',
    strength: 2,
    definitions: ['long_ren', 'point_seven'],
  },
  {
    id: 'combo-di-eight',
    label: '地八',
    group: 'long-combo-2',
    strength: 3,
    definitions: ['long_di', 'point_eight'],
  },
  {
    id: 'combo-tian-nine',
    label: '天九',
    group: 'long-combo-2',
    strength: 4,
    definitions: ['long_tian', 'point_nine'],
  },
]

export const LONG_COMBO_THREE_RECIPES: ComboRecipe[] = [
  {
    id: 'combo-he-he-five',
    label: '和和五',
    group: 'long-combo-3',
    strength: 1,
    definitions: ['long_he', 'long_he', 'point_five'],
  },
  {
    id: 'combo-he-five-five',
    label: '和五五',
    group: 'long-combo-3',
    strength: 1,
    definitions: ['long_he', 'point_five', 'point_five'],
  },
  {
    id: 'combo-ren-ren-seven',
    label: '人人七',
    group: 'long-combo-3',
    strength: 2,
    definitions: ['long_ren', 'long_ren', 'point_seven'],
  },
  {
    id: 'combo-seven-seven-ren',
    label: '七七人',
    group: 'long-combo-3',
    strength: 2,
    definitions: ['long_ren', 'point_seven', 'point_seven'],
  },
  {
    id: 'combo-di-di-eight',
    label: '地地八',
    group: 'long-combo-3',
    strength: 3,
    definitions: ['long_di', 'long_di', 'point_eight'],
  },
  {
    id: 'combo-di-eight-eight',
    label: '地八八',
    group: 'long-combo-3',
    strength: 3,
    definitions: ['long_di', 'point_eight', 'point_eight'],
  },
  {
    id: 'combo-tian-tian-nine',
    label: '天天九',
    group: 'long-combo-3',
    strength: 4,
    definitions: ['long_tian', 'long_tian', 'point_nine'],
  },
  {
    id: 'combo-tian-nine-nine',
    label: '天九九',
    group: 'long-combo-3',
    strength: 4,
    definitions: ['long_tian', 'point_nine', 'point_nine'],
  },
]

export const LONG_COMBO_FOUR_RECIPES: ComboRecipe[] = [
  {
    id: 'combo-he-he-five-five',
    label: '和和五五',
    group: 'long-combo-4',
    strength: 1,
    definitions: ['long_he', 'long_he', 'point_five', 'point_five'],
  },
  {
    id: 'combo-ren-ren-seven-seven',
    label: '人人七七',
    group: 'long-combo-4',
    strength: 2,
    definitions: ['long_ren', 'long_ren', 'point_seven', 'point_seven'],
  },
  {
    id: 'combo-di-di-eight-eight',
    label: '地地八八',
    group: 'long-combo-4',
    strength: 3,
    definitions: ['long_di', 'long_di', 'point_eight', 'point_eight'],
  },
  {
    id: 'combo-tian-tian-nine-nine',
    label: '天天九九',
    group: 'long-combo-4',
    strength: 4,
    definitions: ['long_tian', 'long_tian', 'point_nine', 'point_nine'],
  },
]

export const LONG_COMBO_RECIPES: ComboRecipe[] = [
  ...LONG_COMBO_TWO_RECIPES,
  ...LONG_COMBO_THREE_RECIPES,
  ...LONG_COMBO_FOUR_RECIPES,
]

/**
 * 活赏只允许特定点子对子吃掉，且必须吃。
 */
export const LIVE_REWARD_EATERS = ['point_nine', 'point_seven', 'point_five']

/**
 * 点子对子的正常比较顺序。
 */
export const POINT_PAIR_ORDER = ['point_five', 'point_seven', 'point_eight', 'point_nine']
