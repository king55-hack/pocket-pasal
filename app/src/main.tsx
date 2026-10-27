import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import { Provider } from './ctx'
import { ErrorBoundary } from './ErrorBoundary'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Provider>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </Provider>
  </StrictMode>,
)
