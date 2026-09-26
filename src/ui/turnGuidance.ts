import type { RoundState, SelectionPreview } from '@/rules-core/types'

/** 规则门类对应的玩家用语，与规则页保持一致。 */
const DOOR_NAMES = { long: '长门', yao: '幺门', point: '点子门' } as const

/**
 * 在规则引擎已有校验结果上补充具体门类和可用动作，不重新判断牌型大小。
 *
 * @param round 当前局面。
 * @param preview 引擎对当前选牌的判断。
 * @returns 适合牌桌直接阅读的完整提示。
 */
export function describeTurnSelection(round: RoundState | null, preview: SelectionPreview): string {
  if (!round) {
    return preview.hint
  }
  const intents = new Set(preview.actions.map((action) => action.intent))
  if (preview.selectedCardIds.length > 0 && round.currentTrick && !round.pendingDice) {
    const canEat = intents.has('respond-eat')
    const canDiscard = intents.has('respond-pass-hidden')
    if (canEat && canDiscard) {
      return '这组牌可以明吃，也可以背面弃牌。请选择操作。'
    }
    if (canEat) {
      return '这组牌可以明吃；本回合必须吃活赏，不能弃牌。'
    }
    if (canDiscard) {
      return '这组牌不能吃当前牌，只能背面弃牌；也可重新选牌。'
    }
  }
  if (round.pendingDice) {
    return `本次定门：${DOOR_NAMES[round.pendingDice.forcedDoor]}。${preview.hint}`
  }
  if (round.currentTrick && preview.selectedCardIds.length === 0) {
    return `本回合需选 ${round.currentTrick.expectedCardCount} 张。${preview.hint}`
  }
  return preview.hint
}
