import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/manrope/index.css'

import App from '@/App'
import '@/index.css'
import '@/ui/styles/actionPanel.css'
import '@/ui/styles/gameHelp.css'
import '@/ui/styles/lobby.css'
import '@/ui/styles/rulesPanel.css'
import '@/ui/styles/settingsPanel.css'
import '@/ui/styles/privacyPanel.css'
import '@/ui/styles/table3d.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
