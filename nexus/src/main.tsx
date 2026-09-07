import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { NexusProvider } from '@nexus/react'
import '../packages/tokens/src/tokens.css'
import '../packages/react/src/styles.css'
import './ui/dock.css'
import { App } from './App.tsx'
import { CommandActionsProvider } from './commands/CommandContext.tsx'

const el = document.getElementById('root')
if (!el) throw new Error('main: #root not found')

createRoot(el).render(
  <StrictMode>
    <NexusProvider theme="hud" style={{ width: '100%', height: '100%' }}>
      <CommandActionsProvider>
        <App />
      </CommandActionsProvider>
    </NexusProvider>
  </StrictMode>,
)
