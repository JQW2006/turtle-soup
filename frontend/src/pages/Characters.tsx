import { useEffect, useState } from 'react'
import { Copy, Lock, MoreHorizontal, Pencil, Plus, Trash2, Users } from 'lucide-react'
import { Portrait } from '../components/ink'
import { CharacterModal } from '../components/CharacterModal'
import { Confirm, Menu } from '../components/ui'
import { api } from '../lib/api'
import { useI18n } from '../lib/i18n'
import { useToast } from '../components/toast'
import { localized, portraitIndex, type AppSettings, type Character } from '../lib/types'

export default function Characters() {
  const { t, lang } = useI18n()
  const toast = useToast()
  const [items, setItems] = useState<Character[] | null>(null)
  const [cfg, setCfg] = useState<AppSettings | null>(null)
  // editing: Character = view/edit it · null = create a new one · undefined = closed
  const [editing, setEditing] = useState<Character | null | undefined>(undefined)
  const [menuDeleting, setMenuDeleting] = useState<Character | null>(null)

  useEffect(() => {
    api.characters().then(setItems).catch(toast.error)
    api.settings().then(setCfg).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const modelLabel = (id: string) => {
    if (!id) return cfg ? `${t('characters.model')}: ${t('characters.modelDefault')}` : ''
    const p = cfg?.profiles.find((x) => x.id === id)
    return p ? p.label : id
  }

  const upsert = (c: Character) =>
    setItems((xs) => (xs?.some((x) => x.id === c.id) ? xs.map((x) => (x.id === c.id ? c : x)) : [...(xs ?? []), c]))

  const duplicate = async (c: Character) => {
    try {
      const copy = await api.duplicateCharacter(c.id)
      upsert(copy)
      setEditing(copy) // open the copy right away for editing
    } catch (e) {
      toast.error(e)
    }
  }

  const card = (c: Character) => {
    const prompt = localized(c.prompt, lang)
    return (
      <article key={c.id} className="puzzle-card char-card" onClick={() => setEditing(c)}>
        <Portrait index={portraitIndex(c.portrait)} size={64} title={localized(c.name, lang)} />
        <div className="char-main">
          <div className="char-head">
            <h3>{localized(c.name, lang)}</h3>
            <span className="spacer" />
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
                    <button
                      onClick={() => {
                        close()
                        setEditing(c)
                      }}
                    >
                      <Pencil />
                      {t('common.edit')}
                    </button>
                    <button
                      onClick={() => {
                        close()
                        duplicate(c)
                      }}
                    >
                      <Copy />
                      {c.builtin ? t('characters.duplicateBuiltin') : t('common.duplicate')}
                    </button>
                    {!c.builtin && (
                      <button
                        className="danger"
                        onClick={() => {
                          close()
                          setMenuDeleting(c)
                        }}
                      >
                        <Trash2 />
                        {t('common.delete')}
                      </button>
                    )}
                  </>
                )}
              </Menu>
            </div>
          </div>
          {c.intro && <p className="char-intro">{localized(c.intro, lang)}</p>}
          {prompt && <p className="char-prompt">{prompt}</p>}
          <div className="char-foot">
            {c.builtin ? (
              <span className="badge badge-outline" title={t('characters.builtinBadge')}>
                <Lock size={11} />
                {t('characters.builtin')}
              </span>
            ) : (
              <span className="badge">{t('characters.custom')}</span>
            )}
            <span className="badge">{modelLabel(c.model_id)}</span>
          </div>
        </div>
      </article>
    )
  }

  const hosts = (items ?? []).filter((c) => c.kind === 'host')
  const players = (items ?? []).filter((c) => c.kind === 'player')
  const customCount = (items ?? []).filter((c) => !c.builtin).length

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>{t('characters.title')}</h1>
          <p className="faint">{t('characters.subtitle')}</p>
        </div>
        <div className="btns">
          <button className="btn btn-primary" onClick={() => setEditing(null)}>
            <Plus />
            {t('characters.new')}
          </button>
        </div>
      </div>

      {items === null ? (
        <div className="puzzle-grid">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="skeleton" style={{ height: 140 }} />
          ))}
        </div>
      ) : (
        <>
          <h2 className="char-section-title">
            {t('characters.hosts')}
            <span className="faint small">{hosts.length}</span>
          </h2>
          <div className="puzzle-grid">{hosts.map(card)}</div>

          <h2 className="char-section-title">
            {t('characters.players')}
            <span className="faint small">{players.length}</span>
          </h2>
          <div className="puzzle-grid">{players.map(card)}</div>

          {customCount === 0 && (
            <div className="empty">
              <Users />
              {t('characters.emptyCustom')}
            </div>
          )}
        </>
      )}

      {editing !== undefined && (
        <CharacterModal
          key={editing?.id ?? 'new'}
          character={editing}
          onClose={() => setEditing(undefined)}
          onSaved={(c) => {
            upsert(c)
            setEditing(undefined)
          }}
          onDeleted={(id) => {
            setItems((xs) => xs?.filter((x) => x.id !== id) ?? null)
            setEditing(undefined)
          }}
          onDuplicated={(copy) => {
            upsert(copy)
            setEditing(copy)
          }}
        />
      )}

      {menuDeleting && (
        <Confirm
          danger
          title={t('common.delete')}
          body={t('characters.deleteConfirm', { name: localized(menuDeleting.name, lang) })}
          confirmLabel={t('common.delete')}
          onClose={() => setMenuDeleting(null)}
          onConfirm={async () => {
            try {
              await api.deleteCharacter(menuDeleting.id)
              setItems((xs) => xs?.filter((x) => x.id !== menuDeleting.id) ?? null)
            } catch (e) {
              toast.error(e)
            }
          }}
        />
      )}
    </div>
  )
}
