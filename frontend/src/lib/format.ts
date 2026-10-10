import type { TFunc } from './i18n'

export function formatDuration(sec: number | null | undefined, t: TFunc) {
  if (sec == null) return '—'
  if (sec < 60) return t('time.s', { n: sec })
  return t('time.m', { m: Math.floor(sec / 60), s: sec % 60 })
}

export function formatTime(iso: string | null, lang: string) {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleString(lang === 'zh' ? 'zh-CN' : 'en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}
