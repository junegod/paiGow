import { AnimatePresence, motion } from 'framer-motion'
import type { ReactNode } from 'react'

interface InspectorDrawerProps {
  open: boolean
  title: string
  subtitle?: string
  onClose: () => void
  children: ReactNode
}

/**
 * 居中弹窗统一承载回合详情、赢墩堆详情与复盘内容。
 * 参考传统骨牌广告截图的紫底金框样式，避免移动端底部抽屉遮住手牌。
 */
export function InspectorDrawer({
  open,
  title,
  subtitle,
  onClose,
  children,
}: InspectorDrawerProps) {
  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          className="drawer"
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
              <button type="button" className="drawer__close" onClick={onClose}>
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
