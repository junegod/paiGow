import { SeededRandom } from '@/rules-core/random'
import type { SeatConfig } from '@/rules-core/types'
import { DEFAULT_SEAT_CONFIGS } from '@/rules-variants/ji-an-da-suo-zi/cardCatalog'

/**
 * 单机牌友的村里称呼；新开一桌时随机抽取，同一桌内不重复，也不在回合间改名。
 */
const VILLAGE_BOT_NAMES = [
  '三叔', '骚古', '小毛', '二哥', '满叔', '细毛', '阿根', '桂婶',
  '来福', '石头', '冬生', '春生', '阿财', '老根', '喜哥', '阿旺',
  '桂花', '秀婶', '小兰', '木匠', '长生', '水生', '阿贵', '福伯',
] as const

/**
 * 为新建的单机牌桌生成独立座位配置，只替换机器人称呼。
 *
 * @param seed 当前整场牌局的种子，相同种子得到相同称呼，方便重现局面。
 * @returns 保留真人名称、座位、人机模式和颜色的新配置数组。
 */
export function createVillageSeatConfigs(seed: number): SeatConfig[] {
  // 名字使用独立随机源，不能消耗发牌或机器人决策的随机序列。
  const names = new SeededRandom(seed).shuffle([...VILLAGE_BOT_NAMES])
  let botIndex = 0
  return DEFAULT_SEAT_CONFIGS.map((config) => {
    if (config.mode !== 'bot') {
      return { ...config }
    }
    // 每个机器人只取一个未使用的名字；配置扩展超出名字池时保留原名称兜底。
    return { ...config, name: names[botIndex++] ?? config.name }
  })
}
