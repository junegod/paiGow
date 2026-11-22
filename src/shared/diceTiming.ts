/**
 * 骰子滚动动画时长。原来约 0.76 秒，这里额外增加 1 秒，
 * 让玩家能明确感受到“掷骰子”的过程。
 */
export const DICE_ROLL_ANIMATION_MS = 1760

/**
 * 骰子落定后的结果停留时长。机器人和真人都先暂停操作，
 * 避免点数刚出来就进入下一步导致看不清。
 */
export const DICE_RESULT_HOLD_MS = 2000

/**
 * 掷骰后整段展示锁定时长：滚动动画 + 落定停留。
 */
export const DICE_TOTAL_DISPLAY_MS = DICE_ROLL_ANIMATION_MS + DICE_RESULT_HOLD_MS
