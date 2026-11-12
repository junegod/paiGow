import { getCardDefinition, TILE_METRICS } from '@/rules-variants/ji-an-da-suo-zi/cardCatalog'

/**
 * 首页标志直接复用杂九的“四红五白”孔位，避免品牌图形与实际游戏牌面不一致。
 */
const BRAND_CARD = getCardDefinition('point_nine')

/**
 * 标志内骨牌的宽度和缩放比例，牌体与孔位一起按牌目录比例缩小。
 */
const BRAND_TILE_WIDTH = 22
const BRAND_TILE_SCALE = BRAND_TILE_WIDTH / TILE_METRICS.width
const BRAND_TILE_HEIGHT = TILE_METRICS.height * BRAND_TILE_SCALE

/**
 * 品牌标志的入参。
 */
interface BrandMarkProps {
  /**
   * 标志边长（像素）。
   */
  size?: number
}

/**
 * 打索子的品牌标志：朱红印章底上斜压一张真实的九点骨牌。
 *
 * 九点使用牌库里的四红五白孔位与高瘦比例；标志保持纯矢量绘制。
 *
 * @param props 标志尺寸
 * @returns 标志图形，对读屏软件隐藏，由相邻的文字标题承担语义
 */
export function BrandMark({ size = 64 }: BrandMarkProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <defs>
        <linearGradient id="brand-mark-seal" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#d6473c" />
          <stop offset="1" stopColor="#9c231c" />
        </linearGradient>
        <linearGradient id="brand-mark-tile" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#34343a" />
          <stop offset="0.6" stopColor="#08080a" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="15" fill="url(#brand-mark-seal)" />
      <rect x="2" y="2" width="60" height="60" rx="13" fill="none" stroke="rgba(255,224,186,0.28)" strokeWidth="1.5" />
      <g transform="rotate(8 32 34)">
        <rect x="22" y="9" width={BRAND_TILE_WIDTH} height={BRAND_TILE_HEIGHT} rx="2" fill="#000" opacity="0.35" />
        <g transform={`translate(21 7) scale(${BRAND_TILE_SCALE})`}>
          <rect width={TILE_METRICS.width} height={TILE_METRICS.height} rx="8" fill="url(#brand-mark-tile)" />
          {BRAND_CARD.pips.map((mark, index) => (
            <circle
              key={index}
              cx={mark.x}
              cy={mark.y}
              r={mark.radius ?? 10.4}
              fill={mark.color === 'red' ? '#ff5a45' : '#f4eee0'}
            />
          ))}
        </g>
      </g>
    </svg>
  )
}
