import type { BotDifficulty } from '@/rules-core/types'

/** 默认机器人难度。旧本地数据没有保存难度时统一回落到标准档。 */
export const DEFAULT_BOT_DIFFICULTY: BotDifficulty = 'standard'

/**
 * 首页难度选择器使用的稳定配置。
 * 文案同时说明三个档位的思考深度，避免玩家误以为专家档会读取暗牌。
 */
export const BOT_DIFFICULTY_OPTIONS: Array<{
  value: BotDifficulty
  label: string
  description: string
}> = [
  {
    value: 'beginner',
    label: '入门',
    description: '会犯新人错误',
  },
  {
    value: 'standard',
    label: '标准',
    description: '稳健算牌',
  },
  {
    value: 'expert',
    label: '专家',
    description: '模拟未知牌',
  },
]

/**
 * 将 IndexedDB 或外部输入规范化为合法难度。
 *
 * @param value 可能来自旧版本本地设置的未知值。
 * @returns 合法机器人难度；无效值回落到标准档。
 */
export function normalizeBotDifficulty(value: unknown): BotDifficulty {
  if (value === 'beginner' || value === 'standard' || value === 'expert') {
    return value
  }

  return DEFAULT_BOT_DIFFICULTY
}
