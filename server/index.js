import express from 'express'
import cors from 'cors'
import { z } from 'zod'
import { analyzeLog } from './analyzer.js'
import { analyzeWithAI } from './aiService.js'
import { storage } from './storageService.js'

const app = express()
const PORT = Number(process.env.PORT || 3001)
const MAX_LOG_SIZE = 250 * 1024

app.use(cors({ origin: true, credentials: true }))
app.use(express.json({ limit: '250kb' }))
app.disable('x-powered-by')

const statusSchema = z.enum(['Open', 'Investigating', 'Resolved'])
const analyzeSchema = z.object({
  logText: z.string().min(1, 'Log content is required').max(MAX_LOG_SIZE, 'Log content is too large')
})

const healthStatus = {
  status: 'ok',
  message: 'Backend heartbeat is healthy.',
  timestamp: new Date().toISOString()
}

async function buildAnalysisResponse(logText) {
  const baseResult = analyzeLog(logText)

  if (process.env.AI_API_KEY || process.env.OPENAI_API_KEY) {
    const aiStatus = await analyzeWithAI(logText)
    if (aiStatus.configured && aiStatus.result && !aiStatus.fallback) {
      return {
        ...aiStatus.result,
        evidence: Array.isArray(aiStatus.result.evidence) ? aiStatus.result.evidence.slice(0, 8) : [],
        detectedPatterns: Array.isArray(aiStatus.result.detectedPatterns) ? aiStatus.result.detectedPatterns : [],
        affectedService: aiStatus.result.affectedService || baseResult.affectedService || 'unknown service',
        remediationSteps: Array.isArray(aiStatus.result.remediationSteps) ? aiStatus.result.remediationSteps : baseResult.remediationSteps,
        verificationSteps: Array.isArray(aiStatus.result.verificationSteps) ? aiStatus.result.verificationSteps : baseResult.verificationSteps,
        analysisMode: 'ai-assisted',
        creationTimestamp: aiStatus.result.creationTimestamp || new Date().toISOString(),
        metadata: baseResult.metadata
      }
    }
    if (aiStatus.fallback) {
      console.warn(aiStatus.error)
    }
  }

  return {
    ...baseResult,
    evidence: Array.isArray(baseResult.evidence) ? baseResult.evidence.slice(0, 8) : [],
    detectedPatterns: Array.isArray(baseResult.detectedPatterns) ? baseResult.detectedPatterns : [],
    remediationSteps: Array.isArray(baseResult.remediationSteps) ? baseResult.remediationSteps : [],
    verificationSteps: Array.isArray(baseResult.verificationSteps) ? baseResult.verificationSteps : [],
    analysisMode: 'rule-based',
    creationTimestamp: baseResult.creationTimestamp || new Date().toISOString(),
    metadata: baseResult.metadata
  }
}

app.get('/api/health', async (req, res) => {
  const analysisMode = process.env.AI_API_KEY || process.env.OPENAI_API_KEY ? 'ai-assisted' : 'rule-based'
  res.json({ ...healthStatus, analysisMode, status: 'ok' })
})

app.post('/api/analyze', async (req, res) => {
  try {
    const parsedBody = analyzeSchema.safeParse(req.body || {})
    if (!parsedBody.success) {
      return res.status(400).json({ error: parsedBody.error.issues[0]?.message || 'Invalid log payload.' })
    }

    const result = await buildAnalysisResponse(parsedBody.data.logText)
    const storedIncident = await storage.createIncident({
      ...result,
      rawLog: parsedBody.data.logText
    })

    return res.status(201).json({
      message: 'Incident analyzed and stored successfully.',
      incident: storedIncident,
      report: result
    })
  } catch (error) {
    console.error('Analyze failure:', error)
    return res.status(500).json({ error: error.message || 'Unable to analyze the log content.' })
  }
})

app.get('/api/incidents', async (req, res) => {
  try {
    const search = String(req.query.search || '')
    const severity = String(req.query.severity || 'all')
    const status = String(req.query.status || 'all')
    const page = Number(req.query.page || 1)
    const limit = Number(req.query.limit || 8)

    const result = await storage.getIncidents({ search, severity, status, page, limit })
    return res.json(result)
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Unable to load incidents.' })
  }
})

app.get('/api/incidents/:id', async (req, res) => {
  try {
    const incident = await storage.getIncidentById(req.params.id)
    if (!incident) {
      return res.status(404).json({ error: 'Incident not found.' })
    }
    return res.json(incident)
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Unable to fetch the incident.' })
  }
})

app.get('/api/incidents/report', async (req, res) => {
  try {
    const incidents = await storage.getIncidents({ page: 1, limit: 9999 })
    return res.json({
      generatedAt: new Date().toISOString(),
      total: incidents.total,
      incidents: incidents.items
    })
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Unable to fetch incident reports.' })
  }
})

app.get('/api/incidents//report', async (req, res) => {
  return res.redirect('/api/incidents/report')
})

app.patch('/api/incidents/:id', async (req, res) => {
  try {
    const id = req.params.id
    const parsedBody = z.object({ status: statusSchema }).safeParse(req.body || {})
    if (!parsedBody.success) {
      return res.status(400).json({ error: 'Status must be one of Open, Investigating, or Resolved.' })
    }

    const incident = await storage.updateIncident(id, { status: parsedBody.data.status })
    if (!incident) {
      return res.status(404).json({ error: 'Incident not found.' })
    }

    return res.json({ message: 'Incident updated successfully.', incident })
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Unable to update incident status.' })
  }
})

app.delete('/api/incidents/:id', async (req, res) => {
  try {
    const incident = await storage.getIncidentById(req.params.id)
    if (!incident) {
      return res.status(404).json({ error: 'Incident not found.' })
    }

    await storage.deleteIncident(req.params.id)
    return res.json({ message: 'Incident deleted successfully.', id: req.params.id })
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Unable to delete the incident.' })
  }
})

app.delete('/api/incidents/clear', async (req, res) => {
  try {
    await storage.clearIncidents()
    return res.json({ message: 'All incidents were cleared successfully.' })
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Unable to clear incident history.' })
  }
})

app.get('/api/stats', async (req, res) => {
  try {
    const stats = await storage.getStats()
    return res.json({ ...stats, generatedAt: new Date().toISOString() })
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Unable to load dashboard metrics.' })
  }
})

app.get('/api/incidents/:id/report', async (req, res) => {
  try {
    const incident = await storage.getIncidentById(req.params.id)
    if (!incident) {
      return res.status(404).json({ error: 'Incident not found.' })
    }

    const markdown = [
      '# Incident Report',
      '',
      `- Incident ID: ${incident.incidentId || incident.id}`,
      `- Title: ${incident.title}`,
      `- Severity: ${incident.severity}`,
      `- Status: ${incident.status}`,
      `- Affected Service: ${incident.affectedService}`,
      `- Suggested Priority: ${incident.suggestedPriority}`,
      '',
      '## Probable Root Cause',
      incident.probableRootCause,
      '',
      '## Supporting Evidence',
      ...incident.evidence.map((entry) => `- ${entry.lineNumber || ''}: ${entry.content || ''}`),
      '',
      '## Remediation',
      ...incident.remediationSteps.map((step) => `- ${step}`),
      '',
      '## Verification',
      ...incident.verificationSteps.map((step) => `- ${step}`)
    ].join('\n')

    return res.json({ incident, markdown })
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Unable to create the incident report.' })
  }
})

app.use((req, res) => {
  res.status(404).json({ error: `Route not found: ${req.path}` })
})

await storage.initialize()
app.listen(PORT, () => {
  console.log(`AI Incident Copilot backend running on http://localhost:${PORT}`)
})
