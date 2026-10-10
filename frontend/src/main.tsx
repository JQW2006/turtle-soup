import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import '@fontsource/noto-serif-sc/500.css'
import '@fontsource/noto-serif-sc/900.css'
import './styles/global.css'
import './styles/app.css'
import App from './App'
import { I18nProvider } from './lib/i18n'
import { ToastProvider } from './components/toast'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <I18nProvider>
        <ToastProvider>
          <App />
        </ToastProvider>
      </I18nProvider>
    </BrowserRouter>
  </StrictMode>,
)
