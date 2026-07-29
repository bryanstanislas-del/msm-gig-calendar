import React from 'react'
import ReactDOM from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import App from './App.jsx'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)

// Registers the service worker in production builds only; vite-plugin-pwa's
// dev-server integration is disabled by default, so this is a no-op under
// `vite dev`. registerType: 'autoUpdate' (see vite.config.js) means a new
// service worker activates in the background automatically -- no update
// prompt/toast UI, by design for this sprint.
registerSW({ immediate: true })
