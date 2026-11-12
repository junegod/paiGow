import { AnimatePresence, motion } from 'framer-motion'
import type { ReactNode } from 'react'

/**
 * 通用详情弹窗的展示内容、开关状态和局部主题入口。
 */
interface InspectorDrawerProps {
  /**
   * 是否展示弹窗，关闭时沿用退出动画。
   */
  open: boolean
  /**
   * 弹窗标题，同时作为对话框的无障碍名称。
   */
  title: string
  /**
   * 可选的标题补充说明。
   */
  subtitle?: string
  /**
   * 点击遮罩或关闭入口时调用，由业务方管理开关状态。
   */
  onClose: () => void
  /**
   * 业务内容，不在通用弹窗中读取或修改牌局状态。
   */
  children: ReactNode
  /**
   * 业务主题类名，用于局部调整外观，避免不同详情窗口互相影响。
   */
  className?: string
}

/**
 * 居中弹窗统一承载回合详情、赢墩堆详情与复盘内容。
 * 业务方通过主题类名复用窗口结构、遮罩和进出动画。
 *
 * @param props 标题、窗口内容、主题类名及关闭回调。
 * @returns 带统一遮罩和关闭入口的详情弹窗。
 */
export function InspectorDrawer({
  open,
  title,
  subtitle,
  onClose,
  children,
  className,
}: InspectorDrawerProps) {
  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          className={className ? `drawer ${className}` : 'drawer'}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <button
            type="button"
            aria-label="关闭详情弹窗"
            className="drawer__backdrop"
            onClick={onClose}
          />
          <motion.section
            className="drawer__panel"
            role="dialog"
            aria-modal="true"
            aria-label={title}
            initial={{ scale: 0.92, y: 18, opacity: 0 }}
            animate={{ scale: 1, y: 0, opacity: 1 }}
            exit={{ scale: 0.92, y: 18, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 320, damping: 26 }}
          >
            <header className="drawer__header">
              <div>
                <h3>{title}</h3>
                {subtitle ? <p>{subtitle}</p> : null}
              </div>
              <button type="button" className="drawer__close" aria-label={`关闭${title}`} onClick={onClose}>
                关闭
              </button>
            </header>
            <div className="drawer__body">{children}</div>
          </motion.section>
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}
