import { useMemo, useState } from 'react'
import { askAiWithContext, type AiAskContext, type AiContextAnswer } from '../services/aiContextApi'

type AiDrawerProps = {
  isOpen: boolean
  onClose: () => void
  context: AiAskContext
}

const aiDrawerCache = new Map<string, AiContextAnswer>()

function normalizeQuestion(value: string) {
  return value.replace(/\s+/g, ' ').trim()
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }

  return value as Record<string, unknown>
}

function getStringValue(record: Record<string, unknown> | null, key: string) {
  const value = record?.[key]
  return typeof value === 'string' ? value : null
}

function getCacheKey(question: string, context: AiAskContext) {
  const selectedAirport = asRecord(context.selectedAirport)
  const airportInfo = asRecord(selectedAirport?.airport)
  const airportIdent = getStringValue(selectedAirport, 'ident')
    ?? getStringValue(airportInfo, 'icao')
    ?? 'none'

  const selectedAirspace = asRecord(context.selectedAirspace)
  const airspaceId = getStringValue(selectedAirspace, 'id') ?? 'none'

  const metarRaw = context.weather.metarRaw ?? 'none'
  return `${normalizeQuestion(question)}|${airportIdent}|${airspaceId}|${metarRaw}`
}

function summarizeRoute(context: AiAskContext) {
  const from = typeof context.route?.from === 'string' ? context.route.from : null
  const to = typeof context.route?.to === 'string' ? context.route.to : null
  const distance = typeof context.route?.distanceNm === 'number' ? context.route.distanceNm : null

  if (!from && !to && distance == null) {
    return 'No active route context'
  }

  const routeText = from && to ? `${from} → ${to}` : (from ?? to ?? 'Route available')
  return distance == null ? routeText : `${routeText} · ${distance.toFixed(1)} NM`
}

export function AiDrawer({ isOpen, onClose, context }: AiDrawerProps) {
  const [question, setQuestion] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<AiContextAnswer | null>(null)
  const [copyStatus, setCopyStatus] = useState<string | null>(null)

  const questionTrimmed = question.trim()
  const cacheKey = useMemo(() => getCacheKey(questionTrimmed, context), [questionTrimmed, context])
  const selectedAirportSummary = useMemo(() => {
    const selectedAirport = asRecord(context.selectedAirport)
    if (!selectedAirport) {
      return 'None selected'
    }

    const airportInfo = asRecord(selectedAirport.airport)

    const ident = getStringValue(selectedAirport, 'ident')
      ?? getStringValue(airportInfo, 'icao')
      ?? 'Airport selected'

    const name = getStringValue(selectedAirport, 'name')
      ?? getStringValue(airportInfo, 'name')

    return name ? `${ident} — ${name}` : ident
  }, [context])

  const selectedAirspaceSummary = useMemo(() => {
    const selectedAirspace = asRecord(context.selectedAirspace)
    if (!selectedAirspace) {
      return 'None selected'
    }

    const type = getStringValue(selectedAirspace, 'type') ?? 'Airspace'
    const name = getStringValue(selectedAirspace, 'title') ?? getStringValue(selectedAirspace, 'name')
    const id = getStringValue(selectedAirspace, 'id')

    return [type, id, name].filter(Boolean).join(' · ')
  }, [context])

  async function sendQuestion(forceRefresh = false) {
    if (!questionTrimmed || loading) {
      return
    }

    if (!forceRefresh) {
      const cached = aiDrawerCache.get(cacheKey)
      if (cached) {
        setResult(cached)
        setError(null)
        return
      }
    }

    setLoading(true)
    setError(null)

    try {
      const response = await askAiWithContext(questionTrimmed, context)
      aiDrawerCache.set(cacheKey, response)
      setResult(response)
    } catch (caughtError) {
      const message = (caughtError as Error)?.message?.trim()
      setError(message ? `Unable to get AI answer: ${message}` : 'Unable to get AI answer right now.')
    } finally {
      setLoading(false)
    }
  }

  async function copyResponse() {
    if (!result) {
      return
    }

    const textParts = [result.answer]
    if (result.keyPoints.length) {
      textParts.push(`Key points:\n- ${result.keyPoints.join('\n- ')}`)
    }
    if (result.warnings.length) {
      textParts.push(`Warnings:\n- ${result.warnings.join('\n- ')}`)
    }

    try {
      await navigator.clipboard.writeText(textParts.join('\n\n'))
      setCopyStatus('Copied')
      setTimeout(() => setCopyStatus(null), 1200)
    } catch {
      setCopyStatus('Copy failed')
      setTimeout(() => setCopyStatus(null), 1600)
    }
  }

  if (!isOpen) {
    return null
  }

  return (
    <aside className="ai-drawer" aria-label="Ask AI drawer">
      <header className="ai-drawer-header">
        <h3>Ask AI</h3>
        <button type="button" className="ai-drawer-close" onClick={onClose} aria-label="Close Ask AI">×</button>
      </header>

      <label className="ai-drawer-input-wrap">
        <span>Ask a question…</span>
        <textarea
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          maxLength={500}
          rows={3}
          placeholder="Ask about weather, route, airport, or selected airspace"
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              void sendQuestion(false)
            }
          }}
        />
      </label>

      <section className="ai-drawer-context">
        <h4>Context included</h4>
        <ul>
          <li><strong>Airport:</strong> {selectedAirportSummary}</li>
          <li><strong>Airspace:</strong> {selectedAirspaceSummary}</li>
          <li><strong>Route:</strong> {summarizeRoute(context)}</li>
          <li><strong>Weather:</strong> {context.weather.metarRaw ? 'METAR available' : 'METAR missing'} · {context.weather.tafRaw ? 'TAF available' : 'TAF missing'}</li>
          <li><strong>Map:</strong> {context.map.center.lat.toFixed(4)}, {context.map.center.lng.toFixed(4)} · zoom {context.map.zoom.toFixed(1)}</li>
        </ul>
      </section>

      <div className="ai-drawer-actions">
        <button type="button" className="ai-drawer-send" disabled={!questionTrimmed || loading} onClick={() => void sendQuestion(false)}>
          {loading ? 'Sending…' : 'Send'}
        </button>
        <button type="button" className="ai-drawer-send ai-drawer-send-secondary" disabled={!questionTrimmed || loading} onClick={() => void sendQuestion(true)}>
          Ask again
        </button>
      </div>

      {error && <p className="ai-drawer-error">{error}</p>}

      {result && (
        <section className="ai-drawer-response" aria-live="polite">
          <div className="ai-drawer-response-head">
            <h4>Response</h4>
            <button type="button" className="ai-drawer-send ai-drawer-send-secondary" onClick={() => void copyResponse()}>
              {copyStatus ?? 'Copy'}
            </button>
          </div>
          <p>{result.answer}</p>

          {result.keyPoints.length > 0 && (
            <>
              <h5>Key points</h5>
              <ul>
                {result.keyPoints.map((point) => <li key={point}>{point}</li>)}
              </ul>
            </>
          )}

          {result.warnings.length > 0 && (
            <>
              <h5>Warnings</h5>
              <ul className="ai-drawer-warnings">
                {result.warnings.map((warning) => <li key={warning}>{warning}</li>)}
              </ul>
            </>
          )}
        </section>
      )}
    </aside>
  )
}
