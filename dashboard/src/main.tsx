import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

const root = document.getElementById('root')!

// A crash during mount would otherwise leave a blank page with the reason only
// in the devtools console — which is unreachable on a phone, the primary client.
window.addEventListener('error', (errorEvent) => {
  if (root.childElementCount > 0) return
  root.textContent = `Startup error: ${errorEvent.message}\n\n${errorEvent.error?.stack ?? ''}`
})

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
