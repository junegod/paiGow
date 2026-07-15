import { useEffect } from 'react'

/**
 * 禁止游戏区域出现网页式长按复制、图片拖拽和文字选区。
 * 昵称等真实输入控件仍保留原生编辑能力，避免以后用户资料页面无法操作。
 */
export function useAppGestureGuards(): void {
  useEffect(() => {
    function isEditableTarget(target: EventTarget | null): boolean {
      return target instanceof Element && Boolean(
        target.closest("input:not([type='range']), textarea, [contenteditable='true']"),
      )
    }

    function preventNonGameGesture(event: Event): void {
      if (!isEditableTarget(event.target)) {
        event.preventDefault()
      }
    }

    document.addEventListener('contextmenu', preventNonGameGesture)
    document.addEventListener('selectstart', preventNonGameGesture)
    document.addEventListener('dragstart', preventNonGameGesture)

    return () => {
      document.removeEventListener('contextmenu', preventNonGameGesture)
      document.removeEventListener('selectstart', preventNonGameGesture)
      document.removeEventListener('dragstart', preventNonGameGesture)
    }
  }, [])
}
