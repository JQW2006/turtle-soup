import { useEffect, useMemo, useState } from 'react'
import { Copy, Lock, Save, Trash2, X } from 'lucide-react'
import { Portrait } from './ink'
import { Confirm, Modal, Seg } from './ui'
import { api } from '../lib/api'
import { useI18n } from '../lib/i18n'
import { useToast } from './toast'
import { localized, portraitIndex, type AppSettings, type Character, type CharacterInput } from '../lib/types'

const EMPTY: CharacterInput = { kind: 'player', name: '', intro: '', prompt: '', portrait: '0', color: '', model_id: '' }
const PORTRAITS = ['0', '1', '2', '3', '4', '5', '6', '7', 'detective']
const COLORS = ['', '#2563eb', '#d97706', '#059669', '#db2777', '#7c3aed']

/**
 * View/edit one character in a modal. Built-in characters are read-only except
 * for the model preference; pass null to create a new custom character.
 */
export function CharacterModal({
  character,
  onClose,
  onSaved,
  onDeleted,
  onDuplicated,
}: {
  character: Character | null // null = create a new one
  onClose: () => void
  onSaved: (c: Character) => void // upsert into the list, close
  onDeleted: (id: string) => void
  onDuplicated?: (copy: Character) => void // builtin "duplicate" — stay open on the copy
}) {
  const { t, lang } = useI18n()
  const toast = useToast()
  const [form, setForm] = useState<CharacterInput>(character ?? EMPTY)
  const builtin = character?.builtin ?? false
  const [cfg, setCfg] = useState<AppSettings | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [saving, setSaving] = useState(false)

  const set = <K extends keyof CharacterInput>(k: K, v: CharacterInput[K]) => setForm((f) => ({ ...f, [k]: v }))

  useEffect(() => {
    api.settings().then(setCfg).catch(() => {})
  }, [])

  const defaultLabel = useMemo(() => {
    const p = cfg?.profiles.find((x) => x.id === cfg?.default_profile)
    return p ? `${t('characters.modelDefault')}（${p.label}）` : t('characters.modelDefault')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg, lang])

  const save = async () => {
    setSaving(true)
    try {
      const c = builtin
        ? await api.setCharacterModel(character!.id, form.model_id)
        : character
          ? await api.updateCharacter(character.id, form)
          : await api.createCharacter(form)
      onSaved(c)
      toast.ok(t('common.saved'))
    } catch (e) {
      toast.error(e)
      setSaving(false)
    }
  }

  const duplicate = async () => {
    try {
      const copy = await api.duplicateCharacter(character!.id)
      if (onDuplicated) {
        onDuplicated(copy) // open the copy for editing, in place of this builtin
      } else {
        onSaved(copy)
      }
      toast.ok(t('characters.duplicateBuiltin'))
    } catch (e) {
      toast.error(e)
    }
  }

  const title = builtin || character ? localized(form.name, lang) || t('characters.title') : t('characters.new')

  return (
    <Modal onClose={onClose} width={620}>
      <div className="modal-head char-modal-head">
        <Portrait index={portraitIndex(form.portrait)} size={56} title={title} />
        <div className="char-modal-title">
          <h2>{title}</h2>
          {builtin ? (
            <span className="badge badge-outline">
              <Lock size={11} />
              {t('characters.builtinBadge')}
            </span>
          ) : (
            <span className="badge">
              {t('characters.custom')} · {form.kind === 'host' ? t('characters.host') : t('characters.player')}
            </span>
          )}
        </div>
        <span className="spacer" />
        <button className="btn btn-ghost btn-icon" onClick={onClose} aria-label={t('common.close')}>
          <X />
        </button>
      </div>

      <div className="modal-body stack">
        {!builtin && !character && (
          <div className="field">
            <label>{t('characters.kind')}</label>
            <Seg
              value={form.kind}
              onChange={(v) => set('kind', v)}
              options={[
                { value: 'player', label: t('characters.player') },
                { value: 'host', label: t('characters.host') },
              ]}
            />
          </div>
        )}

        {builtin ? (
          <>
            {form.intro && (
              <div className="field">
                <label>{t('characters.intro')}</label>
                <p className="char-readonly">{localized(form.intro, lang)}</p>
              </div>
            )}
            <div className="field">
              <label>{t('characters.prompt')}</label>
              <p className="char-readonly char-readonly-prompt">{localized(form.prompt, lang) || '—'}</p>
            </div>
          </>
        ) : (
          <>
            <div className="field">
              <label htmlFor="c-name">{t('characters.name')}</label>
              <input id="c-name" className="input" maxLength={64} value={form.name} placeholder={t('characters.namePh')} onChange={(e) => set('name', e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="c-intro">{t('characters.intro')}</label>
              <input id="c-intro" className="input" maxLength={500} value={form.intro} placeholder={t('characters.introPh')} onChange={(e) => set('intro', e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="c-prompt">{t('characters.prompt')}</label>
              <span className="help">{form.kind === 'host' ? t('characters.promptHostHelp') : t('characters.promptPlayerHelp')}</span>
              <textarea
                id="c-prompt"
                className="textarea char-prompt-input"
                rows={7}
                maxLength={4000}
                value={form.prompt}
                placeholder={form.kind === 'host' ? '例：语气严厉的侦探长，回答极简，喜欢用「嗯」表示肯定。' : '例：总是先怀疑女性角色；喜欢用「如果…会怎样」的假设句式提问。'}
                onChange={(e) => set('prompt', e.target.value)}
              />
            </div>
            <div className="field">
              <label>{t('characters.portrait')}</label>
              <div className="portrait-picker">
                {PORTRAITS.map((p) => (
                  <button key={p} type="button" className={`portrait-cell ${form.portrait === p ? 'active' : ''}`} onClick={() => set('portrait', p)} title={p === 'detective' ? t('characters.host') : p}>
                    <Portrait index={p === 'detective' ? 'host' : Number(p)} size={48} />
                  </button>
                ))}
              </div>
            </div>
            {!character && (
              <div className="field">
                <label>{t('characters.color')}</label>
                <span className="portrait-picker">
                  {COLORS.map((c) => (
                    <button
                      key={c || 'none'}
                      type="button"
                      className={`portrait-cell ${form.color === c ? 'active' : ''}`}
                      onClick={() => set('color', c)}
                      title={c || t('common.none')}
                      style={{ width: 48, height: 48, borderRadius: 12 }}
                    >
                      <span style={{ display: 'block', width: 26, height: 26, borderRadius: 999, background: c || 'transparent', border: c ? 'none' : '2px dashed var(--border)' }} />
                    </button>
                  ))}
                </span>
              </div>
            )}
          </>
        )}

        <div className="field">
          <label htmlFor="c-model">{t('characters.model')}</label>
          <select id="c-model" className="select" value={form.model_id} onChange={(e) => set('model_id', e.target.value)}>
            <option value="">{defaultLabel}</option>
            {(cfg?.profiles ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.label} · {p.model}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="modal-foot">
        {builtin ? (
          <button className="btn" onClick={duplicate}>
            <Copy />
            {t('characters.duplicateBuiltin')}
          </button>
        ) : (
          character && (
            <button className="btn btn-danger" onClick={() => setDeleting(true)}>
              <Trash2 />
              {t('common.delete')}
            </button>
          )
        )}
        <span className="spacer" />
        <button className="btn btn-primary" disabled={saving || (!builtin && !form.name.trim())} onClick={save}>
          <Save />
          {t('common.save')}
        </button>
      </div>

      {deleting && (
        <Confirm
          danger
          title={t('common.delete')}
          body={t('characters.deleteConfirm', { name: localized(form.name, lang) })}
          confirmLabel={t('common.delete')}
          onClose={() => setDeleting(false)}
          onConfirm={async () => {
            await api.deleteCharacter(character!.id)
            onDeleted(character!.id)
          }}
        />
      )}
    </Modal>
  )
}
