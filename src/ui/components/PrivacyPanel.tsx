import { useEffect, useRef } from 'react'

/** 隐私说明既可独立查看，也可作为首次联机的明确确认入口。 */
interface PrivacyPanelProps {
  /** 关闭说明；确认场景下关闭代表取消联机。 */
  onClose: () => void
  /** 确认数据用途后继续联机；普通查看场景不传。 */
  onAccept?: () => void
}

/**
 * 使用原生模态对话框约束键盘焦点，正文来自随安装包提供的同一份隐私文档。
 * @param props 关闭及可选确认回调。
 * @returns 离线可读、允许取消的隐私说明弹窗。
 */
export function PrivacyPanel({ onClose, onAccept }: PrivacyPanelProps) {
  const dialog = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const element = dialog.current
    element?.showModal()
    return () => element?.close()
  }, [])

  return (
    <dialog ref={dialog} className="privacy-panel" aria-labelledby="privacy-title" onCancel={onClose}>
      <header>
        <h2 id="privacy-title">{onAccept ? '联机前请了解' : '隐私与积分说明'}</h2>
        <button type="button" onClick={onClose}>{onAccept ? '暂不联机' : '关闭'}</button>
      </header>
      {onAccept ? <p>联机会向服务器发送昵称、房间身份和操作记录，其他玩家可看到昵称及公开牌局信息。不同意仍可完整使用单机功能。</p> : null}
      <iframe title="打索子隐私说明" src="/privacy.html" sandbox="allow-popups allow-popups-to-escape-sandbox" />
      {onAccept ? <button type="button" className="hero-button hero-button--primary" onClick={onAccept}>同意并继续联机</button> : null}
    </dialog>
  )
}
