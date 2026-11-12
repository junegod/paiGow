/**
 * 一墩结束后先保留牌面供玩家查看，再开始逐家收牌（毫秒）。
 */
export const COLLECT_START_DELAY_MS = 650

/**
 * 两次叠牌动作的起始间隔（毫秒），动作之间保留短暂停顿，模拟手工垒牌。
 */
export const COLLECT_STEP_INTERVAL_MS = 380

/**
 * 每次叠牌和整摞入堆的移动时长（毫秒）。
 * 必须小于步骤间隔，让这一摞先接触下方牌面并发声，再继续拿往下一家。
 */
export const COLLECT_FLIGHT_MS = 300
