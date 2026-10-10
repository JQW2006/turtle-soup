import { useEffect, useRef, useState } from 'react'
import { streamUrl } from './api'
import type { GameEvent, GameSnapshot, GameState } from './types'

type Conn = 'connecting' | 'open' | 'retrying'

type Msg =
  | ({ type: 'snapshot' } & GameSnapshot)
  | { type: 'event'; event: GameEvent }
  | { type: 'event_update'; event: GameEvent }
  | { type: 'state'; state: GameState }
  | { type: 'activity'; activity: GameState['activity'] }
  | { type: 'puzzle'; puzzle: GameSnapshot['puzzle'] }

/** Live view of a game: initial snapshot + incremental updates over SSE. */
export function useGame(id: string) {
  const [game, setGame] = useState<GameSnapshot | null>(null)
  const [conn, setConn] = useState<Conn>('connecting')
  const [failed, setFailed] = useState(false)
  const loaded = useRef(false)

  useEffect(() => {
    loaded.current = false
    let es: EventSource | null = null
    let closed = false
    let errors = 0

    const open = () => {
      es = new EventSource(streamUrl(id))
      es.onopen = () => setConn('open')
      es.onerror = () => {
        errors += 1
        if (!loaded.current && errors >= 3) {
          setFailed(true)
          es?.close()
          return
        }
        setConn('retrying')
      }
      es.onmessage = (e) => {
        errors = 0
        const msg = JSON.parse(e.data) as Msg
        setGame((g) => apply(g, msg, loaded.current))
        if (msg.type === 'snapshot') loaded.current = true
      }
    }
    open()

    const onVisible = () => {
      // Browsers may silently drop long-lived connections in background tabs.
      if (document.visibilityState === 'visible' && es?.readyState === EventSource.CLOSED && !closed) open()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      closed = true
      es?.close()
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [id])

  return { game, conn, failed, setGame }
}

function apply(g: GameSnapshot | null, msg: Msg, live: boolean): GameSnapshot | null {
  if (msg.type === 'snapshot') {
    const { type: _t, ...snap } = msg
    void _t
    return snap
  }
  if (!g) return g
  switch (msg.type) {
    case 'event':
      if (g.events.some((e) => e.seq === msg.event.seq)) return g
      return { ...g, events: [...g.events, { ...msg.event, live }] }
    case 'event_update':
      return { ...g, events: g.events.map((e) => (e.seq === msg.event.seq ? { ...msg.event, live: false } : e)) }
    case 'state':
      return { ...g, state: msg.state }
    case 'puzzle':
      return { ...g, puzzle: msg.puzzle }
    case 'activity':
      return { ...g, state: { ...g.state, activity: msg.activity } }
  }
}
