import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { AccentProvider } from './context/AccentContext'
import { ThemeProvider } from './context/ThemeContext'
import { SessionProvider } from './context/SessionContext'
import { SearchProvider } from './context/SearchContext'
import { ContentPolicyProvider } from './context/ContentPolicyContext'
import { ToastProvider, ConfirmProvider } from './components/feedback'
import './styles/global.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AccentProvider>
        <ThemeProvider>
          <SessionProvider>
            <SearchProvider>
              <ContentPolicyProvider>
                <ToastProvider>
                  <ConfirmProvider>
                    <App />
                  </ConfirmProvider>
                </ToastProvider>
              </ContentPolicyProvider>
            </SearchProvider>
          </SessionProvider>
        </ThemeProvider>
      </AccentProvider>
    </BrowserRouter>
  </StrictMode>,
)
