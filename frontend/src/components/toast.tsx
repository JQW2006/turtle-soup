import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'
import { CircleAlert, Check } from 'lucide-react'
import { ApiError } from '../lib/api'
import { useI18n } from '../lib/i18n'

interface Toast {
  id: number
  text: string
  kind: 'ok' | 'error'
}

interface ToastCtx {
  ok: (text: string) => void
  error: (e: unknown) => void
}

const Ctx = createContext<ToastCtx | null>(null)
let nextId = 1

export function ToastProvider({ children }: { children: ReactNode }) {
  const { t } = useI18n()
  const [items, setItems] = useState<Toast[]>([])

  const push = useCallback((text: string, kind: Toast['kind']) => {
    const id = nextId++
    setItems((xs) => [...xs.slice(-2), { id, text, kind }])
    setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), kind === 'error' ? 5000 : 2600)
  }, [])

  const ok = useCallback((text: string) => push(text, 'ok'), [push])
  const error = useCallback(
    (e: unknown) => {
      let text = String(e)
      if (e instanceof ApiError) text = e.status === 0 ? t('common.networkError') : e.message
      else if (e instanceof Error) text = e.message
      push(text, 'error')
    },
    [push, t],
  )

  return (
    <Ctx.Provider value={{ ok, error }}>
      {children}
      <div className="toasts" aria-live="polite">
        {items.map((x) => (
          <div key={x.id} className={`toast ${x.kind === 'error' ? 'error' : ''}`}>
            {x.kind === 'error' ? <CircleAlert /> : <Check />}
            {x.text}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function useToast() {
  const v = useContext(Ctx)
  if (!v) throw new Error('useToast outside provider')
  return v
}
