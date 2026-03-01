import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import ChartsMap from './pages/ChartsMap.tsx'

function RoutedApp() {
  const [pathname, setPathname] = useState(window.location.pathname)

  useEffect(() => {
    const onPopState = () => setPathname(window.location.pathname)
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  if (pathname === '/charts') {
    return <ChartsMap />
  }

  return <App />
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RoutedApp />
  </StrictMode>,
)
