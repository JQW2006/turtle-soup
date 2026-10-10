import { useEffect, useState } from 'react'
import { Loader2, PlugZap } from 'lucide-react'
import { api, getToken, setToken } from '../lib/api'
import type { AppSettings } from '../lib/types'
import { useI18n } from '../lib/i18n'
import { useTheme } from '../lib/theme'
import { useToast } from '../components/toast'
import { Seg } from '../components/ui'

const MODELS = ['deepseek-flash', 'deepseek-v4-pro']

export default function Settings() {
  const { t, lang, setLang } = useI18n()
  const { pref, setPref } = useTheme()
  const toast = useToast()
  const [cfg, setCfg] = useState<AppSettings | null>(null)
  const [key, setKey] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [model, setModel] = useState('')
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [token, setTokenState] = useState(getToken())

  const apply = (c: AppSettings) => {
    setCfg(c)
    setBaseUrl(c.base_url)
    setModel(c.model)
  }

  useEffect(() => {
    api.settings().then(apply).catch(toast.error)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const save = async (body: { api_key?: string; base_url?: string; model?: string }) => {
    setSaving(true)
    try {
      apply(await api.saveSettings(body))
      setKey('')
      toast.ok(t('common.saved'))
    } catch (e) {
      toast.error(e)
    } finally {
      setSaving(false)
    }
  }

  const test = async () => {
    setTesting(true)
    try {
      const r = await api.testConnection()
      toast.ok(t('settings.testOk', { model: r.model }))
    } catch (e) {
      toast.error(e)
    } finally {
      setTesting(false)
    }
  }

  const dirty = cfg && (key.trim() || baseUrl !== cfg.base_url || model !== cfg.model)

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
              <h2>{t('settings.api')}</h2>
              <p>{t('settings.apiHelp')}</p>
            </div>
          </div>
          {cfg?.locked ? (
            <div className="section-body stack">
              <p className="small muted">{t('settings.locked')}</p>
              <p className="small mono faint">
                {cfg.model} · {cfg.base_url}
              </p>
            </div>
          ) : cfg ? (
            <div className="section-body stack">
              <div className="field">
                <label htmlFor="s-key">
                  {t('settings.apiKey')}
                  <span className="faint">
                    {' · '}
                    {cfg.api_key_set ? `${cfg.api_key_preview} · ` : ''}
                    {t(`settings.keySource.${cfg.api_key_source}`)}
                  </span>
                </label>
                <input id="s-key" className="input mono" type="password" autoComplete="off" value={key} placeholder={t('settings.apiKeyPh')} onChange={(e) => setKey(e.target.value)} />
              </div>
              <div className="grid-2">
                <div className="field">
                  <label htmlFor="s-url">{t('settings.baseUrl')}</label>
                  <input id="s-url" className="input mono" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
                </div>
                <div className="field">
                  <label htmlFor="s-model">{t('settings.model')}</label>
                  <input id="s-model" className="input mono" list="models" value={model} onChange={(e) => setModel(e.target.value)} />
                  <datalist id="models">
                    {MODELS.map((m) => (
                      <option key={m} value={m} />
                    ))}
                  </datalist>
                </div>
              </div>
              <div className="row row-wrap">
                <button className="btn" disabled={testing} onClick={test}>
                  {testing ? <Loader2 className="spin" /> : <PlugZap />}
                  {t('settings.test')}
                </button>
                {cfg.api_key_source === 'db' && (
                  <button className="btn btn-ghost" disabled={saving} onClick={() => save({ api_key: '' })}>
                    {t('settings.clearKey')}
                  </button>
                )}
                <span className="spacer" />
                <button
                  className="btn btn-primary"
                  disabled={!dirty || saving}
                  onClick={() => save({ ...(key.trim() ? { api_key: key.trim() } : {}), base_url: baseUrl, model })}
                >
                  {saving && <Loader2 className="spin" />}
                  {t('common.save')}
                </button>
              </div>
            </div>
          ) : (
            <div className="section-body">
              <div className="skeleton" style={{ height: 120 }} />
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
