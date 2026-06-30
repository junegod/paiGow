import type { CardDefinition, CardInstance, PreparedAction, SeatState } from '@/rules-core/types'

import { CardStrip } from '@/ui/components/CardStrip'

interface ActionPanelProps {
  seatState: SeatState | null
  cardDefinitions: Record<string, CardDefinition>
  selectedCardIds: string[]
  handCards: CardInstance[]
  hint: string
  preparedActions: PreparedAction[]
  canInteract: boolean
  onCardToggle: (cardId: string) => void
  onHandReorder: (cardIds: string[]) => void
  onActionSubmit: (action: PreparedAction) => void
}

interface VisibleActionButton {
  /** 实际提交给规则引擎的原始动作。 */
  action: PreparedAction
  /** 展示给玩家看的短文字，普通动作统一叫“出牌”。 */
  label: string
  /** 额外视觉角色，用于把吃牌按钮做得更醒目。 */
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
 * 将规则层可能返回的多个动作压缩成桌面上的文字按钮。
 */
function createVisibleActionButtons(actions: PreparedAction[]): VisibleActionButton[] {
  const rewardActions = actions.filter(isRewardAction).sort((leftAction, rightAction) =>
    getRewardActionOrder(leftAction) - getRewardActionOrder(rightAction),
  )

  if (rewardActions.length > 0) {
    return rewardActions.map((action) => ({
      action,
      label: action.intent === 'lead-reward-live' ? '活赏' : '死赏',
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

  return rollAction ? [{ action: rollAction, label: '掷骰', role: 'normal' }] : []
}

/**
 * 底部操作区展示当前可见手牌。轮到机器人或其他座位时仍保留底部玩家手牌，
 * 但关闭点选、拖动和出牌按钮，避免操作态与展示态混在一起。
 */
export function ActionPanel({
  seatState,
  cardDefinitions,
  selectedCardIds,
  handCards,
  hint,
  preparedActions,
  canInteract,
  onCardToggle,
  onHandReorder,
  onActionSubmit,
}: ActionPanelProps) {
  const visibleActionButtons = createVisibleActionButtons(preparedActions)

  if (!seatState) {
    return (
      <section className="action-panel">
        <p className="action-panel__hint action-panel__hint--waiting">{hint}</p>
      </section>
    )
  }

  return (
    <section className="action-panel">
      <div className="action-panel__header">
        <div>
          <p className="action-panel__seat">{seatState.config.name}</p>
          <p className="action-panel__hint">{hint}</p>
        </div>
      </div>

      <CardStrip
        cards={handCards}
        cardDefinitions={cardDefinitions}
        hand
        spread
        selectedCardIds={selectedCardIds}
        onCardClick={canInteract ? onCardToggle : undefined}
        draggable={canInteract}
        onCardReorder={onHandReorder}
      />

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
