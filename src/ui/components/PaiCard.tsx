import { motion } from 'framer-motion'

import type { CardDefinition, CardInstance } from '@/rules-core/types'
import { TILE_METRICS } from '@/rules-variants/ji-an-da-suo-zi/cardCatalog'

/**
 * 牌体的 SVG 绘制边界，统一按参考图的高瘦骨牌比例处理。
 */
const TILE_BODY = {
  x: 2,
  y: 3,
  width: TILE_METRICS.width - 4,
  height: TILE_METRICS.height - 6,
  radius: 8,
}

/**
 * 小尺寸牌也复用同一套高瘦比例，避免弹窗和桌面牌出现胖瘦不一致。
 */
const TILE_ASPECT_RATIO = TILE_METRICS.height / TILE_METRICS.width

interface PaiCardProps {
  /** 当前要渲染的具体牌实例，实例只决定副本和唯一标识。 */
  card: CardInstance
  /** 牌的静态定义，包含中文名、别名和 SVG 孔位。 */
  definition: CardDefinition
  /** 是否按背面弃牌渲染；背面弃牌不能通过标题或 DOM 文案泄露真实牌名。 */
  hidden?: boolean
  /** 背面牌的展示说明；死赏盖牌不是弃牌，需要使用不同文案避免误解。 */
  hiddenLabel?: string
  /** 选中态用于手牌操作区，配合外层位移表现“顶起来”。 */
  selected?: boolean
  /** 紧凑尺寸用于弹窗详情，仍保留完整牌面比例。 */
  compact?: boolean
  /** 手牌大尺寸只用于底部操作区，确保手机上能看清牌点。 */
  hand?: boolean
  /** 桌面当前墩尺寸，和底部手牌共用同一套牌面尺寸，避免桌面牌忽大忽小。 */
  arena?: boolean
  /** 微缩尺寸用于赢墩堆、座位预览和弹窗小牌，避免裁掉牌面。 */
  mini?: boolean
  /** 超小尺寸只用于首页 32 张牌选择器，保证手机首屏能完整放下。 */
  tiny?: boolean
  /** 点击回调只暴露给可操作手牌或可查看区域。 */
  onClick?: () => void
}

/**
 * 单张牌的自绘 SVG 组件，既能渲染明牌，也能渲染背面弃牌。
 */
export function PaiCard({
  card,
  definition,
  hidden = false,
  hiddenLabel,
  selected = false,
  compact = false,
  hand = false,
  arena = false,
  mini = false,
  tiny = false,
  onClick,
}: PaiCardProps) {
  const width = tiny ? 23 : mini ? 31 : compact ? 37 : 46
  const height = Math.round(width * TILE_ASPECT_RATIO)
  const cardStyle = hand || arena ? undefined : { width, height }
  const pips = definition.copyPips?.[card.copyIndex] ?? definition.pips
  const gradientPrefix = `pip-${card.id.replaceAll(/[^a-zA-Z0-9_-]/g, '-')}`
  const title = hidden
    ? hiddenLabel ?? '弃牌｜整局结束后统一翻开'
    : `${definition.name}｜${definition.aliases.join(' / ')}`
  const content = (
    <svg
      aria-hidden="true"
      className="pai-card__svg"
      viewBox={`0 0 ${TILE_METRICS.width} ${TILE_METRICS.height}`}
    >
      <defs>
        <linearGradient id={`${gradientPrefix}-core`} x1="0%" x2="0%" y1="0%" y2="100%">
          <stop offset="0%" stopColor="#131313" />
          <stop offset="18%" stopColor="#060606" />
          <stop offset="70%" stopColor="#010101" />
          <stop offset="100%" stopColor="#070707" />
        </linearGradient>
        <linearGradient id={`${gradientPrefix}-back`} x1="0%" x2="0%" y1="0%" y2="100%">
          <stop offset="0%" stopColor="#161616" />
          <stop offset="48%" stopColor="#050505" />
          <stop offset="100%" stopColor="#070707" />
        </linearGradient>
        <linearGradient id={`${gradientPrefix}-side`} x1="0%" x2="100%" y1="0%" y2="100%">
          <stop offset="0%" stopColor="rgba(255,255,255,0.2)" />
          <stop offset="42%" stopColor="rgba(255,255,255,0.03)" />
          <stop offset="100%" stopColor="rgba(0,0,0,0.5)" />
        </linearGradient>
        <radialGradient id={`${gradientPrefix}-pip-well`} cx="42%" cy="58%" r="68%">
          <stop offset="0%" stopColor="#111111" />
          <stop offset="68%" stopColor="#050505" />
          <stop offset="100%" stopColor="#000000" />
        </radialGradient>
        <radialGradient id={`${gradientPrefix}-red`} cx="66%" cy="24%" r="86%">
          <stop offset="0%" stopColor="#ff7b65" />
          <stop offset="18%" stopColor="#ff3122" />
          <stop offset="58%" stopColor="#d70d0c" />
          <stop offset="100%" stopColor="#720205" />
        </radialGradient>
        <radialGradient id={`${gradientPrefix}-white`} cx="66%" cy="24%" r="86%">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="24%" stopColor="#fffdf4" />
          <stop offset="64%" stopColor="#e7e0cf" />
          <stop offset="100%" stopColor="#aca594" />
        </radialGradient>
        <filter id={`${gradientPrefix}-tile-shadow`} x="-24%" y="-12%" width="150%" height="130%">
          <feDropShadow dx="3" dy="4" stdDeviation="2.1" floodColor="#000000" floodOpacity="0.58" />
        </filter>
      </defs>
      <rect
        x={TILE_BODY.x}
        y={TILE_BODY.y}
        width={TILE_BODY.width}
        height={TILE_BODY.height}
        rx={TILE_BODY.radius}
        fill={hidden ? `url(#${gradientPrefix}-back)` : `url(#${gradientPrefix}-core)`}
        className="pai-card__core"
        filter={`url(#${gradientPrefix}-tile-shadow)`}
      />
      <rect
        x={TILE_BODY.x + 1.35}
        y={TILE_BODY.y + 1.35}
        width={TILE_BODY.width - 2.7}
        height={TILE_BODY.height - 2.7}
        rx={TILE_BODY.radius - 1}
        className="pai-card__bevel"
      />
      {hidden ? null : (
        pips.map((mark, index) => {
          const radius = mark.radius ?? 10.4
          const wellRadius = radius + 0.62

          return (
            <g key={`${card.id}-pip-${index}`}>
              <circle
                cx={mark.x}
                cy={mark.y}
                r={wellRadius}
                className="pai-card__pip-well"
                fill={`url(#${gradientPrefix}-pip-well)`}
              />
              <circle
                cx={mark.x}
                cy={mark.y}
                r={radius - 0.18}
                className={`pai-card__pip pai-card__pip--${mark.color}`}
                fill={`url(#${gradientPrefix}-${mark.color})`}
              />
              <ellipse
                cx={mark.x + radius * 0.24}
                cy={mark.y - radius * 0.34}
                rx={radius * 0.18}
                ry={radius * 0.27}
                className={`pai-card__pip-gloss pai-card__pip-gloss--${mark.color}`}
                transform={`rotate(32 ${mark.x + radius * 0.24} ${mark.y - radius * 0.34})`}
              />
            </g>
          )
        })
      )}
    </svg>
  )

  const className = [
    'pai-card',
    selected ? 'pai-card--selected' : '',
    hidden ? 'pai-card--hidden' : '',
    hand ? 'pai-card--hand' : '',
    arena ? 'pai-card--arena' : '',
    compact ? 'pai-card--compact' : '',
    mini ? 'pai-card--mini' : '',
    tiny ? 'pai-card--tiny' : '',
  ]
    .filter(Boolean)
    .join(' ')

  if (onClick) {
    return (
      <motion.button
        whileTap={{ scale: 0.97 }}
        type="button"
        className={className}
        style={cardStyle}
        onClick={onClick}
        title={title}
        aria-label={title}
      >
        {content}
      </motion.button>
    )
  }

  return (
    <div className={className} style={cardStyle} title={title} aria-label={title}>
      {content}
    </div>
  )
}
