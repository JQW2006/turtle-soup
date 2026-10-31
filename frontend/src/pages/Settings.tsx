import { useEffect, useState } from 'react'
import { Loader2, PlugZap, Plus, Trash2 } from 'lucide-react'
import { api, getToken, setToken } from '../lib/api'
import type { AppSettings, ModelProfile } from '../lib/types'
import { useI18n } from '../lib/i18n'
import { useTheme } from '../lib/theme'
import { useToast } from '../components/toast'
import { Seg } from '../components/ui'

interface ProfileRow extends ModelProfile {
  key_set: boolean // a key already exists server-side for this id
}

export default function Settings() {
  const { t, lang, setLang } = useI18n()
  const { pref, setPref } = useTheme()
  const toast = useToast()
  const [cfg, setCfg] = useState<AppSettings | null>(null)
  const [rows, setRows] = useState<ProfileRow[]>([])
  const [defaultId, setDefaultId] = useState('')
  const [saving, setSaving] = useState(false)
  const [testingId, setTestingId] = useState('')
  const [token, setTokenState] = useState(getToken())

  const apply = (c: AppSettings) => {
    setCfg(c)
    setRows(c.profiles.map((p) => ({ ...p, api_key: '', key_set: p.api_key_set })))
    setDefaultId(c.default_profile)
  }

  useEffect(() => {
    api.settings().then(apply).catch(toast.error)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const setRow = (i: number, patch: Partial<ProfileRow>) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)))

  const addRow = () =>
    setRows((rs) => [...rs, { id: `m${rs.length + 1}`, label: '', api_key: '', base_url: 'https://api.deepseek.com', model: 'deepseek-flash', key_set: false }])

  const rowValid = (r: ProfileRow) => /^[a-zA-Z0-9_-]{1,32}$/.test(r.id) && r.model.trim() && (r.api_key.trim() || r.key_set)

  const dirty = (() => {
    if (!cfg) return false
    if (rows.length !== cfg.profiles.length) return true
    const byId = new Map(cfg.profiles.map((p) => [p.id, p]))
    return (
      rows.some((r) => {
        const o = byId.get(r.id)
        return !o || r.label !== o.label || r.model !== o.model || r.base_url !== o.base_url || !!r.api_key.trim()
      }) || defaultId !== cfg.default_profile
    )
  })()

  const resetToEnv = async () => {
    setSaving(true)
    try {
      apply(await api.saveSettings({ profiles: [] }))
      toast.ok(t('settings.resetProfilesOk'))
    } catch (e) {
      toast.error(e)
    } finally {
      setSaving(false)
    }
  }

  const save = async () => {
    setSaving(true)
    try {
      apply(
        await api.saveSettings({
          profiles: rows.map(({ id, label, api_key, base_url, model }) => ({ id, label: label.trim(), api_key: api_key.trim(), base_url: base_url.trim(), model: model.trim() })),
          default_profile: defaultId,
        }),
      )
      toast.ok(t('settings.profilesSaved'))
    } catch (e) {
      toast.error(e)
    } finally {
      setSaving(false)
    }
  }

  const test = async (id: string) => {
    setTestingId(id)
    try {
      const r = await api.testConnection(id)
      toast.ok(t('settings.testOk', { model: r.model }))
    } catch (e) {
      toast.error(e)
    } finally {
      setTestingId('')
    }
  }

  return (
    <div className="page page-narrow">
      <div className="page-head">
        <div>
          <h1>{t('settings.title')}</h1>
          <p>{t('settings.subtitle')}</p>
        </div>
      </div>

      <div className="stack">
        <section className="section">
          <div className="section-head">
            <div>
              <h2>{t('settings.profiles')}</h2>
              <p>
                {t('settings.profilesHelp')}
                {cfg && <span className="faint"> {t('settings.profilesFrom', { source: cfg.profiles_source })}</span>}
              </p>
            </div>
          </div>
          {cfg?.locked ? (
            <div className="section-body stack">
              <p className="small muted">{t('settings.locked')}</p>
              {cfg.profiles.map((p) => (
                <p key={p.id} className="small mono faint">
                  {p.id === cfg.default_profile ? '★ ' : ''}
                  {p.label} · {p.model} · {p.base_url}
                </p>
              ))}
            </div>
          ) : cfg ? (
            <div className="section-body stack">
              {rows.map((r, i) => (
                <div key={i} className="profile-row">
                  <div className="profile-row-head">
                    <label className="row" style={{ gap: 6, cursor: 'pointer' }}>
                      <input type="radio" name="default-profile" checked={defaultId === r.id} onChange={() => setDefaultId(r.id)} />
                      <strong>{r.label || r.id}</strong>
                      {defaultId === r.id && <span className="badge">{t('settings.defaultBadge')}</span>}
                    </label>
                    <span className="spacer" />
                    <button className="btn btn-sm" disabled={testingId === r.id || dirty || !rowValid(r)} onClick={() => test(r.id)} title={dirty ? t('common.save') : ''}>
                      {testingId === r.id ? <Loader2 className="spin" /> : <PlugZap />}
                      {t('settings.test')}
                    </button>
                    <button className="btn btn-ghost btn-icon btn-sm" disabled={rows.length <= 1} onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))} aria-label={t('common.delete')}>
                      <Trash2 />
                    </button>
                  </div>
                  <div className="field">
                    <label>{t('settings.profileId')}</label>
                    <input className="input mono" value={r.id} onChange={(e) => setRow(i, { id: e.target.value })} />
                  </div>
                  <div className="field">
                    <label>{t('settings.profileLabel')}</label>
                    <input className="input" value={r.label} onChange={(e) => setRow(i, { label: e.target.value })} />
                  </div>
                  <div className="field">
                    <label>{t('settings.profileModel')}</label>
                    <input className="input mono" value={r.model} onChange={(e) => setRow(i, { model: e.target.value })} />
                  </div>
                  <div className="field">
                    <label>{t('settings.profileBaseUrl')}</label>
                    <input className="input mono" value={r.base_url} onChange={(e) => setRow(i, { base_url: e.target.value })} />
                  </div>
                  <div className="field">
                    <label>{t('settings.profileKey')}</label>
                    <input className="input mono" type="password" autoComplete="off" value={r.api_key} placeholder={r.key_set ? t('settings.profileKeyKeep') : 'sk-…'} onChange={(e) => setRow(i, { api_key: e.target.value })} />
                  </div>
                </div>
              ))}
              <div className="row row-wrap">
                <button className="btn" onClick={addRow}>
                  <Plus />
                  {t('settings.addProfile')}
                </button>
                {cfg.profiles_source === 'db' && (
                  <button className="btn btn-ghost" disabled={saving || dirty} onClick={resetToEnv} title={t('settings.profilesHelp')}>
                    {t('settings.resetProfiles')}
                  </button>
                )}
                <span className="spacer" />
                <button className="btn btn-primary" disabled={!dirty || saving || !rows.every(rowValid) || !rows.some((r) => r.id === defaultId)} onClick={save}>
                  {saving && <Loader2 className="spin" />}
                  {t('common.save')}
                </button>
              </div>
            </div>
          ) : (
            <div className="section-body">
              <div className="skeleton" style={{ height: 160 }} />
            </div>
          )}
        </section>

        <section className="section">
          <div className="section-head">
            <h2>{t('settings.access')}</h2>
          </div>
          <div className="section-body stack">
            {cfg?.access_token_required ? (
              <>
                <p className="small muted">{t('settings.accessHelp')}</p>
                <div className="row">
                  <input className="input mono" type="password" value={token} onChange={(e) => setTokenState(e.target.value)} />
                  <button
                    className="btn"
                    onClick={() => {
                      setToken(token.trim())
                      toast.ok(t('common.saved'))
                    }}
                  >
                    {t('common.save')}
                  </button>
                </div>
              </>
            ) : (
              <p className="small muted">{t('settings.accessOff')}</p>
            )}
          </div>
        </section>

        <section className="section">
          <div className="section-head">
            <h2>{t('settings.appearance')}</h2>
          </div>
          <div className="section-body stack">
            <div className="setting-row">
              <span>{t('settings.theme')}</span>
              <Seg
                value={pref}
                onChange={setPref}
                options={[
                  { value: 'system', label: t('theme.system') },
                  { value: 'light', label: t('theme.light') },
                  { value: 'dark', label: t('theme.dark') },
                ]}
              />
            </div>
            <div className="setting-row">
              <span>{t('settings.language')}</span>
              <Seg
                value={lang}
                onChange={setLang}
                options={[
                  { value: 'zh', label: '中文' },
                  { value: 'en', label: 'English' },
                ]}
              />
            </div>
          </div>
        </section>

        <section className="section">
          <div className="section-head">
            <h2>{t('settings.about')}</h2>
          </div>
          <div className="section-body">
            <p className="small muted">{t('settings.aboutBody')}</p>
          </div>
        </section>
      </div>
    </div>
  )
}
