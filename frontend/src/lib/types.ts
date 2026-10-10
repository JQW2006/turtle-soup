export type Lang = 'zh' | 'en'
export type Effort = 'off' | 'low' | 'high' | 'max'
export type Verdict = 'yes' | 'no' | 'irrelevant' | 'partial' | 'invalid'
export type NoteCode = '' | 'close' | 'premise' | 'repeat' | 'unimportant' | 'rephrase'

export interface Point {
  id: string
  text: string
  weight: number
  core: boolean
}

export interface PuzzleInput {
  title: string
  surface: string
  bottom: string
  host_notes: string
  points: Point[]
  tags: string[]
  color: 'clear' | 'red'
  genre: 'honkaku' | 'henkaku'
  difficulty: number
  language: Lang
}

export interface Puzzle extends PuzzleInput {
  id: string
  source: 'builtin' | 'user'
  play_count: number
  created_at: string
  updated_at: string
}

export interface ReviewIssue {
  level: 'error' | 'warn' | 'info'
  text: string
}

export interface PuzzleReview {
  verdict: string
  issues: ReviewIssue[]
  difficulty: number
  color: 'clear' | 'red'
  genre: 'honkaku' | 'henkaku'
  title: string
}

export interface PlayerConfig {
  id: string
  name: string
  kind: 'ai' | 'human'
  persona: string
  custom_persona: string
  effort: Effort
  color: string
}

export interface Rules {
  max_questions: number
  max_guesses: number
  max_hints: number
  auto_hint_after: number
  allow_hint_requests: boolean
  allow_discussion: boolean
  final_round: boolean
  extra_rules: string
}

export interface GameConfig {
  language: Lang
  host: { kind: 'ai' | 'human'; effort: Effort }
  players: PlayerConfig[]
  rules: Rules
}

export interface GameEvent {
  seq: number
  type: 'opening' | 'question' | 'answer' | 'discussion' | 'guess' | 'judgement' | 'hint' | 'system' | 'error' | 'reveal'
  actor: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: Record<string, any>
  created_at: string | null
  live?: boolean
}

export type Waiting =
  | { kind: 'player'; actor: string; final: boolean }
  | { kind: 'host_answer'; seq: number; actor: string }
  | { kind: 'host_judge'; seq: number; actor: string }
  | { kind: 'host_hint'; source: string; actor: string | null }

export interface Report {
  outcome: 'solved' | 'failed' | 'revealed'
  solved_by: string | null
  coverage: number
  score: number
  rating: string
  breakdown: { base: number; questions: number; hints: number; guesses: number }
  stats: {
    questions: number
    hints: number
    guesses: number
    wrong_guesses: number
    verdicts: Record<Verdict, number>
    duration: number | null
    tokens: { prompt: number; completion: number; calls: number }
  }
  points: (Point & { revealed: boolean; seq: number | null; by: string | null })[]
  players: { id: string; name: string; kind: string; questions: number; key: number; yes: number; discussions: number; guesses: number; points: number }[]
  key_questions: number[]
  review: { summary: string; turning_points: number[]; misdirections: string; mvp: string }
}

export interface GameState {
  paused: boolean
  delay: number
  phase: 'playing' | 'final' | 'finished'
  turn: number
  questions_used: number
  guesses_used: number
  hints_used: number
  stale: number
  revealed: Record<string, number>
  best_coverage: number
  waiting: Waiting | null
  solved_by: string | null
  tokens: { prompt: number; completion: number; calls: number }
  started_at: string
  finished_at?: string
  error: string | null
  report: Report | null
  status: 'active' | 'finished'
  running: boolean
  activity: { actor: string; kind: string } | null
  questions_left: number | null
  guesses_left: number | null
  hints_left: number
  progress: number
}

export interface GameSnapshot {
  id: string
  puzzle_id: string | null
  puzzle: {
    title: string
    surface: string
    bottom: string
    host_notes: string
    points: Point[]
    color: string
    genre: string
    difficulty: number
  }
  config: GameConfig
  state: GameState
  events: GameEvent[]
}

export interface GameSummary {
  id: string
  puzzle_id: string | null
  title: string
  status: 'active' | 'finished'
  outcome: string | null
  rating: string | null
  score: number | null
  questions_used: number
  player_names: string[]
  host_kind: 'ai' | 'human'
  created_at: string
  finished_at: string | null
}

export interface AppSettings {
  api_key_set: boolean
  api_key_preview: string
  api_key_source: 'db' | 'env' | 'none'
  base_url: string
  model: string
  access_token_required: boolean
  locked: boolean
}
