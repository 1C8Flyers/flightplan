import { useEffect, useMemo, useState } from 'react'
import type { BriefResponse } from '../services/briefApi'

type BriefCardProps = {
  title?: string
  actionLabel?: string
  cacheKey: string
  onGenerate: () => Promise<BriefResponse>
  autoGenerate?: boolean
  hideActions?: boolean
}

const BRIEF_UNAVAILABLE_SUMMARY = 'Unable to generate AI explanation.'
const briefCache = new Map<string, BriefResponse>()

export function BriefCard({
  title = 'Brief',
  actionLabel = 'Generate',
  cacheKey,
  onGenerate,
  autoGenerate = false,
  hideActions = false
}: BriefCardProps) {
  const cached = useMemo(() => briefCache.get(cacheKey) ?? null, [cacheKey])
  const [result, setResult] = useState<BriefResponse | null>(cached)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copyStatus, setCopyStatus] = useState<string | null>(null)

  useEffect(() => {
    if (!autoGenerate || result || loading) {
      return
    }

    void loadBrief(false)
  }, [autoGenerate, cacheKey, loading, result, onGenerate])

  async function loadBrief(forceRefresh = false) {
    if (!forceRefresh) {
      const fromCache = briefCache.get(cacheKey)
      if (fromCache) {
        setResult(fromCache)
        setError(null)
        return
      }
    }

    setLoading(true)
    setError(null)

    try {
      const generated = await onGenerate()
      briefCache.set(cacheKey, generated)
      setResult(generated)
    } catch (caughtError) {
      const message = (caughtError as Error)?.message?.trim()
      setError(message ? `Unable to generate brief: ${message}` : 'Unable to generate brief right now.')
    } finally {
      setLoading(false)
    }
  }

  async function copyResult() {
    if (!result) {
      return
    }

    const text = result.notes ? `${result.summary}\n\n${result.notes}` : result.summary

    try {
      await navigator.clipboard.writeText(text)
      setCopyStatus('Copied')
      setTimeout(() => setCopyStatus(null), 1200)
    } catch {
      setCopyStatus('Copy failed')
      setTimeout(() => setCopyStatus(null), 1600)
    }
  }

  const briefUnavailable = result?.summary === BRIEF_UNAVAILABLE_SUMMARY

  return (
    <section className="ai-brief-card" aria-live="polite">
      <header className="ai-brief-card-header">
        <h4>{title}</h4>
        {!hideActions && (
          <div className="ai-brief-card-actions">
            <button type="button" className="ai-brief-button" onClick={() => void loadBrief(false)} disabled={loading}>
              {loading ? 'Generating…' : actionLabel}
            </button>
            {result && (
              <>
                <button type="button" className="ai-brief-button ai-brief-button-secondary" onClick={() => void loadBrief(true)} disabled={loading}>
                  Regenerate
                </button>
                <button type="button" className="ai-brief-button ai-brief-button-secondary" onClick={() => void copyResult()}>
                  {copyStatus ?? 'Copy'}
                </button>
              </>
            )}
          </div>
        )}
      </header>

      {loading && <p className="ai-brief-loading">Generating brief…</p>}
      {!loading && error && <p className="ai-brief-error">{error}</p>}

      {!loading && !error && result && (
        <div className="ai-brief-content">
          <p>{result.summary}</p>
          {result.notes && <p className="ai-brief-notes">{result.notes}</p>}
          {briefUnavailable && <p className="ai-brief-warning">Brief service may be unavailable on the server.</p>}
        </div>
      )}
    </section>
  )
}
