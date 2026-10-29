import { ruleCatalog } from './rules.js'

const MAX_LOG_SIZE = 250 * 1024

const REDACTION_PATTERNS = [
  /(api[_-]?key|apikey|access[_-]?token|refresh[_-]?token|secret|password|passwd|token|authorization)\s*[:=]\s*['"]?([A-Za-z0-9._-]{6,})/gi,
  /(Bearer\s+)([A-Za-z0-9._-]+)/gi,
  /(sk-[A-Za-z0-9]{10,})/g
]

function redactSecrets(value) {
  if (!value) return value

  let sanitized = value
  for (const pattern of REDACTION_PATTERNS) {
    sanitized = sanitized.replace(pattern, (_, prefix) => {
      if (typeof prefix === 'string' && prefix.toLowerCase().includes('bearer')) {
        return `${prefix} [REDACTED]`
      }
      return `${prefix}=[REDACTED]`
    })
  }

  return sanitized.replace(/\b(?:AKIA|ASIA)[A-Z0-9]{12,}\b/g, '[AWS_KEY]')
}

function parseTimestamp(line) {
  const timestampMatch = line.match(/\b(\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)\b/i)
  return timestampMatch ? timestampMatch[1] : null
}

function deriveService(line) {
  const serviceHints = [
    /\b(api|gateway|ingress|web|frontend|backend|worker|consumer|scheduler|auth|payments|orders|inventory|db|database|redis|postgres|mysql|mongo|cache)\b/i,
    /\b[a-z0-9-]+-service\b/i,
    /\[(.*?)\]/g
  ]

  for (const pattern of serviceHints) {
    const match = line.match(pattern)
    if (match) {
      const candidate = Array.isArray(match) ? match[0] : match[1]
      if (candidate) {
        return candidate.replace(/\[|\]|\s+/g, '').trim() || 'unknown service'
      }
    }
  }

  return 'unknown service'
}

function buildTitle(service, patterns) {
  const primary = patterns[0]?.toLowerCase() || 'service failure'
  const normalized = primary.replace(/[^a-z0-9\s-]/gi, ' ').trim()
  if (service && service !== 'unknown service') {
    return `${normalized.charAt(0).toUpperCase() + normalized.slice(1)} in ${service}`
  }
  return `${normalized.charAt(0).toUpperCase() + normalized.slice(1)} incident`
}

function buildSeverity(ruleMatches, repeatedErrorCount) {
  const weights = {
    Low: 1,
    Medium: 2,
    High: 3,
    Critical: 4
  }

  let highest = 'Low'
  for (const rule of ruleMatches) {
    if ((weights[rule.severity] || 0) > (weights[highest] || 0)) {
      highest = rule.severity
    }
  }

  if (repeatedErrorCount >= 5) {
    highest = weights[highest] >= weights.High ? highest : 'High'
  }

  return highest
}

export function analyzeLog(logText) {
  if (!logText || !logText.trim()) {
    throw new Error('Log input is empty. Paste log content or upload a file before analyzing.')
  }

  const sanitized = redactSecrets(logText)
  if (Buffer.byteLength(sanitized, 'utf8') > MAX_LOG_SIZE) {
    throw new Error('Log size exceeds the 250 KB safety limit. Reduce the log file size and try again.')
  }

  const lines = sanitized.split(/\r?\n/)
  const matches = []
  const evidence = []
  const detectedPatterns = new Set()
  const timestamps = new Set()
  let repeatedErrorCount = 0

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    const trimmed = line.trim()
    if (!trimmed) continue

    const timestamp = parseTimestamp(trimmed)
    if (timestamp) timestamps.add(timestamp)

    let matchedRule = null
    for (const rule of ruleCatalog) {
      if (rule.patterns.some((pattern) => pattern.test(trimmed))) {
        matchedRule = rule
        break
      }
    }

    if (matchedRule) {
      matchedRule = { ...matchedRule }
      detectedPatterns.add(matchedRule.name)
      matches.push(matchedRule)
      evidence.push({
        lineNumber: index + 1,
        timestamp,
        content: trimmed
      })
      if (/\b(ERROR|FATAL|EXCEPTION|FAILED|TIMEOUT|CRITICAL)\b/i.test(trimmed)) {
        repeatedErrorCount += 1
      }
    }
  }

  const uniqueMatches = matches.filter((rule, index, arr) => arr.findIndex((candidate) => candidate.id === rule.id) === index)
  const service = evidence.length ? deriveService(evidence[0].content) : 'unknown service'
  const severity = buildSeverity(uniqueMatches, repeatedErrorCount)
  const rootCause = uniqueMatches[0]?.cause || 'Evidence indicates a service failure, but the log output is insufficient to determine an exact single root cause.'
  const title = buildTitle(service, uniqueMatches.map((rule) => rule.name))

  const remediationSteps = [
    ...(uniqueMatches[0]?.remediation || []),
    'Validate that the same error is no longer repeated after the mitigation is applied.',
    'Review recent deployment, config, or dependency changes that align with the first observed timestamp.'
  ]

  const verificationSteps = [
    'Confirm the service has recovered and no additional critical errors are appearing in the same time window.',
    'Check the relevant monitoring dashboard for queue depth, latency, memory, and disk pressure.',
    'Verify the incident did not reappear after the remediation action and capture the final state.'
  ]

  return {
    incidentTitle: title,
    severity,
    probableRootCause: rootCause,
    evidence: evidence.slice(0, 8),
    detectedPatterns: Array.from(detectedPatterns),
    affectedService: service,
    remediationSteps,
    verificationSteps,
    suggestedPriority: severity === 'Critical' ? 'P1' : severity === 'High' ? 'P2' : severity === 'Medium' ? 'P3' : 'P4',
    analysisMode: 'rule-based',
    creationTimestamp: new Date().toISOString(),
    metadata: {
      totalLineCount: lines.length,
      matchingLines: evidence.length,
      timestampCount: timestamps.size
    }
  }
}
