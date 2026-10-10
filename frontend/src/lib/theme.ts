import { useCallback, useEffect, useSyncExternalStore } from 'react'

export type ThemePref = 'system' | 'light' | 'dark'

function read(): ThemePref {
  try {
    const v = localStorage.getItem('soup.theme')
    if (v === 'light' || v === 'dark' || v === 'system') return v
  } catch {
    /* ignore */
  }
  return 'dark'
}

let current: ThemePref = read()
const listeners = new Set<() => void>()

function apply(pref: ThemePref) {
  const dark = pref === 'dark' || (pref === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.dataset.theme = dark ? 'dark' : 'light'
}

function setPref(pref: ThemePref) {
  current = pref
  try {
    localStorage.setItem('soup.theme', pref)
  } catch {
    /* ignore */
  }
  apply(pref)
  listeners.forEach((l) => l())
}

function subscribe(l: () => void) {
  listeners.add(l)
  return () => listeners.delete(l)
}

/** Theme preference shared across components (system / light / dark). */
export function useTheme() {
  const pref = useSyncExternalStore(subscribe, () => current)

  useEffect(() => {
    if (pref !== 'system') return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => apply('system')
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [pref])

  const toggle = useCallback(() => {
    setPref(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark')
  }, [])

  return { pref, setPref, toggle }
}

apply(current)
