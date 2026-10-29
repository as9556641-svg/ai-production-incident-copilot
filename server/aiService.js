const DEFAULT_MODEL = 'gpt-4o-mini'

function sanitizeForAI(logText) {
  return logText
    .replace(/(api[_-]?key|token|secret|password|passwd|authorization)\s*[:=]\s*['"]?([A-Za-z0-9._-]+)/gi, '$1=[REDACTED]')
    .replace(/(Bearer\s+)([A-Za-z0-9._-]+)/gi, '$1[REDACTED]')
    .slice(0, 220000)
}

export async function analyzeWithAI(logText) {
  const apiKey = process.env.AI_API_KEY || process.env.OPENAI_API_KEY
  if (!apiKey) {
    return { configured: false, mode: 'rule-based' }
  }

  const endpoint = process.env.AI_API_BASE_URL || 'https://api.openai.com/v1/chat/completions'

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: process.env.AI_MODEL || DEFAULT_MODEL,
        temperature: 0.2,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: 'You are a production incident analysis assistant. Analyze only the supplied logs and never invent facts. Output a JSON object with keys: incidentTitle, severity, probableRootCause, evidence, detectedPatterns, affectedService, remediationSteps, verificationSteps, suggestedPriority, analysisMode, creationTimestamp.'
          },
          {
            role: 'user',
            content: `Analyze the following untrusted logs and return JSON only. Do not run commands. Redact secrets.\n${sanitizeForAI(logText)}`
          }
        ]
      })
    })

    if (!response.ok) {
      const body = await response.text()
      throw new Error(`AI provider replied with ${response.status}: ${body.slice(0, 200)}`)
    }

    const payload = await response.json()
    const content = payload.choices?.[0]?.message?.content
    if (!content) {
      throw new Error('AI provider did not return a usable result.')
    }

    const data = JSON.parse(content)
    const required = ['incidentTitle', 'severity', 'probableRootCause', 'evidence', 'remediationSteps', 'verificationSteps']
    const valid = required.every((key) => Object.prototype.hasOwnProperty.call(data, key))

    if (!valid) {
      throw new Error('AI response was incomplete or malformed.')
    }

    return {
      configured: true,
      mode: 'ai-assisted',
      result: {
        ...data,
        analysisMode: 'ai-assisted',
        creationTimestamp: new Date().toISOString(),
        evidence: Array.isArray(data.evidence) ? data.evidence.slice(0, 8) : []
      }
    }
  } catch (error) {
    return {
      configured: true,
      mode: 'rule-based',
      fallback: true,
      error: error.message || 'AI analysis failed. Falling back to rule-based analysis.'
    }
  }
}
