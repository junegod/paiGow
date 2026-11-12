import type { PreparedAction, SeatState } from '@/rules-core/types'

/**
 * 底部规则提示与玩家操作。手牌本身由三维牌桌渲染，这里不再绘制。
 */
interface ActionPanelProps {
  /**
   * 在牌桌内查看完整提示与规则。
   */
  onHelp: () => void
  seatState: SeatState | null
  /**
   * 当前可见手牌张数，只用于判断是否值得提供整理入口。
   */
  handCount: number
  hint: string
  /**
   * 当前局数，展示在底部提示条最右侧，避免占用牌桌顶部空间。
   */
  roundNumber?: number
  preparedActions: PreparedAction[]
  canInteract: boolean
  /**
   * 是否正在播放自动理牌动画，用于按钮禁用和手牌高亮。
   */
  isOrganizingHand?: boolean
  useBowlForRoll?: boolean
  /**
   * 手动整理当前真人手牌，只调整本地 UI 顺序。
   */
  onOrganizeHand?: () => void
  onActionSubmit: (action: PreparedAction) => void
}

interface VisibleActionButton {
  /**
   * 实际提交给规则引擎的原始动作。
   */
  action: PreparedAction
  /**
   * 展示给玩家看的短文字，普通动作统一叫“出牌”。
   */
  label: string
  /**
   * 额外视觉角色，用于把吃牌按钮做得更醒目。
   */
  role: 'eat' | 'discard' | 'normal'
}

/**
 * 判断是否是打赏动作。赏需要保留“活赏/死赏”两个明确入口，
 * 普通领出动作仍合并为一个“出牌”按钮，降低玩家理解成本。
 */
function isRewardAction(action: PreparedAction): boolean {
  return action.intent === 'lead-reward-live' || action.intent === 'lead-reward-dead'
}

/**
 * 赏牌按钮固定成“死赏、活赏”的顺序，避免规则层返回顺序影响玩家肌肉记忆。
 */
function getRewardActionOrder(action: PreparedAction): number {
  return action.intent === 'lead-reward-dead' ? 0 : 1
}

/**
 * 判断是否属于后手响应动作。响应阶段需要明确给出“吃/弃牌”，
 * 不能再合并成一个“出牌”，否则玩家无法知道这张牌会正面吃还是背面弃。
 */
function isResponseAction(action: PreparedAction): boolean {
  return action.intent === 'respond-eat' || action.intent === 'respond-pass-hidden'
}

/**
 * 把规则动作映射成玩家真正能理解的短按钮文案。
 */
function createResponseActionButton(action: PreparedAction): VisibleActionButton {
  if (action.intent === 'respond-eat') {
    return { action, label: '吃', role: 'eat' }
  }

  return { action, label: '弃牌', role: 'discard' }
}

/**
 * 赏牌按钮要把最后两墩的活赏显示为“孵赏”，
 * 这样玩家在出牌区和结算区看到的是同一套传统叫法。
 */
function createRewardActionLabel(action: PreparedAction): string {
  if (action.intent === 'lead-reward-live') {
    return action.label.includes('孵赏') ? '孵赏' : '活赏'
  }

  return '死赏'
}

/**
 * 将规则层可能返回的多个动作压缩成桌面上的文字按钮。
 */
function createVisibleActionButtons(
  actions: PreparedAction[],
  useBowlForRoll: boolean,
): VisibleActionButton[] {
  const rewardActions = actions.filter(isRewardAction).sort((leftAction, rightAction) =>
    getRewardActionOrder(leftAction) - getRewardActionOrder(rightAction),
  )

  if (rewardActions.length > 0) {
    return rewardActions.map((action) => ({
      action,
      label: createRewardActionLabel(action),
      role: 'normal',
    }))
  }

  const responseActions = actions.filter(isResponseAction)

  if (responseActions.length > 0) {
    return responseActions
      .sort((leftAction, rightAction) => {
        if (leftAction.intent === rightAction.intent) {
          return 0
        }

        return leftAction.intent === 'respond-eat' ? -1 : 1
      })
      .map(createResponseActionButton)
  }

  const diceDiscardAction = actions.find((action) => action.intent === 'resolve-dice-hidden')

  if (diceDiscardAction) {
    return [{ action: diceDiscardAction, label: '弃牌', role: 'discard' }]
  }

  const nonRollAction = actions.find((action) => action.intent !== 'roll-dice')

  if (nonRollAction) {
    return [{ action: nonRollAction, label: '出牌', role: 'normal' }]
  }

  const rollAction = actions.find((action) => action.intent === 'roll-dice')

  return rollAction && !useBowlForRoll
    ? [{ action: rollAction, label: '掷骰', role: 'normal' }]
    : []
}

/**
 * 底部只保留低调的当前提示和文字工具入口，出牌按钮仍由上方独立区域承载。
 * 轮到机器人或其他座位时禁用提交，详细提示可通过规则入口查看。
 *
 * @param props 规则提示与允许执行的交互。
 * @returns 底部提示与操作区，提供局内规则查看入口。
 */
export function ActionPanel({
  seatState,
  onHelp,
  handCount,
  hint,
  roundNumber,
  preparedActions,
  canInteract,
  isOrganizingHand = false,
  useBowlForRoll = false,
  onOrganizeHand,
  onActionSubmit,
}: ActionPanelProps) {
  const visibleActionButtons = createVisibleActionButtons(preparedActions, useBowlForRoll)
  const canOrganizeHand = Boolean(onOrganizeHand) && handCount > 1
  const roundBadge = roundNumber ? (
    <span className="action-panel__round">第{roundNumber}局</span>
  ) : null

  if (!seatState) {
    return (
      <section className="action-panel">
        <div className="action-panel__header">
          <p className="action-panel__hint" title={hint}>{hint}</p>
          {roundBadge}
        </div>
      </section>
    )
  }

  return (
    <section className="action-panel" aria-label={canInteract ? '轮到你了' : '牌局提示'}>
      <div className="action-panel__header">
        <p className="action-panel__hint" aria-live="polite" title={hint}>{hint}</p>
        {canOrganizeHand ? (
          <button
            type="button"
            className="action-panel__organize"
            onClick={onOrganizeHand}
            disabled={isOrganizingHand}
            title="按脑子、可出组合和大小自动整理手牌"
          >
            {isOrganizingHand ? '整理中' : '整理'}
          </button>
        ) : null}
        <button type="button" className="action-panel__help" onClick={onHelp} aria-label="查看规则与当前提示">规则</button>
        {roundBadge}
      </div>

      <div className="action-panel__actions">
        {visibleActionButtons.length > 0 ? (
          visibleActionButtons.map(({ action, label, role }) => (
            <button
              key={action.id}
              type="button"
              className={`action-button action-button--${action.emphasis} action-button--${role}`}
              onClick={() => onActionSubmit(action)}
              disabled={!canInteract}
              title={`${action.label}：${action.description}`}
            >
              {label}
            </button>
          ))
        ) : (
          <div className="action-panel__empty">先选牌，或等待掷骰/回合切换。</div>
        )}
      </div>
    </section>
  )
}
