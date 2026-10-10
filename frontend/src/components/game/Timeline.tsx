import { memo, useEffect, useState, type ReactNode } from 'react'
import { Check, ChevronRight, Lightbulb, PenLine, Star, X, AlertTriangle, RotateCw, Flag } from 'lucide-react'
import type { GameEvent, GameSnapshot, Verdict } from '../../lib/types'
import { useI18n } from '../../lib/i18n'
import { Avatar, Menu } from '../ui'
import { Narration } from '../ink'

const VERDICTS: Verdict[] = ['yes', 'no', 'irrelevant', 'partial', 'invalid']

export function VerdictBadge({ v, stamp }: { v: Verdict; stamp?: boolean }) {
  const { t } = useI18n()
  if (stamp) return <span className={`stamp stamp-${v}`}>{t(`verdict.${v}`)}</span>
  const cls = v === 'yes' ? 'badge-yes' : v === 'no' ? 'badge-no' : v === 'partial' ? 'badge-partial' : v === 'invalid' ? 'badge-outline' : ''
  return <span className={`badge verdict ${cls}`}>{t(`verdict.${v}`)}</span>
}

/** Reveals text progressively for events that arrived live. */
function Typewriter({ text, live }: { text: string; live?: boolean }) {
  const [n, setN] = useState(live ? 0 : text.length)
  useEffect(() => {
    if (!live) return
    const chars = Array.from(text)
    const step = Math.max(1, Math.ceil(chars.length / 60))
    let i = 0
    const id = setInterval(() => {
      i = Math.min(chars.length, i + step)
      setN(i)
      if (i >= chars.length) clearInterval(id)
    }, 18)
    return () => clearInterval(id)
  }, [text, live])
  if (!live || n >= text.length) return <>{text}</>
  return (
    <>
      {Array.from(text).slice(0, n).join('')}
      <span className="caret" />
    </>
  )
}

function Fold({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <div className={`fold ${open ? 'open' : ''}`}>
      <button className="fold-btn" onClick={() => setOpen(!open)}>
        <ChevronRight />
        {label}
      </button>
      {open && <div className="fold-body">{children}</div>}
    </div>
  )
}

interface Ctx {
  game: GameSnapshot
  godView: boolean
  onOverride: (seq: number, verdict: Verdict) => void
}

function useNames(game: GameSnapshot) {
  const { t } = useI18n()
  return (actor: string | null | undefined) => {
    if (!actor) return ''
    if (actor === 'host') return t('game.host')
    if (actor === 'human') return t('game.spectator')
    return game.config.players.find((p) => p.id === actor)?.name ?? actor
  }
}

/** One line on the stage: a portrait on one side and a speech bubble pointing at it. */
function Beat({
  game,
  actor,
  kind,
  compact,
  id,
  children,
}: {
  game: GameSnapshot
  actor: string
  kind: string
  compact?: boolean
  id: string
  children: ReactNode
}) {
  const { t } = useI18n()
  const idx = game.config.players.findIndex((x) => x.id === actor)
  const p = game.config.players[idx]
  const name = p?.name ?? (actor === 'human' ? t('game.spectator') : actor)
  const side = idx % 2 === 1 ? 'right' : 'left'
  return (
    <div className={`beat beat-${side} beat-${kind} ${compact ? 'beat-cont' : ''}`} id={id}>
      <div className="beat-who">
        {!compact && (
          <>
            <Avatar name={name} index={idx >= 0 ? idx : undefined} size={68} />
            <span className="beat-name" style={{ color: p?.color }}>
              {name}
            </span>
          </>
        )}
      </div>
      <div className="beat-main">{children}</div>
    </div>
  )
}

function Pending() {
  return (
    <div className="answer answer-pending">
      <Avatar name="host" index="host" size={30} />
      <span className="typing">
        <i />
        <i />
        <i />
      </span>
    </div>
  )
}

function Question({ e, answer, ctx, compact }: { e: GameEvent; answer?: GameEvent; ctx: Ctx; compact?: boolean }) {
  const { t } = useI18n()
  const { game, godView } = ctx
  const a = answer?.data
  const finished = game.state.status === 'finished'
  return (
    <Beat game={game} actor={e.actor} kind="question" compact={compact} id={`ev-${e.seq}`}>
      <div className={`bubble ${a?.key ? 'bubble-key' : ''}`}>
        {a?.qnum ? <span className="bubble-tag mono">{t('game.qnum', { n: a.qnum })}</span> : null}
        <p className="q-text">
          <Typewriter text={e.data.text} live={e.live} />
        </p>
      </div>
      {a ? (
        <div className={`answer ${a.key ? 'answer-key' : ''}`}>
          <Avatar name={t('game.host')} index="host" size={30} />
          <VerdictBadge v={a.verdict} stamp />
          {a.key && (
            <span className="key-mark">
              <Star />
              {t('game.key')}
            </span>
          )}
          {a.note && <span className="note">{t(`note.${a.note}` as 'note.close') ?? a.note}</span>}
          {a.verdict === 'invalid' && <span className="faint small">{t('game.notCounted')}</span>}
          {a.overridden && <span className="badge badge-outline">{t('game.overridden')}</span>}
          <span className="spacer" />
          <Menu
            trigger={(toggle) => (
              <button className="btn btn-ghost btn-icon btn-sm override-btn" onClick={toggle} title={t('game.override')} aria-label={t('game.override')}>
                <PenLine />
              </button>
            )}
          >
            {(close) =>
              VERDICTS.filter((v) => v !== a.verdict).map((v) => (
                <button
                  key={v}
                  onClick={() => {
                    close()
                    ctx.onOverride(answer!.seq, v)
                  }}
                >
                  {t(`verdict.${v}`)}
                </button>
              ))
            }
          </Menu>
        </div>
      ) : (
        game.state.activity?.kind === 'answering' && <Pending />
      )}
      <div className="folds">
        {e.data.analysis && <Fold label={t('game.analysis')}>{e.data.analysis}</Fold>}
        {a?.analysis && (godView || finished) && <Fold label={t('game.hostAnalysis')}>{a.analysis}</Fold>}
      </div>
    </Beat>
  )
}

function Guess({ e, judgement, ctx, compact }: { e: GameEvent; judgement?: GameEvent; ctx: Ctx; compact?: boolean }) {
  const { t } = useI18n()
  const { game, godView } = ctx
  const j = judgement?.data
  const finished = game.state.status === 'finished'
  return (
    <Beat game={game} actor={e.actor} kind={`guess ${j ? (j.correct ? 'is-correct' : 'is-wrong') : ''}`} compact={compact} id={`ev-${e.seq}`}>
      <div className="bubble bubble-guess">
        <span className="bubble-tag">{e.data.final ? t('game.finalGuess') : t('game.guess')}</span>
        <p className="pre">
          <Typewriter text={e.data.text} live={e.live} />
        </p>
      </div>
      {j ? (
        <div className="judgement">
          <Avatar name={t('game.host')} index="host" size={30} />
          <span className={`stamp ${j.correct ? 'stamp-yes' : 'stamp-no'}`}>
            {j.correct ? <Check /> : <X />}
            {j.correct ? t('game.correct') : t('game.incorrect')}
          </span>
          {j.feedback && <span className="judgement-fb">{j.feedback}</span>}
          {(godView || finished) && !j.correct && <span className="faint small nowrap">{t('game.coverage', { p: Math.round(j.coverage * 100) })}</span>}
        </div>
      ) : (
        game.state.activity?.kind === 'judging' && <Pending />
      )}
      {j?.analysis && (godView || finished) && (
        <div className="folds">
          <Fold label={t('game.hostAnalysis')}>{j.analysis}</Fold>
        </div>
      )}
    </Beat>
  )
}

function Opening({ e }: { e: GameEvent }) {
  const { t } = useI18n()
  const d = e.data
  const n = (x: number) => (x > 0 ? x : t('common.unlimited'))
  return (
    <div className="opening frame" id={`ev-${e.seq}`}>
      <div className="frame-label">{t('game.opening')}</div>
      <p className="story story-lg narration">
        <Narration text={d.surface} />
      </p>
      <div className="opening-rules">
        <span>{t('game.openingRules')}</span>
        <span>{t('game.limits', { q: n(d.max_questions), g: n(d.max_guesses), h: d.max_hints })}</span>
        {d.extra_rules && (
          <span>
            {t('game.extraRules')}：{d.extra_rules}
          </span>
        )}
      </div>
    </div>
  )
}

function Reveal({ e, game }: { e: GameEvent; game: GameSnapshot }) {
  const { t } = useI18n()
  return (
    <div className="reveal frame" id={`ev-${e.seq}`}>
      <div className="reveal-head">
        <Flag />
        {t('game.revealTitle')}
        <span className={`badge ${e.data.outcome === 'solved' ? 'badge-yes' : ''}`}>{t(`report.outcome.${e.data.outcome}` as 'report.outcome.solved')}</span>
      </div>
      <p className="story story-lg">{e.data.bottom ?? game.puzzle.bottom}</p>
    </div>
  )
}

export const Timeline = memo(function Timeline({ game, godView, onOverride, onRetry }: Ctx & { onRetry: () => void }) {
  const { t } = useI18n()
  const name = useNames(game)
  const replies = new Map<number, GameEvent>()
  for (const e of game.events) if (e.type === 'answer' || e.type === 'judgement') replies.set(e.data.reply_to, e)
  const ctx: Ctx = { game, godView, onOverride }
  const lastError = [...game.events].reverse().find((e) => e.type === 'error')

  return (
    <div className="timeline">
      {game.events.map((e, i) => {
        // A question or guess right after the same player's chat line shares its header.
        let prev = i - 1
        while (prev >= 0 && (game.events[prev].type === 'answer' || game.events[prev].type === 'judgement')) prev--
        const compact = prev >= 0 && game.events[prev].type === 'discussion' && game.events[prev].actor === e.actor
        switch (e.type) {
          case 'opening':
            return <Opening key={e.seq} e={e} />
          case 'question':
            return <Question key={e.seq} e={e} answer={replies.get(e.seq)} ctx={ctx} compact={compact} />
          case 'guess':
            return <Guess key={e.seq} e={e} judgement={replies.get(e.seq)} ctx={ctx} compact={compact} />
          case 'discussion':
            return (
              <Beat key={e.seq} game={game} actor={e.actor} kind="say" id={`ev-${e.seq}`}>
                <div className="bubble bubble-say">
                  <p>
                    <Typewriter text={e.data.text} live={e.live} />
                  </p>
                </div>
              </Beat>
            )
          case 'hint': {
            const src =
              e.data.source === 'auto'
                ? t('game.hint.auto')
                : e.data.source === 'spectator'
                  ? t('game.hint.spectator')
                  : t('game.hint.requested', { name: name(e.data.requested_by) })
            return (
              <div key={e.seq} className="hint" id={`ev-${e.seq}`}>
                <Lightbulb />
                <div>
                  <div className="hint-label">
                    {t('game.hintLabel', { n: e.data.n })} · {src}
                  </div>
                  <p>
                    <Typewriter text={e.data.text} live={e.live} />
                  </p>
                </div>
              </div>
            )
          }
          case 'system':
            return (
              <div key={e.seq} className="sys">
                {t(`sys.${e.data.code}` as 'sys.pass', { name: name(e.data.actor) })}
              </div>
            )
          case 'error':
            return (
              <div key={e.seq} className="sys sys-error">
                <AlertTriangle />
                <span>{e.data.message}</span>
                {e === lastError && game.state.status === 'active' && game.state.error && (
                  <button className="btn btn-sm" onClick={onRetry}>
                    <RotateCw />
                    {t('game.retry')}
                  </button>
                )}
              </div>
            )
          case 'reveal':
            return <Reveal key={e.seq} e={e} game={game} />
          default:
            return null
        }
      })}
    </div>
  )
})
