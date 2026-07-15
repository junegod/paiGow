import { describe, expect, it } from 'vitest'

import {
  BOT_DIFFICULTY_OPTIONS,
  DEFAULT_BOT_DIFFICULTY,
  normalizeBotDifficulty,
} from '@/app/botDifficulty'

describe('机器人难度设置', () => {
  it('默认使用标准难度', () => {
    expect(DEFAULT_BOT_DIFFICULTY).toBe('standard')
  })

  it('旧设置缺失或非法时回落到标准难度', () => {
    expect(normalizeBotDifficulty(undefined)).toBe('standard')
    expect(normalizeBotDifficulty('unknown')).toBe('standard')
  })

  it('首页提供入门、标准、专家三个稳定选项', () => {
    expect(BOT_DIFFICULTY_OPTIONS.map((option) => option.value)).toEqual([
      'beginner',
      'standard',
      'expert',
    ])
  })
})
