import { useMemo } from 'react'

import type { PreparedAction, RoundState, RuleSet, SeatId } from '@/rules-core/types'
import { InspectorDrawer } from '@/ui/components/InspectorDrawer'
import { RulesPanel } from '@/ui/components/RulesPanel'

/** 局内帮助只读取公开局面与自己的合法动作，不使用机器人策略或对手暗牌。 */
interface GameHelpPanelProps {
  /** 是否打开帮助弹窗。 */
  open: boolean
  /** 当前局快照，联机时已经由服务端裁剪。 */
  round: RoundState
  /** 复用当前玩法规则入口。 */
  ruleSet: RuleSet
  /** 当前玩家自己的界面座位。 */
  seat: SeatId
  /** 当前选择的规则解释，包含不可出牌的原因。 */
  hint: string
  /** 是否可以操作；动画、断网或其他玩家回合时不推荐动作。 */
  canInteract: boolean
  /** 仅不计分的定制练习局展示合法出法示例。 */
  practice: boolean
  /** 仅选中手牌，仍需玩家自行确认实际出牌方式。 */
  onSelect: (cardIds: string[]) => void
  /** 关闭弹窗回到原牌桌。 */
  onClose: () => void
}

/**
 * 展示当前操作说明并嵌入既有规则页；定制局额外给出最多三组合法选牌。
 *
 * @param props 当前牌局、规则集和帮助入口。
 * @returns 可在对局中查看的规则弹窗，不改变牌局进度。
 */
export function GameHelpPanel({ open, round, ruleSet, seat, hint, canInteract, practice, onSelect, onClose }: GameHelpPanelProps) {
  const suggestions = useMemo(() => {
    if (!open || !practice || !canInteract) {
      return []
    }
    // 直接使用引擎的合法动作。相同牌组的活赏/死赏不重复占用示例位置。
    const seen = new Set<string>()
    return ruleSet.listTurnActions(round, seat).filter((action) => {
      const key = [...action.selectedCardIds].sort().join('|')
      if (!key || seen.has(key)) {
        return false
      }
      seen.add(key)
      return true
    }).slice(0, 3)
  }, [open, practice, canInteract, ruleSet, round, seat])

  /**
   * 再次核对当前回合的合法动作后只选牌，防止弹窗打开期间状态推进后使用旧提示。
   * @param action 玩家选择的合法示例。
   */
  function selectExample(action: PreparedAction): void {
    if (!canInteract || !practice || !ruleSet.listTurnActions(round, seat).some((item) => item.id === action.id)) {
      return
    }
    onSelect(action.selectedCardIds)
    onClose()
  }

  return (
    <InspectorDrawer open={open} title="规则与提示" onClose={onClose}>
      <div className="game-help">
        <section className="game-help__current" aria-label="当前操作说明">
          <strong>{canInteract ? '轮到你了' : '当前牌局'}</strong>
          <p>{hint}</p>
          <p>点击手牌选中，再点“出牌”“吃”或“弃牌”确认；点骰碗掷骰。</p>
          {suggestions.length > 0 ? (
            <div className="game-help__examples">
              <p>练习示例：以下牌组当前合法，不代表最佳策略。选中后仍需确认出牌。</p>
              {suggestions.map((action) => (
                <button type="button" key={action.id} onClick={() => selectExample(action)}>
                  <strong>选择：{action.label}</strong><span>{action.description}</span>
                </button>
              ))}
            </div>
          ) : null}
        </section>
        <RulesPanel onBack={onClose} backLabel="返回牌桌" />
      </div>
    </InspectorDrawer>
  )
}
