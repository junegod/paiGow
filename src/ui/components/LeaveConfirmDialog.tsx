/** 可确认的牌桌离开动作。 */
export type LeaveConfirmAction = 'restart-round' | 'return-home'

/** 积分局中途离开的确认内容。 */
export interface LeaveConfirmState {
  action: LeaveConfirmAction
  title: string
  message: string
  confirmLabel: string
}

interface LeaveConfirmDialogProps {
  /** 当前确认内容；为 null 时不渲染。 */
  state: LeaveConfirmState | null
  /** 本地扣分或持久化错误。 */
  error: string | null
  /** 是否正在提交离局扣分。 */
  submitting: boolean
  /** 取消离开并返回牌桌。 */
  onCancel: () => void
  /** 确认扣分并执行离开动作。 */
  onConfirm: () => void
}

/** 积分局中途离开确认弹窗，联机模式不会触发此组件。 */
export function LeaveConfirmDialog({
  state,
  error,
  submitting,
  onCancel,
  onConfirm,
}: LeaveConfirmDialogProps) {
  if (!state) {
    return null
  }

  return (
    <div
      className="leave-confirm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="leave-confirm-title"
      aria-describedby="leave-confirm-desc"
    >
      <button
        type="button"
        className="leave-confirm__backdrop"
        aria-label="继续牌桌"
        onClick={onCancel}
        disabled={submitting}
      />
      <section className="leave-confirm__panel">
        <p className="leave-confirm__eyebrow">积分局保护</p>
        <h2 id="leave-confirm-title">{state.title}</h2>
        <p id="leave-confirm-desc">{state.message}</p>
        {error ? <p className="leave-confirm__error">{error}</p> : null}
        <div className="leave-confirm__actions">
          <button
            type="button"
            className="hero-button hero-button--ghost"
            onClick={onCancel}
            disabled={submitting}
          >
            继续牌桌
          </button>
          <button
            type="button"
            className="hero-button hero-button--primary leave-confirm__danger"
            onClick={onConfirm}
            disabled={submitting}
          >
            {submitting ? '扣分中...' : state.confirmLabel}
          </button>
        </div>
      </section>
    </div>
  )
}
