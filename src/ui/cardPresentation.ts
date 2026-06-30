import type { CardInstance, PlayedAction } from '@/rules-core/types'

/**
 * 死赏是公开牌型，但传统摆法会盖住其中一张牌来表示“死”。
 * 这里固定盖住展开序列里的后一张，保证桌面、详情和赢墩堆展示一致。
 */
export function shouldCoverCardForDeadReward(
  play: PlayedAction,
  _card: CardInstance,
  index: number,
): boolean {
  return play.pattern.group === 'reward-dead' && index === play.cards.length - 1
}

/**
 * 死赏盖牌只是形式标记，不等同于背面弃牌；标题文案需要明确说明牌型仍公开。
 */
export function getDeadRewardCoverLabel(
  play: PlayedAction,
  card: CardInstance,
  index: number,
): string | undefined {
  return shouldCoverCardForDeadReward(play, card, index)
    ? '死赏盖牌｜牌型公开'
    : undefined
}
