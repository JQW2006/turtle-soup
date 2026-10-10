import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Eye, Loader2, Plus, Sparkles, Trash2, Play, ShieldCheck, CircleAlert, TriangleAlert, Info } from 'lucide-react'
import { api } from '../lib/api'
import type { Point, Puzzle, PuzzleInput, PuzzleReview } from '../lib/types'
import { useI18n } from '../lib/i18n'
import { useToast } from '../components/toast'
import { Confirm, Difficulty, Seg } from '../components/ui'

const EMPTY: PuzzleInput = {
  title: '',
  surface: '',
  bottom: '',
  host_notes: '',
  points: [],
  tags: [],
  color: 'clear',
  genre: 'honkaku',
  difficulty: 3,
  language: 'zh',
}

function toInput(p: Puzzle): PuzzleInput {
  const { title, surface, bottom, host_notes, points, tags, color, genre, difficulty, language } = p
  return { title, surface, bottom, host_notes, points, tags, color, genre, difficulty, language }
}

let tmpId = 0
const newPointId = (points: Point[]) => {
  let id = ''
  do id = `k${points.length + 1 + tmpId++}`
  while (points.some((p) => p.id === id))
  return id
}

export default function PuzzleEditor() {
  const { id } = useParams()
  const isNew = !id
  const { t, lang } = useI18n()
  const toast = useToast()
  const nav = useNavigate()
  const [form, setForm] = useState<PuzzleInput>(() => ({ ...EMPTY, language: lang }))
  const [original, setOriginal] = useState<string>('')
  const [loading, setLoading] = useState(!isNew)
  const [revealed, setRevealed] = useState(isNew)
  const [saving, setSaving] = useState(false)
  const [extracting, setExtracting] = useState(false)
  const [reviewing, setReviewing] = useState(false)
  const [review, setReview] = useState<PuzzleReview | null>(null)
  const [confirmReplace, setConfirmReplace] = useState(false)
  const [tagText, setTagText] = useState('')

  useEffect(() => {
    if (!id) return
    setLoading(true)
    api
      .puzzle(id)
      .then((p) => {
        const f = toInput(p)
        setForm(f)
        setTagText(f.tags.join(', '))
        setOriginal(JSON.stringify(f))
      })
      .catch((e) => toast.error(e))
      .finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  const dirty = useMemo(() => (isNew ? !!(form.title || form.surface || form.bottom) : JSON.stringify(form) !== original), [form, original, isNew])

  useEffect(() => {
    if (!dirty) return
    const h = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [dirty])

  const set = <K extends keyof PuzzleInput>(k: K, v: PuzzleInput[K]) => setForm((f) => ({ ...f, [k]: v }))
  const setPoint = (i: number, patch: Partial<Point>) =>
    setForm((f) => ({ ...f, points: f.points.map((p, j) => (j === i ? { ...p, ...patch } : p)) }))

  const valid = form.title.trim() && form.surface.trim() && form.bottom.trim()

  const save = async (play = false) => {
    if (!valid) return
    setSaving(true)
    try {
      const body = { ...form, points: form.points.filter((p) => p.text.trim()) }
      const saved = isNew ? await api.createPuzzle(body) : await api.updatePuzzle(id!, body)
      const f = toInput(saved)
      setForm(f)
      setOriginal(JSON.stringify(f))
      if (play) nav(`/play/${saved.id}`)
      else if (isNew) {
        toast.ok(t('editor.created'))
        nav(`/puzzles/${saved.id}`, { replace: true })
      } else toast.ok(t('common.saved'))
    } catch (e) {
      toast.error(e)
    } finally {
      setSaving(false)
    }
  }

  const extract = async () => {
    setConfirmReplace(false)
    if (!form.bottom.trim()) return toast.error(t('editor.needBottom'))
    setExtracting(true)
    try {
      const r = await api.analyzePoints({ surface: form.surface, bottom: form.bottom, host_notes: form.host_notes, language: form.language })
      set('points', r.points)
    } catch (e) {
      toast.error(e)
    } finally {
      setExtracting(false)
    }
  }

  const runReview = async () => {
    if (!form.bottom.trim()) return toast.error(t('editor.needBottom'))
    setReviewing(true)
    try {
      setReview(await api.reviewPuzzle({ surface: form.surface, bottom: form.bottom, host_notes: form.host_notes, language: form.language }))
    } catch (e) {
      toast.error(e)
    } finally {
      setReviewing(false)
    }
  }

  if (loading)
    return (
      <div className="page page-editor">
        <div className="skeleton" style={{ height: 28, width: 200, marginBottom: 24 }} />
        <div className="skeleton" style={{ height: 420 }} />
      </div>
    )

  const LevelIcon = { error: CircleAlert, warn: TriangleAlert, info: Info }

  return (
    <div className="page page-editor">
      <div className="page-head">
        <div className="row">
          <button className="btn btn-ghost btn-icon" onClick={() => nav(-1)} aria-label={t('common.back')}>
            <ArrowLeft />
          </button>
          <h1>{isNew ? t('editor.newTitle') : form.title || t('editor.editTitle')}</h1>
          {dirty && !isNew && <span className="badge">{t('editor.unsaved')}</span>}
        </div>
        <div className="row">
          <button className="btn" disabled={!valid || saving || (!dirty && !isNew)} onClick={() => save(false)}>
            {saving && <Loader2 className="spin" />}
            {t('common.save')}
          </button>
          <button className="btn btn-primary" disabled={!valid || saving} onClick={() => (dirty || isNew ? save(true) : nav(`/play/${id}`))}>
            <Play />
            {dirty || isNew ? t('editor.saveAndPlay') : t('library.play')}
          </button>
        </div>
      </div>

      <div className="editor">
        <div className="editor-main">
          <div className="field">
            <label htmlFor="f-title">{t('editor.title')}</label>
            <input id="f-title" className="input input-title" value={form.title} maxLength={200} placeholder={t('editor.titlePh')} onChange={(e) => set('title', e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="f-surface">{t('editor.surface')}</label>
            <textarea
              id="f-surface"
              className="textarea textarea-story"
              rows={5}
              value={form.surface}
              placeholder={t('editor.surfacePh')}
              onChange={(e) => set('surface', e.target.value)}
            />
            <span className="help">{t('editor.surfaceHelp')}</span>
          </div>
          <div className="field">
            <label htmlFor="f-bottom">{t('editor.bottom')}</label>
            {revealed ? (
              <textarea
                id="f-bottom"
                className="textarea textarea-story"
                rows={7}
                value={form.bottom}
                placeholder={t('editor.bottomPh')}
                onChange={(e) => set('bottom', e.target.value)}
              />
            ) : (
              <button className="spoiler" onClick={() => setRevealed(true)}>
                <Eye />
                <span>{t('editor.spoiler')}</span>
                <span className="btn btn-sm">{t('editor.revealBottom')}</span>
              </button>
            )}
            <span className="help">{t('editor.bottomHelp')}</span>
          </div>
          {revealed && (
            <div className="field">
              <label htmlFor="f-notes">{t('editor.notes')}</label>
              <textarea id="f-notes" className="textarea" rows={3} value={form.host_notes} placeholder={t('editor.notesPh')} onChange={(e) => set('host_notes', e.target.value)} />
              <span className="help">{t('editor.notesHelp')}</span>
            </div>
          )}

          {revealed && (
            <section className="section">
              <div className="section-head">
                <div>
                  <h2>{t('editor.points')}</h2>
                  <p>{t('editor.pointsHelp')}</p>
                </div>
                <span className="spacer" />
                <button className="btn btn-sm" disabled={extracting} onClick={() => (form.points.length ? setConfirmReplace(true) : extract())}>
                  {extracting ? <Loader2 className="spin" /> : <Sparkles />}
                  {t('editor.aiPoints')}
                </button>
              </div>
              <div className="section-body points-edit">
                {form.points.length === 0 && <p className="faint small">{t('editor.pointsEmpty')}</p>}
                {form.points.map((p, i) => (
                  <div key={p.id} className="point-row">
                    <span className="point-idx mono">{i + 1}</span>
                    <input className="input" value={p.text} placeholder={t('editor.pointPh')} onChange={(e) => setPoint(i, { text: e.target.value })} />
                    <label className={`chip-toggle ${p.core ? 'on' : ''}`} title={t('editor.core')}>
                      <input type="checkbox" checked={p.core} onChange={(e) => setPoint(i, { core: e.target.checked })} />
                      {t('editor.core')}
                    </label>
                    <select className="select select-weight" value={p.weight} title={t('editor.weight')} onChange={(e) => setPoint(i, { weight: Number(e.target.value) })}>
                      {[1, 2, 3, 4, 5].map((w) => (
                        <option key={w} value={w}>
                          {t('editor.weight')} {w}
                        </option>
                      ))}
                    </select>
                    <button className="btn btn-ghost btn-icon btn-sm" onClick={() => set('points', form.points.filter((_, j) => j !== i))} aria-label={t('common.delete')}>
                      <Trash2 />
                    </button>
                  </div>
                ))}
                <div>
                  <button className="btn btn-ghost btn-sm" onClick={() => set('points', [...form.points, { id: newPointId(form.points), text: '', core: true, weight: 3 }])}>
                    <Plus />
                    {t('editor.addPoint')}
                  </button>
                </div>
              </div>
            </section>
          )}
        </div>

        <aside className="editor-side">
          <section className="section">
            <div className="section-head">
              <h2>{t('editor.meta')}</h2>
            </div>
            <div className="section-body stack">
              <div className="field">
                <span className="label">{t('editor.language')}</span>
                <Seg value={form.language} onChange={(v) => set('language', v)} options={[{ value: 'zh', label: t('lang.zh') }, { value: 'en', label: t('lang.en') }]} />
              </div>
              <div className="field">
                <span className="label">{t('editor.color')}</span>
                <Seg value={form.color} onChange={(v) => set('color', v)} options={[{ value: 'clear', label: t('color.clear') }, { value: 'red', label: t('color.red') }]} />
              </div>
              <div className="field">
                <span className="label">{t('editor.genre')}</span>
                <Seg value={form.genre} onChange={(v) => set('genre', v)} options={[{ value: 'honkaku', label: t('genre.honkaku') }, { value: 'henkaku', label: t('genre.henkaku') }]} />
              </div>
              <div className="field">
                <span className="label">{t('difficulty')}</span>
                <Difficulty value={form.difficulty} onChange={(v) => set('difficulty', v)} />
              </div>
              <div className="field">
                <label htmlFor="f-tags">{t('editor.tags')}</label>
                <input
                  id="f-tags"
                  className="input"
                  value={tagText}
                  placeholder={t('editor.tagsPh')}
                  onChange={(e) => {
                    setTagText(e.target.value)
                    set('tags', e.target.value.split(/[,，]/).map((x) => x.trim()).filter(Boolean).slice(0, 8))
                  }}
                />
              </div>
            </div>
          </section>

          {revealed && (
            <section className="section">
              <div className="section-head">
                <div>
                  <h2>{t('editor.review')}</h2>
                  <p>{t('editor.reviewHelp')}</p>
                </div>
              </div>
              <div className="section-body stack">
                <button className="btn" disabled={reviewing} onClick={runReview}>
                  {reviewing ? <Loader2 className="spin" /> : <ShieldCheck />}
                  {t('editor.runReview')}
                </button>
                {review && (
                  <div className="review stack">
                    <p className="review-verdict">{review.verdict}</p>
                    <ul className="issues">
                      {review.issues.map((it, i) => {
                        const Icon = LevelIcon[it.level]
                        return (
                          <li key={i} className={`issue issue-${it.level}`}>
                            <Icon />
                            <div>
                              <span className="issue-level">{t(`level.${it.level}`)}</span>
                              {it.text}
                            </div>
                          </li>
                        )
                      })}
                    </ul>
                    <p className="small faint">
                      {t('editor.suggested', {
                        title: review.title || form.title,
                        d: review.difficulty,
                        color: t(`color.${review.color}`),
                        genre: t(`genre.${review.genre}`),
                      })}
                    </p>
                    <button
                      className="btn btn-sm"
                      onClick={() =>
                        setForm((f) => ({
                          ...f,
                          title: f.title.trim() ? f.title : review.title || f.title,
                          difficulty: review.difficulty,
                          color: review.color,
                          genre: review.genre,
                        }))
                      }
                    >
                      {t('editor.applySuggest')}
                    </button>
                  </div>
                )}
              </div>
            </section>
          )}
        </aside>
      </div>

      {confirmReplace && <Confirm title={t('editor.aiPoints')} body={t('editor.aiPointsReplace')} onClose={() => setConfirmReplace(false)} onConfirm={extract} />}
    </div>
  )
}
