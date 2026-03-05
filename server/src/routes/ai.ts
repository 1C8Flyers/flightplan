import type { Express } from 'express'

type AiServiceModule = {
  explainMetar: (metar: string) => Promise<Record<string, unknown>>
  airportBrief: (airportData: unknown) => Promise<Record<string, unknown>>
  explainAirspace: (airspaceData: unknown) => Promise<Record<string, unknown>>
  askWithContext: (question: string, context: unknown) => Promise<Record<string, unknown>>
}

let aiServicePromise: Promise<AiServiceModule> | null = null

async function getAiService(): Promise<AiServiceModule> {
  if (!aiServicePromise) {
    const moduleUrl = new URL('../../services/ai/aiService.js', import.meta.url)
    aiServicePromise = import(moduleUrl.href) as Promise<AiServiceModule>
  }

  return aiServicePromise
}

export function registerAiRoutes(app: Express) {
  app.post('/api/ai/metar/explain', async (req, res) => {
    const metar = typeof req.body?.metar === 'string' ? req.body.metar.trim() : ''
    if (!metar) {
      res.status(400).json({ error: 'metar is required.' })
      return
    }

    try {
      const { explainMetar } = await getAiService()
      const explanation = await explainMetar(metar)
      res.json(explanation)
    } catch {
      res.status(500).json({ summary: 'Unable to generate AI explanation.' })
    }
  })

  app.post('/api/ai/airport/brief', async (req, res) => {
    const airportData = req.body?.airportData
    if (!airportData || typeof airportData !== 'object' || Array.isArray(airportData)) {
      res.status(400).json({ error: 'airportData object is required.' })
      return
    }

    try {
      const { airportBrief } = await getAiService()
      const brief = await airportBrief(airportData)
      res.json(brief)
    } catch {
      res.status(500).json({ summary: 'Unable to generate AI explanation.' })
    }
  })

  app.post('/api/ai/airspace/explain', async (req, res) => {
    const airspaceData = req.body?.airspaceData
    if (!airspaceData || typeof airspaceData !== 'object' || Array.isArray(airspaceData)) {
      res.status(400).json({ error: 'airspaceData object is required.' })
      return
    }

    try {
      const { explainAirspace } = await getAiService()
      const explanation = await explainAirspace(airspaceData)
      res.json(explanation)
    } catch {
      res.status(500).json({ summary: 'Unable to generate AI explanation.' })
    }
  })

  app.post('/api/ai/context/ask', async (req, res) => {
    const question = typeof req.body?.question === 'string' ? req.body.question.trim() : ''
    const context = req.body?.context

    if (!question) {
      res.status(400).json({ error: 'question is required.' })
      return
    }

    if (question.length > 500) {
      res.status(400).json({ error: 'question must be 500 characters or fewer.' })
      return
    }

    if (!context || typeof context !== 'object' || Array.isArray(context)) {
      res.status(400).json({ error: 'context object is required.' })
      return
    }

    try {
      const { askWithContext } = await getAiService()
      const answer = await askWithContext(question, context)
      res.json(answer)
    } catch {
      res.status(500).json({
        answer: 'Unable to generate AI explanation.',
        keyPoints: [],
        warnings: ['AI-generated. Verify with official sources and pilot judgment.']
      })
    }
  })
}
