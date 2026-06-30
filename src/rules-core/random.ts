import type { RandomSource } from '@/rules-core/types'

/**
 * 使用简单 LCG 保证浏览器和测试环境下的随机序列一致。
 */
export class SeededRandom implements RandomSource {
  private seed: number

  public constructor(seed: number) {
    this.seed = seed >>> 0
  }

  /**
   * 返回 [0, 1) 区间内的伪随机数。
   */
  public next(): number {
    this.seed = (1664525 * this.seed + 1013904223) >>> 0
    return this.seed / 0x100000000
  }

  /**
   * 生成 0 到 maxExclusive-1 的整数。
   */
  public nextInt(maxExclusive: number): number {
    return Math.floor(this.next() * maxExclusive)
  }

  /**
   * Fisher-Yates 洗牌，返回新的数组副本。
   */
  public shuffle<T>(items: T[]): T[] {
    const clonedItems = [...items]

    for (let index = clonedItems.length - 1; index > 0; index -= 1) {
      const nextIndex = this.nextInt(index + 1)
      ;[clonedItems[index], clonedItems[nextIndex]] = [
        clonedItems[nextIndex],
        clonedItems[index],
      ]
    }

    return clonedItems
  }
}
