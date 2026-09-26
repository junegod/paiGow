import { useState } from 'react'

import type { LeaveConfirmAction } from '@/ui/components/LeaveConfirmDialog'

/** 牌桌菜单只负责入口展示，离局校验仍由应用控制器处理。 */
interface TableMenuProps {
  /** 打开共享声音设置。 */
  onSettings: () => void
  /** 打开当前局的规则帮助。 */
  onHelp: () => void
  /** 申请重开或离开，不能绕过计分校验。 */
  onLeave: (action: LeaveConfirmAction) => void
  /** 联机对局进行中禁止重开；结算后走下一局入口。 */
  canRestart: boolean
}

/**
 * 桌面菜单独立维护展开状态，关闭后将业务动作交给上层。
 *
 * @param props 设置、帮助与安全离局入口。
 * @returns 保持现有牌桌位置和外观的菜单。
 */
export function TableMenu({ onSettings, onHelp, onLeave, canRestart }: TableMenuProps) {
  const [open, setOpen] = useState(false)

  /**
   * 先关闭菜单再打开目标界面，避免多层遮罩叠加吞掉手势。
   * @param action 目标入口。
   */
  function choose(action: () => void): void {
    setOpen(false)
    action()
  }

  return (
    <>
      <button type="button" className={`table-menu-button ${open ? 'table-menu-button--open' : ''}`}
        aria-label="打开菜单" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="table-menu-button__icon" aria-hidden="true" />
      </button>
      {open ? (
        <>
          <button type="button" className="table-menu-dismiss" aria-label="收起菜单" onClick={() => setOpen(false)} />
          <div className="table-menu-dropdown" role="menu" aria-label="牌桌菜单">
            <button type="button" role="menuitem" onClick={() => choose(onSettings)}>设置</button>
            <button type="button" role="menuitem" onClick={() => choose(onHelp)}>规则与提示</button>
            <button type="button" role="menuitem" disabled={!canRestart}
              title={canRestart ? undefined : '请完成本局后由房主开始下一局'}
              onClick={() => choose(() => onLeave('restart-round'))}>重新开始</button>
            <button type="button" role="menuitem" onClick={() => choose(() => onLeave('return-home'))}>返回首页</button>
          </div>
        </>
      ) : null}
    </>
  )
}
