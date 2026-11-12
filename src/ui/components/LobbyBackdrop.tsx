import { useEffect, useRef } from 'react'

import { CARD_DEFINITION_MAP } from '@/rules-variants/ji-an-da-suo-zi/cardCatalog'
import { LobbyScene } from '@/ui/table3d/LobbyScene'

/**
 * 首页背景里立着展示的牌，从左到右：天、斧头、九点、六点、三点。
 */
const SHOW_CARD_DEFINITION_IDS = ['long_tian', 'yao_fu', 'point_nine', 'point_six', 'point_three']

/**
 * 首页的三维背景。
 *
 * 只负责挂载和销毁背景场景；设备不支持三维渲染时静默留空，由首页的纯色底兜底。
 *
 * @returns 承载背景画布的容器
 */
export default function LobbyBackdrop() {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) {
      return
    }
    const faces = SHOW_CARD_DEFINITION_IDS.flatMap((definitionId) => {
      const definition = CARD_DEFINITION_MAP[definitionId]
      return definition ? [definition.pips] : []
    })
    let scene: LobbyScene
    try {
      scene = new LobbyScene(container, faces)
    } catch {
      /*
       * 背景只是装饰，创建失败不影响首页功能，保持纯色底即可。
       */
      return
    }
    return () => scene.dispose()
  }, [])

  return <div ref={containerRef} className="lobby__backdrop" aria-hidden="true" />
}
