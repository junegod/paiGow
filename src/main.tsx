import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/manrope/index.css'

import App from '@/App'
import '@/index.css'
import '@/ui/styles/actionPanel.css'
import '@/ui/styles/gameHelp.css'
import '@/ui/styles/lobbyDifficulty.css'
import '@/ui/styles/settingsPanel.css'
import '@/ui/styles/privacyPanel.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
