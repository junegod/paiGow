import type { EventLogEntry } from '@/rules-core/types'

interface EventLogProps {
  events: EventLogEntry[]
}

/**
 * 轻量事件流帮助玩家回看刚刚发生了什么。
 */
export function EventLog({ events }: EventLogProps) {
  return (
    <section className="event-log">
      <div className="event-log__header">
        <h3>桌面播报</h3>
        <span>{events.length} 条</span>
      </div>

      <div className="event-log__list">
        {events
          .slice()
          .reverse()
          .map((event) => (
            <article key={event.id} className={`event-log__item event-log__item--${event.tone}`}>
              <p>{event.message}</p>
              {event.trickIndex ? <small>第 {event.trickIndex} 回合</small> : null}
            </article>
          ))}
      </div>
    </section>
  )
}
