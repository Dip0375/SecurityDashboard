import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './aws-security-dashboard-v4.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
