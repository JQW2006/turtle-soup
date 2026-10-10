import { useEffect, useState } from 'react'
import { NavLink, Route, Routes, useLocation, useParams } from 'react-router-dom'
import { Moon, Sun, Languages } from 'lucide-react'
import { Logo, Modal } from './components/ui'
import { InkDefs } from './components/ink'
import { useI18n } from './lib/i18n'
import { useTheme } from './lib/theme'
import { setToken, setUnauthorizedHandler } from './lib/api'
import Library from './pages/Library'
import PuzzleEditor from './pages/PuzzleEditor'
import NewGame from './pages/NewGame'
import GameRoom from './pages/GameRoom'
import Games from './pages/Games'
import Settings from './pages/Settings'

function TokenPrompt({ onDone }: { onDone: () => void }) {
  const { t } = useI18n()
  const [value, setValue] = useState('')
  return (
    <Modal onClose={() => {}}>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          setToken(value.trim())
          onDone()
          window.location.reload()
        }}
      >
        <div className="modal-head">
          <h2>{t('auth.title')}</h2>
        </div>
        <div className="modal-body stack">
          <p>{t('auth.body')}</p>
          <input className="input" type="password" autoFocus value={value} placeholder={t('auth.ph')} onChange={(e) => setValue(e.target.value)} />
        </div>
        <div className="modal-foot">
          <button className="btn btn-primary" disabled={!value.trim()}>
            {t('auth.submit')}
          </button>
        </div>
      </form>
    </Modal>
  )
}

function GameRoomRoute() {
  const { id } = useParams()
  return <GameRoom key={id} />
}

export default function App() {
  const { t, lang, setLang } = useI18n()
  const { toggle } = useTheme()
  const [needToken, setNeedToken] = useState(false)
  const loc = useLocation()

  useEffect(() => {
    setUnauthorizedHandler(() => setNeedToken(true))
  }, [])
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [loc.pathname])

  const inGame = loc.pathname.startsWith('/games/')

  return (
    <div className="app">
      <InkDefs />
      <header className="topbar">
        <NavLink to="/" className="brand">
          <Logo />
          <span>{t('app.name')}</span>
        </NavLink>
        <nav className="nav">
          <NavLink to="/" end className={({ isActive }) => (isActive || loc.pathname.startsWith('/puzzles') || loc.pathname.startsWith('/play') ? 'active' : '')}>
            {t('nav.library')}
          </NavLink>
          <NavLink to="/games" className={() => (loc.pathname.startsWith('/games') ? 'active' : '')}>
            {t('nav.games')}
          </NavLink>
          <NavLink to="/settings">{t('nav.settings')}</NavLink>
        </nav>
        <div className="spacer" />
        <button className="btn btn-ghost btn-sm" onClick={() => setLang(lang === 'zh' ? 'en' : 'zh')} title={t('lang.toggle')}>
          <Languages />
          <span className="hide-sm">{t('lang.toggle')}</span>
        </button>
        <button className="btn btn-ghost btn-icon btn-sm" onClick={toggle} title={t('theme.toggle')} aria-label={t('theme.toggle')}>
          <Sun className="only-dark" />
          <Moon className="only-light" />
        </button>
      </header>
      <main className={inGame ? 'main-game' : 'main'}>
        <Routes>
          <Route path="/" element={<Library />} />
          <Route path="/puzzles/new" element={<PuzzleEditor />} />
          <Route path="/puzzles/:id" element={<PuzzleEditor />} />
          <Route path="/play/:puzzleId" element={<NewGame />} />
          <Route path="/games" element={<Games />} />
          <Route path="/games/:id" element={<GameRoomRoute />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<div className="empty">{t('notfound')}</div>} />
        </Routes>
      </main>
      {needToken && <TokenPrompt onDone={() => setNeedToken(false)} />}
    </div>
  )
}
