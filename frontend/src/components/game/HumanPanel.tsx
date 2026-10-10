import { useEffect, useRef, useState } from 'react'
import { Loader2, Send, Sparkles, Star } from 'lucide-react'
import { api } from '../../lib/api'
import type { GameSnapshot, NoteCode, Verdict } from '../../lib/types'
import { useI18n } from '../../lib/i18n'
import { useToast } from '../toast'
import { Seg } from '../ui'
import { VerdictBadge } from './Timeline'

const VERDICTS: Verdict[] = ['yes', 'no', 'irrelevant', 'partial', 'invalid']
const NOTES: NoteCode[] = ['', 'close', 'premise', 'repeat', 'unimportant']

function useBusy() {
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const run = async (fn: () => Promise<unknown>, onOk?: () => void) => {
    setBusy(true)
    try {
      await fn()
      onOk?.()
    } catch (e) {
      toast.error(e)
    } finally {
      setBusy(false)
    }
  }
  return { busy, run }
}

/** Composer for the human player: always available for chat, ask/guess on their turn. */
export function PlayerComposer({ game }: { game: GameSnapshot }) {
  const { t } = useI18n()
  const me = game.config.players.find((p) => p.kind === 'human')!
  const w = game.state.waiting
  const myTurn = w?.kind === 'player' && w.actor === me.id
  const final = myTurn && w.kind === 'player' && w.final
  const [mode, setMode] = useState<'ask' | 'guess' | 'say'>('ask')
  const [text, setText] = useState('')
  const { busy, run } = useBusy()
  const ref = useRef<HTMLTextAreaElement>(null)

  const effective = final ? 'guess' : myTurn ? mode : 'say'
  useEffect(() => {
    if (myTurn) ref.current?.focus()
  }, [myTurn])

  const submit = () => {
    const v = text.trim()
    if (!v) return
    run(() => api.playerAction(game.id, effective, v), () => setText(''))
  }

  const ph = effective === 'ask' ? t('human.askPh') : effective === 'guess' ? t('human.guessPh') : t('human.sayPh')
  const canHint = game.config.rules.allow_hint_requests && game.state.hints_left > 0

  return (
    <div className={`composer ${myTurn ? 'composer-active' : ''}`}>
      <div className="composer-top">
        {myTurn ? (
          <span className="composer-status">{final ? t('game.mustGuess') : t('game.yourTurn')}</span>
        ) : (
          <span className="composer-status faint">{t('human.notYourTurn')}</span>
        )}
        <span className="spacer" />
        {myTurn && !final && (
          <Seg
            value={mode}
            onChange={setMode}
            options={[
              { value: 'ask', label: t('human.modeAsk') },
              { value: 'guess', label: t('human.modeGuess') },
              { value: 'say', label: t('human.modeSay') },
            ]}
          />
        )}
      </div>
      <textarea
        ref={ref}
        className="textarea composer-input"
        rows={effective === 'guess' ? 4 : 2}
        value={text}
        placeholder={ph}
        maxLength={1200}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault()
            submit()
          }
        }}
      />
      <div className="composer-actions">
        <span className="faint small hide-sm">
          <span className="kbd">Enter</span> · <span className="kbd">Shift</span>+<span className="kbd">Enter</span>
        </span>
        <span className="spacer" />
        {myTurn && !final && (
          <>
            <button className="btn btn-ghost btn-sm" disabled={busy || !canHint} onClick={() => run(() => api.playerAction(game.id, 'hint'))}>
              {t('human.hint')}
            </button>
            <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => run(() => api.playerAction(game.id, 'pass'))}>
              {t('human.pass')}
            </button>
          </>
        )}
        {final && (
          <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => run(() => api.playerAction(game.id, 'pass'))}>
            {t('human.pass')}
          </button>
        )}
        <button className="btn btn-primary btn-sm" disabled={busy || !text.trim()} onClick={submit}>
          {busy ? <Loader2 className="spin" /> : <Send />}
          {effective === 'ask' ? t('human.ask') : effective === 'guess' ? t('human.guess') : t('human.say')}
        </button>
      </div>
    </div>
  )
}

function PointChecks({ game, value, onChange, exclude }: { game: GameSnapshot; value: string[]; onChange: (v: string[]) => void; exclude?: string[] }) {
  const pts = game.puzzle.points.filter((p) => !exclude?.includes(p.id))
  if (!pts.length) return null
  return (
    <div className="point-checks">
      {pts.map((p) => (
        <label key={p.id} className={`check ${value.includes(p.id) ? 'on' : ''}`}>
          <input type="checkbox" checked={value.includes(p.id)} onChange={(e) => onChange(e.target.checked ? [...value, p.id] : value.filter((x) => x !== p.id))} />
          <span>{p.text}</span>
          {p.core && <span className="badge">core</span>}
        </label>
      ))}
    </div>
  )
}

/** Panel for a human host: answer questions, judge guesses, write hints. */
export function HostPanel({ game }: { game: GameSnapshot }) {
  // The parent keys this component by the pending request, so local state starts fresh for each one.
  const { t } = useI18n()
  const w = game.state.waiting!
  const target = 'seq' in w ? game.events.find((e) => e.seq === w.seq) : undefined
  const who = game.config.players.find((p) => p.id === w.actor)?.name ?? ''
  const { busy, run } = useBusy()
  const [key, setKey] = useState(false)
  const [note, setNote] = useState<NoteCode>('')
  const [pts, setPts] = useState<string[]>([])
  const [feedback, setFeedback] = useState('')
  const [hint, setHint] = useState('')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [suggestion, setSuggestion] = useState<any>(null)
  const [suggesting, setSuggesting] = useState(false)
  const toast = useToast()

  const suggest = async () => {
    setSuggesting(true)
    try {
      const s = await api.suggest(game.id)
      setSuggestion(s)
      if (s.kind === 'answer') {
        setKey(!!s.key)
        setPts(s.points ?? [])
      } else if (s.kind === 'judge') {
        setPts(s.matched ?? [])
        setFeedback(s.feedback ?? '')
      } else if (s.kind === 'hint') setHint(s.text ?? '')
    } catch (e) {
      toast.error(e)
    } finally {
      setSuggesting(false)
    }
  }

  const SuggestBtn = (
    <button className="btn btn-sm" disabled={suggesting} onClick={suggest}>
      {suggesting ? <Loader2 className="spin" /> : <Sparkles />}
      {t('host.aiSuggest')}
    </button>
  )

  if (w.kind === 'host_answer' && target) {
    const revealed = Object.keys(game.state.revealed)
    return (
      <div className="composer composer-active host-panel">
        <div className="composer-top">
          <span className="composer-status">{t('host.answerTitle', { name: who })}</span>
          <span className="spacer" />
          {SuggestBtn}
        </div>
        <p className="host-q">{target.data.text}</p>
        {suggestion?.kind === 'answer' && (
          <p className="small muted suggestion">
            {t('host.aiSuggestion', { v: t(`verdict.${suggestion.verdict as Verdict}`) })}
            {suggestion.analysis ? ` — ${suggestion.analysis}` : ''}
          </p>
        )}
        <div className="row row-wrap">
          <button className={`chip-toggle ${key ? 'on' : ''}`} onClick={() => setKey(!key)}>
            <Star />
            {t('host.markKey')}
          </button>
          <select className="select select-auto" value={note} onChange={(e) => setNote(e.target.value as NoteCode)} aria-label={t('host.note')}>
            {NOTES.map((n) => (
              <option key={n} value={n}>
                {n ? t(`note.${n}`) : `${t('host.note')} · ${t('common.none')}`}
              </option>
            ))}
          </select>
        </div>
        {game.puzzle.points.length > revealed.length && (
          <div className="field">
            <span className="label">{t('host.confirmPoints')}</span>
            <PointChecks game={game} value={pts} onChange={setPts} exclude={revealed} />
          </div>
        )}
        <div className="verdict-buttons">
          {VERDICTS.map((v) => (
            <button
              key={v}
              className={`verdict-btn v-${v} ${suggestion?.kind === 'answer' && suggestion.verdict === v ? 'suggested' : ''}`}
              disabled={busy}
              onClick={() => run(() => api.hostAnswer(game.id, { verdict: v, key, note: v === 'invalid' ? 'rephrase' : note, points: v === 'invalid' ? [] : pts }))}
            >
              <VerdictBadge v={v} />
            </button>
          ))}
        </div>
      </div>
    )
  }

  if (w.kind === 'host_judge' && target) {
    return (
      <div className="composer composer-active host-panel">
        <div className="composer-top">
          <span className="composer-status">{t('host.judgeTitle', { name: who })}</span>
          <span className="spacer" />
          {SuggestBtn}
        </div>
        <p className="host-q pre">{target.data.text}</p>
        {suggestion?.kind === 'judge' && (
          <p className="small muted suggestion">
            {t('host.aiSuggestion', { v: suggestion.correct ? t('game.correct') : t('game.incorrect') })}
            {suggestion.analysis ? ` — ${suggestion.analysis}` : ''}
          </p>
        )}
        <div className="field">
          <span className="label">{t('host.matched')}</span>
          <PointChecks game={game} value={pts} onChange={setPts} />
        </div>
        <div className="field">
          <span className="label">{t('host.feedback')}</span>
          <input className="input" value={feedback} placeholder={t('host.feedbackPh')} onChange={(e) => setFeedback(e.target.value)} />
        </div>
        <div className="row">
          <span className="spacer" />
          <button className="btn" disabled={busy} onClick={() => run(() => api.hostJudge(game.id, { correct: false, matched: pts, feedback }))}>
            {t('host.incorrect')}
          </button>
          <button className="btn btn-primary" disabled={busy} onClick={() => run(() => api.hostJudge(game.id, { correct: true, matched: pts, feedback }))}>
            {t('host.correct')}
          </button>
        </div>
      </div>
    )
  }

  if (w.kind === 'host_hint') {
    return (
      <div className="composer composer-active host-panel">
        <div className="composer-top">
          <span className="composer-status">{t('host.hintTitle')}</span>
          <span className="spacer" />
          {SuggestBtn}
        </div>
        <p className="small muted">{w.source === 'auto' ? t('host.hintAuto') : t('host.hintRequested', { name: who })}</p>
        <input className="input" value={hint} placeholder={t('game.hintPh')} onChange={(e) => setHint(e.target.value)} />
        <div className="row">
          <span className="spacer" />
          <button className="btn" disabled={busy} onClick={() => run(() => api.hostHint(game.id, { skip: true }))}>
            {t('host.skip')}
          </button>
          <button className="btn" disabled={busy} onClick={() => run(() => api.hostHint(game.id, { use_ai: true }))}>
            <Sparkles />
            {t('host.useAi')}
          </button>
          <button className="btn btn-primary" disabled={busy || !hint.trim()} onClick={() => run(() => api.hostHint(game.id, { text: hint.trim() }))}>
            {t('host.send')}
          </button>
        </div>
      </div>
    )
  }
  return null
}
