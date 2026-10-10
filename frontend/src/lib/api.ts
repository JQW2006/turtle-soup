import type {
  AppSettings,
  GameSnapshot,
  GameSummary,
  Point,
  Puzzle,
  PuzzleInput,
  PuzzleReview,
  Lang,
} from './types'

const TOKEN_KEY = 'soup.token'

export function getToken(): string {
  try {
    return localStorage.getItem(TOKEN_KEY) || ''
  } catch {
    return ''
  }
}

export function setToken(token: string) {
  try {
    localStorage.setItem(TOKEN_KEY, token)
  } catch {
    /* storage unavailable */
  }
}

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

type UnauthorizedHandler = () => void
let onUnauthorized: UnauthorizedHandler | null = null
export function setUnauthorizedHandler(fn: UnauthorizedHandler) {
  onUnauthorized = fn
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {}
  const token = getToken()
  if (token) headers['X-Access-Token'] = token
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  let res: Response
  try {
    res = await fetch(`/api${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  } catch {
    throw new ApiError(0, 'network')
  }
  if (res.status === 401) onUnauthorized?.()
  if (!res.ok) {
    let msg = res.statusText
    try {
      const j = await res.json()
      msg = typeof j.detail === 'string' ? j.detail : JSON.stringify(j.detail)
    } catch {
      /* not json */
    }
    throw new ApiError(res.status, msg)
  }
  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

async function download(path: string) {
  const token = getToken()
  const res = await fetch(`/api${path}`, { headers: token ? { 'X-Access-Token': token } : {} })
  if (!res.ok) throw new ApiError(res.status, res.statusText)
  const cd = res.headers.get('Content-Disposition') || ''
  const name = /filename="([^"]+)"/.exec(cd)?.[1] || 'download'
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export interface PuzzleFilter {
  q?: string
  language?: string
  color?: string
  genre?: string
  source?: string
}

export const api = {
  puzzles: (f: PuzzleFilter = {}) => {
    const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v) as [string, string][]).toString()
    return request<Puzzle[]>('GET', `/puzzles${qs ? `?${qs}` : ''}`)
  },
  puzzle: (id: string) => request<Puzzle>('GET', `/puzzles/${id}`),
  createPuzzle: (p: PuzzleInput) => request<Puzzle>('POST', '/puzzles', p),
  updatePuzzle: (id: string, p: PuzzleInput) => request<Puzzle>('PUT', `/puzzles/${id}`, p),
  duplicatePuzzle: (id: string) => request<Puzzle>('POST', `/puzzles/${id}/duplicate`),
  deletePuzzle: (id: string) => request<void>('DELETE', `/puzzles/${id}`),
  exportPuzzles: (ids?: string[]) => download(`/puzzles/export${ids?.length ? `?ids=${ids.join(',')}` : ''}`),
  importPuzzles: (payload: unknown) =>
    request<{ created: number; errors: { index: number; error: string }[] }>('POST', '/puzzles/import', payload),
  analyzePoints: (body: { surface: string; bottom: string; host_notes: string; language: Lang }) =>
    request<{ points: Point[] }>('POST', '/puzzles/analyze/points', body),
  reviewPuzzle: (body: { surface: string; bottom: string; host_notes: string; language: Lang }) =>
    request<PuzzleReview>('POST', '/puzzles/analyze/review', body),

  games: () => request<GameSummary[]>('GET', '/games'),
  game: (id: string) => request<GameSnapshot>('GET', `/games/${id}`),
  createGame: (body: unknown) => request<{ id: string }>('POST', '/games', body),
  deleteGame: (id: string) => request<void>('DELETE', `/games/${id}`),
  control: (id: string, action: 'pause' | 'resume' | 'step' | 'end') => request('POST', `/games/${id}/control`, { action }),
  speed: (id: string, delay: number) => request('POST', `/games/${id}/speed`, { delay }),
  spectatorHint: (id: string, text: string) => request('POST', `/games/${id}/hint`, { text }),
  playerAction: (id: string, action: string, text = '') => request('POST', `/games/${id}/player`, { action, text }),
  hostAnswer: (id: string, body: { verdict: string; key: boolean; note: string; points: string[] }) =>
    request('POST', `/games/${id}/host/answer`, body),
  hostJudge: (id: string, body: { correct: boolean; matched: string[]; feedback: string }) =>
    request('POST', `/games/${id}/host/judge`, body),
  hostHint: (id: string, body: { text?: string; skip?: boolean; use_ai?: boolean }) =>
    request('POST', `/games/${id}/host/hint`, body),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  suggest: (id: string) => request<any>('POST', `/games/${id}/suggest`),
  override: (id: string, seq: number, body: { verdict: string; key?: boolean }) =>
    request('POST', `/games/${id}/events/${seq}/override`, body),
  exportGame: (id: string, format: 'md' | 'json') => download(`/games/${id}/export?format=${format}`),

  settings: () => request<AppSettings>('GET', '/settings'),
  saveSettings: (body: { api_key?: string; base_url?: string; model?: string }) =>
    request<AppSettings>('PUT', '/settings', body),
  testConnection: () => request<{ ok: boolean; model: string }>('POST', '/settings/test'),
}

export function streamUrl(id: string) {
  const token = getToken()
  return `/api/games/${id}/stream${token ? `?token=${encodeURIComponent(token)}` : ''}`
}
