import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { History, Trash2 } from 'lucide-react'
import { api } from '../lib/api'
import type { GameSummary } from '../lib/types'
import { useI18n } from '../lib/i18n'
import { useToast } from '../components/toast'
import { Confirm } from '../components/ui'
import { formatTime } from '../lib/format'

export default function Games() {
  const { t, lang } = useI18n()
  const toast = useToast()
  const nav = useNavigate()
  const [items, setItems] = useState<GameSummary[] | null>(null)
  const [deleting, setDeleting] = useState<GameSummary | null>(null)

  useEffect(() => {
    api
      .games()
      .then(setItems)
      .catch((e) => {
        toast.error(e)
        setItems([])
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>{t('games.title')}</h1>
          <p>{t('games.subtitle')}</p>
        </div>
      </div>

      {items === null ? (
        <div className="skeleton" style={{ height: 240 }} />
      ) : items.length === 0 ? (
        <div className="empty">
          <History />
          {t('games.empty')}
          <Link to="/" className="btn">
            {t('nav.library')}
          </Link>
        </div>
      ) : (
        <div className="section table-wrap">
          <table className="table table-hover">
            <thead>
              <tr>
                <th>{t('games.colPuzzle')}</th>
                <th className="hide-sm">{t('games.colPlayers')}</th>
                <th>{t('games.colResult')}</th>
                <th className="hide-sm num">{t('games.colQuestions')}</th>
                <th className="hide-sm">{t('games.colTime')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {items.map((g) => (
                <tr key={g.id} onClick={() => nav(`/games/${g.id}`)}>
                  <td className="strong">{g.title}</td>
                  <td className="hide-sm muted">
                    {g.player_names.join(lang === 'zh' ? '、' : ', ')}
                    {g.host_kind === 'human' && <span className="faint"> · {t('games.humanHost')}</span>}
                  </td>
                  <td>
                    {g.status === 'active' ? (
                      <span className="status status-running">
                        <span className="dot" />
                        {t('games.active')}
                      </span>
                    ) : (
                      <span className="row">
                        {g.rating && <span className={`rating-sm rating-${g.rating}`}>{g.rating}</span>}
                        <span className={g.outcome === 'solved' ? '' : 'muted'}>{t(`report.outcome.${g.outcome}` as 'report.outcome.solved')}</span>
                        {g.score != null && <span className="faint mono">{g.score}</span>}
                      </span>
                    )}
                  </td>
                  <td className="hide-sm num mono">{g.questions_used}</td>
                  <td className="hide-sm faint nowrap">{formatTime(g.created_at, lang)}</td>
                  <td className="num">
                    <button
                      className="btn btn-ghost btn-icon btn-sm"
                      onClick={(e) => {
                        e.stopPropagation()
                        setDeleting(g)
                      }}
                      aria-label={t('common.delete')}
                    >
                      <Trash2 />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {deleting && (
        <Confirm
          danger
          title={t('games.deleteTitle')}
          body={t('games.deleteBody')}
          confirmLabel={t('common.delete')}
          onClose={() => setDeleting(null)}
          onConfirm={async () => {
            try {
              await api.deleteGame(deleting.id)
              setItems((xs) => xs?.filter((x) => x.id !== deleting.id) ?? null)
            } catch (e) {
              toast.error(e)
            }
          }}
        />
      )}
    </div>
  )
}
