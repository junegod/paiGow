import type { CardInstance, SeatId } from '@/rules-core/types'

/**
 * 统计一组字符串键的出现次数。
 */
export function countBy(values: string[]): Record<string, number> {
  return values.reduce<Record<string, number>>((accumulator, value) => {
    accumulator[value] = (accumulator[value] ?? 0) + 1
    return accumulator
  }, {})
}

/**
 * 将具体手牌按定义 id 分组，便于做对子与组合判断。
 */
export function groupCardsByDefinition(
  cards: CardInstance[],
): Record<string, CardInstance[]> {
  return cards.reduce<Record<string, CardInstance[]>>((accumulator, card) => {
    accumulator[card.definitionId] ??= []
    accumulator[card.definitionId].push(card)
    return accumulator
  }, {})
}

/**
 * 按顺时针推进到下一个座位。
 */
export function nextSeat(seat: SeatId): SeatId {
  return ((seat + 1) % 4) as SeatId
}

/**
 * 按顺时针推进指定步数，起点按 inclusive 计数规则处理时请自行减 1。
 */
export function advanceSeat(seat: SeatId, steps: number): SeatId {
  return ((seat + steps + 4) % 4) as SeatId
}

/**
 * 生成指定长度的组合，主要用于机器人搜索弃牌方案。
 */
export function getCombinations<T>(items: T[], size: number): T[][] {
  if (size === 0) {
    return [[]]
  }

  if (size > items.length) {
    return []
  }

  if (size === items.length) {
    return [items]
  }

  const [firstItem, ...restItems] = items
  const withFirstItem = getCombinations(restItems, size - 1).map(
    (combination) => [firstItem, ...combination],
  )
  const withoutFirstItem = getCombinations(restItems, size)

  return [...withFirstItem, ...withoutFirstItem]
}

/**
 * 便于在测试和运行态中生成稳定 id。
 */
export function createStableId(prefix: string, parts: Array<string | number>): string {
  return `${prefix}:${parts.join(':')}`
}
