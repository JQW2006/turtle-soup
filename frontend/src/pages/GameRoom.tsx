import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowDown, Bot, Eye, EyeOff, Flag, Lightbulb, Loader2, Pause, Play, SkipForward, User, X } from 'lucide-react'
import { api } from '../lib/api'
import { useGame } from '../lib/useGame'
import type { GameSnapshot, Verdict } from '../lib/types'
import { useI18n } from '../lib/i18n'
import { useToast } from '../components/toast'
import { Avatar, Confirm, Modal, Seg } from '../components/ui'
import { Timeline } from '../components/game/Timeline'
import { HostPanel, PlayerComposer } from '../components/game/HumanPanel'
import { Report } from '../components/game/Report'
import { Narration } from '../components/ink'

function statusOf(game: GameSnapshot) {
  const s = game.state
  const humanWait = s.waiting && (s.waiting.kind !== 'player' || game.config.players.find((p) => p.id === s.waiting!.actor)?.kind === 'human')
  if (s.status === 'finished') return 'finished'
  if (s.error) return 'error'
  if (humanWait) return 'waiting'
  if (s.paused) return 'paused'
  return 'running'
}

function Counter({ label, used, left }: { label: string; used: number; left: number | null }) {
  const { t } = useI18n()
  const total = left == null ? null : used + left
  return (
    <div className="counter">
      <span className="counter-label">{label}</span>
      <span className="counter-value">
        {used}
        <span className="faint"> / {total ?? t('common.unlimited')}</span>
      </span>
      {total != null && total > 0 && (
        <div className="progress progress-thin">
          <div style={{ width: `${Math.min(100, (used / total) * 100)}%`, background: left === 0 ? 'var(--no)' : 'var(--text-3)' }} />
        </div>
      )}
    </div>
  )
}

function Activity({ game }: { game: GameSnapshot }) {
  const { t } = useI18n()
  const a = game.state.activity
  // answering/judging are shown inline under the question itself
  if (!a || a.kind === 'answering' || a.kind === 'judging') return null
  const idx = game.config.players.findIndex((x) => x.id === a.actor)
  const p = game.config.players[idx]
  const label =
    a.kind === 'thinking'
      ? t('game.thinking', { name: p?.name ?? '' })
      : t(`game.${a.kind}` as 'game.answering')
  return (
    <div className="activity">
      <Avatar name={p?.name ?? t('game.host')} index={p ? idx : 'host'} size={34} />
      <span>{label}</span>
      <span className="typing">
        <i />
        <i />
        <i />
      </span>
    </div>
  )
}

export default function GameRoom() {
  const { id } = useParams()
  const { t } = useI18n()
  const toast = useToast()
  const { game, conn, failed } = useGame(id!)
  // Finished games open with the solution panel on wide screens; on phones it would cover the page.
  const [godView, setGodView] = useState(false)
  const [autoGod, setAutoGod] = useState(false)
  if (game?.state.status === 'finished' && !autoGod) {
    setAutoGod(true)
    if (window.innerWidth > 1180) setGodView(true)
  }
  const [warnGod, setWarnGod] = useState(false)
  const [confirmEnd, setConfirmEnd] = useState(false)
  const [hintOpen, setHintOpen] = useState(false)
  const [hintText, setHintText] = useState('')
  const [hintBusy, setHintBusy] = useState(false)
  const [busy, setBusy] = useState(false)
  const scroller = useRef<HTMLDivElement>(null)
  const stick = useRef(true)
  const [showJump, setShowJump] = useState(false)

  const onScroll = () => {
    const el = scroller.current
    if (!el) return
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 120
    stick.current = near
    setShowJump(!near)
  }

  const scrollBottom = (smooth = true) => {
    const el = scroller.current
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' })
  }

  const evCount = game?.events.length ?? 0
  const activityKey = game?.state.activity ? `${game.state.activity.actor}${game.state.activity.kind}` : ''
  const waitingKey = game?.state.waiting?.kind ?? ''
  useLayoutEffect(() => {
    if (stick.current) scrollBottom(evCount > 0)
  }, [evCount, activityKey, waitingKey])

  // keep following the typewriter while it runs
  useEffect(() => {
    if (!evCount) return
    const iv = setInterval(() => stick.current && scrollBottom(false), 120)
    const to = setTimeout(() => clearInterval(iv), 1800)
    return () => {
      clearInterval(iv)
      clearTimeout(to)
    }
  }, [evCount])

  const finished = game?.state.status === 'finished'

  const onOverride = useCallback(
    (seq: number, verdict: Verdict) => {
      api
        .override(id!, seq, { verdict })
        .then(() => toast.ok(t('game.overrideDone')))
        .catch(toast.error)
    },
    [id, toast, t],
  )

  const control = async (action: 'pause' | 'resume' | 'step' | 'end') => {
    setBusy(true)
    try {
      await api.control(id!, action)
    } catch (e) {
      toast.error(e)
    } finally {
      setBusy(false)
    }
  }

  const onRetry = useCallback(() => {
    api.control(id!, 'resume').catch(toast.error)
  }, [id, toast])

  // keyboard: space toggles pause, "s" steps
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tag) || !game || game.state.status !== 'active') return
      if (e.key === ' ') {
        e.preventDefault()
        control(game.state.paused ? 'resume' : 'pause')
      } else if (e.key === 's' || e.key === 'S') control('step')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game?.state.paused, game?.state.status])

  if (failed)
    return (
      <div className="empty">
        {t('game.loadFail')}
        <Link className="btn" to="/games">
          {t('common.back')}
        </Link>
      </div>
    )
  if (!game)
    return (
      <div className="empty">
        <Loader2 className="spin" />
        {t('game.connecting')}
      </div>
    )

  const s = game.state
  const status = statusOf(game)
  const humanPlayer = game.config.players.find((p) => p.kind === 'human')
  const humanHost = game.config.host.kind === 'human'
  const hostWaiting = s.waiting && s.waiting.kind.startsWith('host_')
  const pct = Math.round((finished ? s.report?.coverage ?? s.progress : s.progress) * 100)
  const turnActor = s.waiting?.kind === 'player' ? s.waiting.actor : null

  const jumpTo = (seq: number) => {
    const target = game.events.find((e) => e.seq === seq)?.data.reply_to ?? seq
    document.getElementById(`ev-${target}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  const toggleGod = () => {
    if (!godView && humanPlayer && !finished) setWarnGod(true)
    else setGodView(!godView)
  }

  const sendHint = async () => {
    setHintBusy(true)
    try {
      await api.spectatorHint(game.id, hintText.trim())
      setHintOpen(false)
      setHintText('')
    } catch (e) {
      toast.error(e)
    } finally {
      setHintBusy(false)
    }
  }

  return (
    <div className={`room ${godView ? 'with-god' : ''}`}>
      <aside className="room-left">
        <div className="room-title">
          <h2>{game.puzzle.title}</h2>
          <span className={`status status-${status}`}>
            <span className="dot" />
            {t(`game.status.${status}`)}
          </span>
        </div>

        <div className="side-block">
          <div className="side-label">{t('game.surface')}</div>
          <p className="story story-sm">
            <Narration text={game.puzzle.surface} />
          </p>
          {game.config.rules.extra_rules && (
            <p className="small muted extra-rules">
              {t('game.extraRules')}：{game.config.rules.extra_rules}
            </p>
          )}
        </div>

        <div className="side-block">
          <div className="side-label row">
            {t('game.progress')}
            <span className="spacer" />
            <span className="mono">{pct}%</span>
          </div>
          <div className="progress">
            <div style={{ width: `${pct}%` }} />
          </div>
        </div>

        <div className="side-block counters">
          <Counter label={t('game.questions')} used={s.questions_used} left={s.questions_left} />
          <Counter label={t('game.guesses')} used={s.guesses_used} left={s.guesses_left} />
          <Counter label={t('game.hints')} used={s.hints_used} left={s.hints_left} />
        </div>

        <div className="side-block">
          <div className="side-label">{t('game.players')}</div>
          <ul className="roster">
            <li className={s.activity?.actor === 'host' || hostWaiting ? 'active' : ''}>
              <Avatar name={t('game.host')} index="host" size={40} />
              <span className="roster-name">{t('game.host')}</span>
              <span className="badge">{humanHost ? <User /> : <Bot />}{humanHost ? t('setup.kindHuman') : t('setup.kindAi')}</span>
            </li>
            {game.config.players.map((p, i) => (
              <li key={p.id} className={s.activity?.actor === p.id || turnActor === p.id ? 'active' : ''}>
                <Avatar name={p.name} index={i} size={40} />
                <span className="roster-name">{p.name}</span>
                <span className="badge">{p.kind === 'human' ? <User /> : <Bot />}{p.kind === 'human' ? t('setup.kindHuman') : t(`persona.${p.persona}` as 'persona.logic')}</span>
              </li>
            ))}
          </ul>
        </div>
      </aside>

      <section className="room-center">
        <div className="room-mobile-bar">
          <b>{game.puzzle.title}</b>
          <span className={`status status-${status}`}>
            <span className="dot" />
            {t(`game.status.${status}`)}
          </span>
          <span className="spacer" />
          <span className="mono small">
            Q {s.questions_used}
            {s.questions_left != null ? `/${s.questions_used + s.questions_left}` : ''} · {pct}%
          </span>
        </div>
        {conn === 'retrying' && <div className="conn-bar">{t('game.reconnecting')}</div>}
        <div className="scroller" ref={scroller} onScroll={onScroll}>
          <div className="timeline-wrap">
            <Timeline game={game} godView={godView} onOverride={onOverride} onRetry={onRetry} />
            <Activity game={game} />
            {finished && <Report game={game} />}
          </div>
        </div>
        {showJump && (
          <button className="jump" onClick={() => scrollBottom()} aria-label="scroll to bottom">
            <ArrowDown />
          </button>
        )}

        <div className="dock">
          {!finished && humanPlayer && !hostWaiting && <PlayerComposer game={game} />}
          {!finished && humanHost && hostWaiting && <HostPanel key={`${s.waiting!.kind}-${'seq' in s.waiting! ? s.waiting.seq : s.hints_used}`} game={game} />}
          {!finished && (
            <div className="controls">
              {s.paused || s.error ? (
                <button className="btn btn-primary" disabled={busy} onClick={() => control('resume')}>
                  <Play />
                  {t('game.resume')}
                </button>
              ) : (
                <button className="btn" disabled={busy} onClick={() => control('pause')}>
                  <Pause />
                  {t('game.pause')}
                </button>
              )}
              <button className="btn" disabled={busy || !s.paused || !!s.waiting} onClick={() => control('step')} title={t('game.stepHelp')}>
                <SkipForward />
                <span className="hide-sm">{t('game.step')}</span>
              </button>
              <div className="hide-sm">
                <Seg
                  value={s.delay >= 4 ? 4 : s.delay >= 1 ? 1.5 : 0}
                  onChange={(d) => api.speed(game.id, d).catch(toast.error)}
                  options={[
                    { value: 0, label: t('speed.fast') },
                    { value: 1.5, label: t('speed.normal') },
                    { value: 4, label: t('speed.slow') },
                  ]}
                />
              </div>
              <span className="spacer" />
              <button className="btn btn-ghost" disabled={s.hints_left <= 0} title={s.hints_left <= 0 ? t('game.noHints') : ''} onClick={() => setHintOpen(true)}>
                <Lightbulb />
                <span className="hide-sm">{t('game.giveHint')}</span>
              </button>
              <button className="btn btn-ghost" onClick={toggleGod} title={t('game.godViewHelp')}>
                {godView ? <EyeOff /> : <Eye />}
                <span className="hide-sm">{t('game.godView')}</span>
              </button>
              <button className="btn btn-ghost btn-danger" onClick={() => setConfirmEnd(true)}>
                <Flag />
                <span className="hide-sm">{t('game.end')}</span>
              </button>
            </div>
          )}
        </div>
      </section>

      {godView && (
        <aside className="room-right">
          <div className="god-head">
            <Eye />
            <h3>{t('game.godView')}</h3>
            <span className="spacer" />
            <button className="btn btn-ghost btn-icon btn-sm" onClick={() => setGodView(false)} aria-label={t('common.close')}>
              <X />
            </button>
          </div>
          <div className="side-block">
            <div className="side-label">{t('game.bottom')}</div>
            <p className="story story-sm">{game.puzzle.bottom}</p>
          </div>
          {game.puzzle.host_notes && (
            <div className="side-block">
              <div className="side-label">{t('editor.notes')}</div>
              <p className="small muted pre">{game.puzzle.host_notes}</p>
            </div>
          )}
          <div className="side-block">
            <div className="side-label">{t('game.points')}</div>
            {game.puzzle.points.length === 0 ? (
              <div className="skeleton" style={{ height: 80 }} />
            ) : (
              <ul className="point-list point-list-sm">
                {game.puzzle.points.map((p) => {
                  const seq = s.revealed[p.id]
                  const done = seq != null || s.report?.outcome === 'solved'
                  return (
                    <li key={p.id} className={done ? 'done' : ''}>
                      <span className="point-dot" />
                      <span className="point-text">
                        {p.text}
                        {p.core && <span className="badge">core</span>}
                      </span>
                      {seq != null && (
                        <button className="link mono small" onClick={() => jumpTo(seq)}>
                          #{game.events.find((e) => e.seq === seq)?.data.reply_to ?? seq}
                        </button>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </aside>
      )}

      {warnGod && (
        <Confirm
          title={t('game.godView')}
          body={t('game.godViewWarn')}
          onClose={() => setWarnGod(false)}
          onConfirm={() => setGodView(true)}
        />
      )}
      {confirmEnd && (
        <Confirm danger title={t('game.endTitle')} body={t('game.endBody')} confirmLabel={t('game.end')} onClose={() => setConfirmEnd(false)} onConfirm={() => control('end')} />
      )}
      {hintOpen && (
        <Modal onClose={() => setHintOpen(false)}>
          <div className="modal-head">
            <h2>{t('game.hintTitle')}</h2>
          </div>
          <div className="modal-body stack">
            <p>{t('game.hintBody')}</p>
            <textarea className="textarea" rows={3} autoFocus value={hintText} placeholder={t('game.hintPh')} onChange={(e) => setHintText(e.target.value)} />
          </div>
          <div className="modal-foot">
            <button className="btn" onClick={() => setHintOpen(false)}>
              {t('common.cancel')}
            </button>
            <button className="btn btn-primary" disabled={hintBusy} onClick={sendHint}>
              {hintBusy && <Loader2 className="spin" />}
              {t('game.hintSend')}
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}
