import { useNavigate } from 'react-router-dom'
import { Check, Circle, Download, FileJson, RotateCcw, Library } from 'lucide-react'
import { api } from '../../lib/api'
import type { GameSnapshot, Verdict } from '../../lib/types'
import { useI18n } from '../../lib/i18n'
import { formatDuration } from '../../lib/format'

const DIST: Verdict[] = ['yes', 'no', 'partial', 'irrelevant', 'invalid']

export function Report({ game }: { game: GameSnapshot }) {
  const { t } = useI18n()
  const nav = useNavigate()
  const r = game.state.report
  if (!r) return null
  const name = (id: string | null) => game.config.players.find((p) => p.id === id)?.name ?? ''
  const totalV = DIST.reduce((s, v) => s + (r.stats.verdicts[v] ?? 0), 0) || 1
  const jump = (seq: number) => {
    const target = game.events.find((e) => e.seq === seq)?.data.reply_to ?? seq
    document.getElementById(`ev-${target}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }
  const q = (seq: number) => game.events.find((e) => e.seq === seq)

  return (
    <section className="report" id="report">
      <div className="report-hero">
        <div className={`rating rating-${r.rating}`}>{r.rating}</div>
        <div className="report-hero-text">
          <div className="report-outcome">{t(`report.outcome.${r.outcome}`)}</div>
          <div className="report-score">
            <span className="report-score-num">{r.score}</span>
            <span className="faint">/ 100</span>
          </div>
          {r.solved_by && <div className="small muted">{t('report.solvedBy', { name: name(r.solved_by) })}</div>}
        </div>
        <div className="breakdown">
          <div>
            <span>{t('report.base')}</span>
            <b>{r.breakdown.base}</b>
          </div>
          <div>
            <span>{t('report.qPenalty')}</span>
            <b>{r.breakdown.questions || 0}</b>
          </div>
          <div>
            <span>{t('report.hPenalty')}</span>
            <b>{r.breakdown.hints || 0}</b>
          </div>
          <div>
            <span>{t('report.gPenalty')}</span>
            <b>{r.breakdown.guesses || 0}</b>
          </div>
        </div>
      </div>

      <div className="stats">
        <div className="stat">
          <span>{t('report.coverage')}</span>
          <b>{Math.round(r.coverage * 100)}%</b>
        </div>
        <div className="stat">
          <span>{t('report.questions')}</span>
          <b>{r.stats.questions}</b>
        </div>
        <div className="stat">
          <span>{t('game.hints')}</span>
          <b>{r.stats.hints}</b>
        </div>
        <div className="stat">
          <span>{t('game.guesses')}</span>
          <b>{r.stats.guesses}</b>
        </div>
        <div className="stat">
          <span>{t('report.duration')}</span>
          <b>{formatDuration(r.stats.duration, t)}</b>
        </div>
        <div className="stat">
          <span>{t('report.tokens')}</span>
          <b>{((r.stats.tokens.prompt + r.stats.tokens.completion) / 1000).toFixed(1)}k</b>
          <small className="faint">{t('report.calls', { n: r.stats.tokens.calls })}</small>
        </div>
      </div>

      <div className="report-block">
        <h3>{t('report.distribution')}</h3>
        <div className="dist">
          {DIST.filter((v) => r.stats.verdicts[v]).map((v) => (
            <div key={v} className={`dist-seg v-${v}`} style={{ flexGrow: r.stats.verdicts[v] / totalV }} title={`${t(`verdict.${v}`)} ${r.stats.verdicts[v]}`} />
          ))}
        </div>
        <div className="dist-legend">
          {DIST.filter((v) => r.stats.verdicts[v]).map((v) => (
            <span key={v}>
              <i className={`v-${v}`} />
              {t(`verdict.${v}`)} {r.stats.verdicts[v]}
            </span>
          ))}
        </div>
      </div>

      <div className="report-block">
        <h3>{t('report.points')}</h3>
        <ul className="point-list">
          {r.points.map((p) => (
            <li key={p.id} className={p.revealed ? 'done' : ''}>
              {p.revealed ? <Check /> : <Circle />}
              <span className="point-text">{p.text}</span>
              {p.by && p.seq != null && (
                <button className="link small" onClick={() => jump(p.seq!)}>
                  {t('report.pointBy', { name: name(p.by), seq: game.events.find((e) => e.seq === p.seq)?.data.reply_to ?? p.seq })}
                </button>
              )}
            </li>
          ))}
        </ul>
      </div>

      {(r.review.summary || r.review.misdirections) && (
        <div className="report-block">
          <h3>{t('report.hostReview')}</h3>
          {r.review.summary && <p className="review-text">{r.review.summary}</p>}
          {r.review.misdirections && (
            <p className="small muted">
              <b>{t('report.misdirections')}：</b>
              {r.review.misdirections}
            </p>
          )}
          {r.review.turning_points.length > 0 && (
            <div className="turning">
              <span className="label">{t('report.turningPoints')}</span>
              {r.review.turning_points.map((seq) => (
                <button key={seq} className="turn-chip" onClick={() => jump(seq)}>
                  <span className="mono faint">#{seq}</span> {q(seq)?.data.text}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="report-block">
        <h3>{t('report.players')}</h3>
        <table className="table">
          <thead>
            <tr>
              <th />
              <th>{t('report.colQuestions')}</th>
              <th>{t('report.colKey')}</th>
              <th>{t('report.colPoints')}</th>
              <th>{t('report.colGuesses')}</th>
            </tr>
          </thead>
          <tbody>
            {r.players.map((p) => {
              const color = game.config.players.find((x) => x.id === p.id)?.color
              return (
                <tr key={p.id}>
                  <td>
                    <span className="row">
                      <span className="dot" style={{ color }} />
                      {p.name}
                      {r.review.mvp === p.name && <span className="badge badge-partial">{t('report.mvp')}</span>}
                    </span>
                  </td>
                  <td>{p.questions}</td>
                  <td>{p.key}</td>
                  <td>{p.points}</td>
                  <td>{p.guesses}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="report-actions">
        <button className="btn" onClick={() => api.exportGame(game.id, 'md')}>
          <Download />
          {t('report.exportMd')}
        </button>
        <button className="btn" onClick={() => api.exportGame(game.id, 'json')}>
          <FileJson />
          {t('report.exportJson')}
        </button>
        <span className="spacer" />
        <button className="btn" onClick={() => nav('/')}>
          <Library />
          {t('report.library')}
        </button>
        {game.puzzle_id && (
          <button
            className="btn btn-primary"
            onClick={() => nav(`/play/${game.puzzle_id}`, { state: { setup: { ...game.config, delay: game.state.delay, start_paused: false } } })}
          >
            <RotateCcw />
            {t('report.again')}
          </button>
        )}
      </div>
    </section>
  )
}
