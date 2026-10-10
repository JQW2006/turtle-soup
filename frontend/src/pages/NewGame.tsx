import { useEffect, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Bot, Loader2, Play, Plus, User, X } from 'lucide-react'
import { api } from '../lib/api'
import type { Effort, Lang, PlayerConfig, Puzzle, Rules } from '../lib/types'
import { useI18n } from '../lib/i18n'
import { useToast } from '../components/toast'
import { Avatar, Difficulty, NumberField, Seg, Switch } from '../components/ui'

const COLORS = ['#2563eb', '#d97706', '#059669', '#db2777']
const PERSONAS = ['logic', 'intuition', 'detail', 'skeptic', 'custom'] as const
const NAMES: Record<Lang, string[]> = {
  zh: ['阿澈', '小满', '老周', '西西'],
  en: ['Alex', 'Mia', 'Sam', 'Ivy'],
}

export interface SetupState {
  host: { kind: 'ai' | 'human'; effort: Effort }
  players: PlayerConfig[]
  rules: Rules
  delay: number
  start_paused: boolean
  language: Lang
}

const DEFAULT_RULES: Rules = {
  max_questions: 60,
  max_guesses: 3,
  max_hints: 3,
  auto_hint_after: 8,
  allow_hint_requests: true,
  allow_discussion: true,
  final_round: true,
  extra_rules: '',
}

function aiPlayer(i: number, lang: Lang, used: string[]): PlayerConfig {
  const name = NAMES[lang].find((n) => !used.includes(n)) ?? `${lang === 'zh' ? '玩家' : 'Player'} ${i + 1}`
  return { id: '', name, kind: 'ai', persona: PERSONAS[i % 4], custom_persona: '', effort: 'off', color: COLORS[i % 4] }
}

function defaults(lang: Lang): SetupState {
  return {
    host: { kind: 'ai', effort: 'high' },
    players: [aiPlayer(0, lang, []), aiPlayer(1, lang, [NAMES[lang][0]])],
    rules: DEFAULT_RULES,
    delay: 1.5,
    start_paused: false,
    language: lang,
  }
}

function loadSaved(): Partial<SetupState> | null {
  try {
    return JSON.parse(localStorage.getItem('soup.setup') || 'null')
  } catch {
    return null
  }
}

export default function NewGame() {
  const { puzzleId } = useParams()
  const { t } = useI18n()
  const toast = useToast()
  const nav = useNavigate()
  const loc = useLocation()
  const [puzzle, setPuzzle] = useState<Puzzle | null>(null)
  const [s, setS] = useState<SetupState | null>(null)
  const [starting, setStarting] = useState(false)

  useEffect(() => {
    api
      .puzzle(puzzleId!)
      .then((p) => {
        setPuzzle(p)
        const fromState = (loc.state as { setup?: SetupState } | null)?.setup
        const saved = loadSaved()
        const base = defaults(p.language)
        const merged: SetupState = fromState ?? {
          ...base,
          ...(saved ? { host: saved.host ?? base.host, rules: { ...DEFAULT_RULES, ...saved.rules }, delay: saved.delay ?? base.delay } : {}),
          players: saved?.players?.length ? saved.players : base.players,
        }
        merged.language = p.language
        // Keep names in the puzzle's language when they are untouched defaults.
        const other = p.language === 'zh' ? NAMES.en : NAMES.zh
        merged.players = merged.players.map((pl, i) => (other.includes(pl.name) ? { ...pl, name: NAMES[p.language][i] } : pl))
        setS(merged)
      })
      .catch((e) => toast.error(e))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [puzzleId])

  if (!puzzle || !s)
    return (
      <div className="page page-narrow">
        <div className="skeleton" style={{ height: 120, marginBottom: 16 }} />
        <div className="skeleton" style={{ height: 360 }} />
      </div>
    )

  const setRules = (patch: Partial<Rules>) => setS({ ...s, rules: { ...s.rules, ...patch } })
  const setPlayer = (i: number, patch: Partial<PlayerConfig>) => setS({ ...s, players: s.players.map((p, j) => (j === i ? { ...p, ...patch } : p)) })
  const hasHuman = s.players.some((p) => p.kind === 'human')
  const hostHuman = s.host.kind === 'human'
  const noAi = hostHuman && s.players.every((p) => p.kind === 'human')

  const addPlayer = (kind: 'ai' | 'human') => {
    if (s.players.length >= 4) return
    const i = s.players.length
    const p =
      kind === 'ai'
        ? aiPlayer(i, s.language, s.players.map((x) => x.name))
        : { ...aiPlayer(i, s.language, []), kind: 'human' as const, name: t('setup.me'), persona: 'logic' }
    p.color = COLORS.find((c) => !s.players.some((x) => x.color === c)) ?? COLORS[i % 4]
    setS({ ...s, players: [...s.players, p] })
  }

  const start = async () => {
    setStarting(true)
    try {
      const body = { puzzle_id: puzzle.id, ...s, players: s.players.map((p) => ({ ...p, name: p.name.trim() || '?' })) }
      try {
        localStorage.setItem('soup.setup', JSON.stringify({ host: s.host, players: s.players, rules: s.rules, delay: s.delay }))
      } catch {
        /* ignore */
      }
      const r = await api.createGame(body)
      nav(`/games/${r.id}`)
    } catch (e) {
      toast.error(e)
      setStarting(false)
    }
  }

  const effortOptions = (['off', 'low', 'high', 'max'] as Effort[]).map((e) => ({ value: e, label: t(`effort.${e}`) }))

  return (
    <div className="page page-narrow">
      <div className="page-head">
        <div className="row">
          <button className="btn btn-ghost btn-icon" onClick={() => nav(-1)} aria-label={t('common.back')}>
            <ArrowLeft />
          </button>
          <h1>{t('setup.title')}</h1>
        </div>
      </div>

      <div className="setup-puzzle card card-pad">
        <div className="row">
          <h2>{puzzle.title}</h2>
          <span className="spacer" />
          <span className={`badge ${puzzle.color === 'red' ? 'badge-no' : ''}`}>{t(`color.${puzzle.color}`)}</span>
          <span className="badge">{t(`genre.${puzzle.genre}`)}</span>
          <Difficulty value={puzzle.difficulty} />
        </div>
        <p className="story">{puzzle.surface}</p>
      </div>

      <div className="stack setup">
        <section className="section">
          <div className="section-head">
            <h2>{t('setup.host')}</h2>
          </div>
          <div className="section-body stack">
            <div className="row row-wrap">
              <Seg
                value={s.host.kind}
                onChange={(kind) =>
                  setS({
                    ...s,
                    host: { ...s.host, kind },
                    players: kind === 'human' ? s.players.filter((p) => p.kind !== 'human') : s.players,
                  })
                }
                options={[
                  { value: 'ai', label: t('setup.hostAi') },
                  { value: 'human', label: t('setup.hostHuman') },
                ]}
              />
              {!hostHuman && (
                <>
                  <span className="spacer" />
                  <span className="label">{t('setup.effort')}</span>
                  <select className="select select-auto" value={s.host.effort} onChange={(e) => setS({ ...s, host: { ...s.host, effort: e.target.value as Effort } })}>
                    {effortOptions.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </>
              )}
            </div>
            {hostHuman && <p className="small muted">{t('setup.hostHumanHelp')}</p>}
          </div>
        </section>

        <section className="section">
          <div className="section-head">
            <div>
              <h2>{t('setup.players')}</h2>
              <p>{t('setup.playersHelp')}</p>
            </div>
            <span className="spacer" />
            <button className="btn btn-sm" disabled={s.players.length >= 4 || hasHuman || hostHuman} onClick={() => addPlayer('human')} title={hostHuman ? t('setup.hostIsHuman') : hasHuman ? t('setup.oneHuman') : ''}>
              <User />
              {t('setup.addMe')}
            </button>
            <button className="btn btn-sm" disabled={s.players.length >= 4} onClick={() => addPlayer('ai')}>
              <Plus />
              {t('setup.addPlayer')}
            </button>
          </div>
          <div className="players-edit">
            {s.players.map((p, i) => (
              <div key={i} className="player-row">
                <Avatar name={p.name || '?'} index={i} size={52} />
                <div className="player-fields">
                  <div className="row row-wrap">
                    <input className="input input-name" value={p.name} maxLength={24} onChange={(e) => setPlayer(i, { name: e.target.value })} />
                    <span className={`badge ${p.kind === 'human' ? 'badge-accent' : ''}`}>
                      {p.kind === 'human' ? <User /> : <Bot />}
                      {p.kind === 'human' ? t('setup.kindHuman') : t('setup.kindAi')}
                    </span>
                    {p.kind === 'ai' && (
                      <>
                        <span className="spacer" />
                        <select className="select select-auto" value={p.persona} onChange={(e) => setPlayer(i, { persona: e.target.value })} aria-label={t('setup.persona')}>
                          {PERSONAS.map((x) => (
                            <option key={x} value={x}>
                              {t(`persona.${x}`)}
                            </option>
                          ))}
                        </select>
                        <select className="select select-auto" value={p.effort} onChange={(e) => setPlayer(i, { effort: e.target.value as Effort })} aria-label={t('setup.effort')}>
                          {effortOptions.map((o) => (
                            <option key={o.value} value={o.value}>
                              {t('setup.effort')} · {o.label}
                            </option>
                          ))}
                        </select>
                      </>
                    )}
                  </div>
                  {p.kind === 'ai' && p.persona !== 'custom' && <p className="small faint">{t(`persona.${p.persona}.d` as 'persona.logic.d')}</p>}
                  {p.kind === 'ai' && p.persona === 'custom' && (
                    <input className="input" value={p.custom_persona} placeholder={t('setup.customPersonaPh')} onChange={(e) => setPlayer(i, { custom_persona: e.target.value })} />
                  )}
                </div>
                <button className="btn btn-ghost btn-icon btn-sm" disabled={s.players.length <= 1} onClick={() => setS({ ...s, players: s.players.filter((_, j) => j !== i) })} aria-label={t('common.delete')}>
                  <X />
                </button>
              </div>
            ))}
          </div>
        </section>

        <section className="section">
          <div className="section-head">
            <h2>{t('setup.rules')}</h2>
          </div>
          <div className="section-body stack">
            <div className="grid-4">
              <div className="field">
                <label>{t('setup.maxQuestions')}</label>
                <NumberField value={s.rules.max_questions} max={500} onChange={(v) => setRules({ max_questions: v })} />
              </div>
              <div className="field">
                <label>{t('setup.maxGuesses')}</label>
                <NumberField value={s.rules.max_guesses} max={50} onChange={(v) => setRules({ max_guesses: v })} />
              </div>
              <div className="field">
                <label>{t('setup.maxHints')}</label>
                <NumberField value={s.rules.max_hints} max={20} onChange={(v) => setRules({ max_hints: v })} />
              </div>
              <div className="field">
                <label>{t('setup.autoHint')}</label>
                <NumberField value={s.rules.auto_hint_after} max={100} onChange={(v) => setRules({ auto_hint_after: v })} />
              </div>
            </div>
            <p className="small faint">
              {t('setup.zeroUnlimited')} · {t('setup.autoHintHelp')}
            </p>
            <div className="stack switches">
              <Switch checked={s.rules.allow_discussion} onChange={(v) => setRules({ allow_discussion: v })} label={t('setup.allowDiscussion')} />
              <Switch checked={s.rules.allow_hint_requests} onChange={(v) => setRules({ allow_hint_requests: v })} label={t('setup.allowHintReq')} />
              <Switch checked={s.rules.final_round} onChange={(v) => setRules({ final_round: v })} label={t('setup.finalRound')} />
            </div>
            <div className="field">
              <label>{t('setup.extraRules')}</label>
              <textarea className="textarea" rows={2} value={s.rules.extra_rules} onChange={(e) => setRules({ extra_rules: e.target.value })} />
              <span className="help">{t('setup.extraRulesHelp')}</span>
            </div>
          </div>
        </section>

        <section className="section">
          <div className="section-head">
            <h2>{t('setup.pace')}</h2>
          </div>
          <div className="section-body row row-wrap">
            <span className="label">{t('setup.delay')}</span>
            <Seg
              value={s.delay}
              onChange={(delay) => setS({ ...s, delay })}
              options={[
                { value: 0, label: `${t('speed.fast')} · 0s` },
                { value: 1.5, label: `${t('speed.normal')} · 1.5s` },
                { value: 4, label: `${t('speed.slow')} · 4s` },
              ]}
            />
            <span className="spacer" />
            <Switch checked={s.start_paused} onChange={(v) => setS({ ...s, start_paused: v })} label={t('setup.startPaused')} />
          </div>
        </section>
      </div>

      <div className="setup-foot">
        {noAi && <span className="small" style={{ color: 'var(--no)' }}>{t('setup.needAi')}</span>}
        <span className="spacer" />
        <button className="btn btn-primary btn-lg" disabled={starting || noAi} onClick={start}>
          {starting ? <Loader2 className="spin" /> : <Play />}
          {t('setup.start')}
        </button>
      </div>
    </div>
  )
}
