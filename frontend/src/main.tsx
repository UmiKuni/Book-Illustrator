import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './app/App.tsx'
import './styles/globals.css'
import './styles/shell.css'
import './styles/identity.css'
import './styles/projects.css'
import './styles/project-detail.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
