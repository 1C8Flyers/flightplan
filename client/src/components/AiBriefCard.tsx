import { useMemo, useState } from 'react'
import type { AiBriefResponse } from '../services/aiApi'

type AiBriefCardProps = {
  title?: string
  actionLabel?: string
  cacheKey: string
  onGenerate: () => Promise<AiBriefResponse>
}

const AI_DISABLED_SUMMARY = 'Unable to generate AI explanation.'
const aiBriefCache = new Map<string, AiBriefResponse>()

export function AiBriefCard({
  title = 'AI Brief',
  actionLabel = 'Generate',
  cacheKey,
  onGenerate
}: AiBriefCardProps) {
  const cached = useMemo(() => aiBriefCache.get(cacheKey) ?? null, [cacheKey])
  const [result, setResult] = useState<AiBriefResponse | null>(cached)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copyStatus, setCopyStatus] = useState<string | null>(null)

  async function loadBrief(forceRefresh = false) {
    if (!forceRefresh) {
      const fromCache = aiBriefCache.get(cacheKey)
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
      aiBriefCache.set(cacheKey, generated)
      setResult(generated)
    } catch (caughtError) {
      const message = (caughtError as Error)?.message?.trim()
      setError(message ? `Unable to generate AI brief: ${message}` : 'Unable to generate AI brief right now.')
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

  const aiDisabled = result?.summary === AI_DISABLED_SUMMARY

  return (
    <section className="ai-brief-card" aria-live="polite">
      <header className="ai-brief-card-header">
        <h4>{title}</h4>
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
      </header>

      {loading && <p className="ai-brief-loading">Generating AI brief…</p>}
      {!loading && error && <p className="ai-brief-error">{error}</p>}

      {!loading && !error && result && (
        <div className="ai-brief-content">
          <p>{result.summary}</p>
          {result.notes && <p className="ai-brief-notes">{result.notes}</p>}
          {aiDisabled && <p className="ai-brief-warning">AI may be disabled on the server.</p>}
        </div>
      )}
    </section>
  )
}
