import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Copy, Download, FileUp, MoreHorizontal, Pencil, Play, Plus, Search, Trash2, Inbox } from 'lucide-react'
import { api } from '../lib/api'
import type { Puzzle } from '../lib/types'
import { useI18n } from '../lib/i18n'
import { useToast } from '../components/toast'
import { Confirm, Difficulty, Menu, Seg } from '../components/ui'

type Filter = { q: string; language: string; color: string; genre: string; source: string }

function loadFilter(): Filter {
  const base = { q: '', language: '', color: '', genre: '', source: '' }
  try {
    return { ...base, ...JSON.parse(sessionStorage.getItem('soup.libfilter') || '{}'), q: '' }
  } catch {
    return base
  }
}

export default function Library() {
  const { t, lang } = useI18n()
  const toast = useToast()
  const nav = useNavigate()
  const [items, setItems] = useState<Puzzle[] | null>(null)
  const [filter, setFilter] = useState<Filter>(loadFilter)
  const [deleting, setDeleting] = useState<Puzzle | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const load = () =>
    api
      .puzzles()
      .then(setItems)
      .catch((e) => {
        toast.error(e)
        setItems([])
      })

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    try {
      sessionStorage.setItem('soup.libfilter', JSON.stringify(filter))
    } catch {
      /* ignore */
    }
  }, [filter])

  const shown = useMemo(() => {
    if (!items) return []
    const q = filter.q.trim().toLowerCase()
    const list = items.filter(
      (p) =>
        (!filter.language || p.language === filter.language) &&
        (!filter.color || p.color === filter.color) &&
        (!filter.genre || p.genre === filter.genre) &&
        (!filter.source || p.source === filter.source) &&
        (!q || p.title.toLowerCase().includes(q) || p.surface.toLowerCase().includes(q) || p.tags.some((x) => x.toLowerCase().includes(q))),
    )
    // Puzzles in the interface language first; the server already orders user puzzles before built-ins.
    return [...list].sort((a, b) => Number(b.language === lang) - Number(a.language === lang))
  }, [items, filter, lang])

  const set = (k: keyof Filter) => (v: string) => setFilter((f) => ({ ...f, [k]: v }))

  const onImport = async (file: File) => {
    try {
      const json = JSON.parse(await file.text())
      const r = await api.importPuzzles(json)
      toast.ok(t('library.imported', { n: r.created }) + (r.errors.length ? t('library.importErrors', { n: r.errors.length }) : ''))
      load()
    } catch (e) {
      if (e instanceof SyntaxError) toast.error(t('library.importFail'))
      else toast.error(e)
    }
  }

  const duplicate = async (p: Puzzle) => {
    try {
      const c = await api.duplicatePuzzle(p.id)
      nav(`/puzzles/${c.id}`)
    } catch (e) {
      toast.error(e)
    }
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>{t('library.title')}</h1>
          <p>{t('library.subtitle', { n: items?.length ?? 0 })}</p>
        </div>
        <div className="row">
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) onImport(f)
              e.target.value = ''
            }}
          />
          <button className="btn" onClick={() => fileRef.current?.click()}>
            <FileUp />
            {t('common.import')}
          </button>
          <button className="btn" onClick={() => api.exportPuzzles().catch(toast.error)} title={t('library.exportAll')}>
            <Download />
            {t('common.export')}
          </button>
          <Link to="/puzzles/new" className="btn btn-primary">
            <Plus />
            {t('library.new')}
          </Link>
        </div>
      </div>

      <div className="filters">
        <div className="search">
          <Search />
          <input className="input" value={filter.q} placeholder={t('library.search')} onChange={(e) => set('q')(e.target.value)} />
        </div>
        <Seg
          value={filter.language}
          onChange={set('language')}
          options={[
            { value: '', label: t('library.all') },
            { value: 'zh', label: t('lang.zh') },
            { value: 'en', label: t('lang.en') },
          ]}
        />
        <Seg
          value={filter.color}
          onChange={set('color')}
          options={[
            { value: '', label: t('library.all') },
            { value: 'clear', label: t('color.clear') },
            { value: 'red', label: t('color.red') },
          ]}
        />
        <Seg
          value={filter.genre}
          onChange={set('genre')}
          options={[
            { value: '', label: t('library.all') },
            { value: 'honkaku', label: t('genre.honkaku') },
            { value: 'henkaku', label: t('genre.henkaku') },
          ]}
        />
        <Seg
          value={filter.source}
          onChange={set('source')}
          options={[
            { value: '', label: t('library.all') },
            { value: 'builtin', label: t('source.builtin') },
            { value: 'user', label: t('source.user') },
          ]}
        />
      </div>

      {items === null ? (
        <div className="puzzle-grid">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="skeleton" style={{ height: 176 }} />
          ))}
        </div>
      ) : shown.length === 0 ? (
        <div className="empty">
          <Inbox />
          {t('library.empty')}
        </div>
      ) : (
        <div className="puzzle-grid">
          {shown.map((p) => (
            <article key={p.id} className="puzzle-card" onClick={() => nav(`/puzzles/${p.id}`)}>
              <div className="puzzle-card-head">
                <h3>{p.title}</h3>
                <div onClick={(e) => e.stopPropagation()}>
                  <Menu
                    trigger={(toggle) => (
                      <button className="btn btn-ghost btn-icon btn-sm" onClick={toggle} aria-label={t('common.more')}>
                        <MoreHorizontal />
                      </button>
                    )}
                  >
                    {(close) => (
                      <>
                        <button onClick={() => nav(`/puzzles/${p.id}`)}>
                          <Pencil />
                          {t('common.edit')}
                        </button>
                        <button
                          onClick={() => {
                            close()
                            duplicate(p)
                          }}
                        >
                          <Copy />
                          {t('common.duplicate')}
                        </button>
                        <button
                          onClick={() => {
                            close()
                            api.exportPuzzles([p.id]).catch(toast.error)
                          }}
                        >
                          <Download />
                          {t('common.export')}
                        </button>
                        <button
                          className="danger"
                          onClick={() => {
                            close()
                            setDeleting(p)
                          }}
                        >
                          <Trash2 />
                          {t('common.delete')}
                        </button>
                      </>
                    )}
                  </Menu>
                </div>
              </div>
              <p className="puzzle-card-surface">{p.surface}</p>
              <div className="puzzle-card-foot">
                <span className={`badge ${p.color === 'red' ? 'badge-no' : ''}`}>{t(`color.${p.color}`)}</span>
                <span className="badge">{t(`genre.${p.genre}`)}</span>
                {p.language === 'en' && <span className="badge badge-outline">EN</span>}
                <Difficulty value={p.difficulty} />
                <span className="spacer" />
                {p.play_count > 0 && <span className="faint small hide-sm">{t('library.played', { n: p.play_count })}</span>}
                <button
                  className="btn btn-sm puzzle-play"
                  onClick={(e) => {
                    e.stopPropagation()
                    nav(`/play/${p.id}`)
                  }}
                >
                  <Play />
                  {t('library.play')}
                </button>
              </div>
            </article>
          ))}
        </div>
      )}

      {deleting && (
        <Confirm
          danger
          title={t('library.deleteTitle')}
          body={t('library.deleteBody', { title: deleting.title })}
          confirmLabel={t('common.delete')}
          onClose={() => setDeleting(null)}
          onConfirm={async () => {
            try {
              await api.deletePuzzle(deleting.id)
              setItems((xs) => xs?.filter((x) => x.id !== deleting.id) ?? null)
              toast.ok(t('library.deleted'))
            } catch (e) {
              toast.error(e)
            }
          }}
        />
      )}
    </div>
  )
}
