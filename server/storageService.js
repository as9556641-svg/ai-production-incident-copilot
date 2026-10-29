import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sqlite3 from 'sqlite3'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const dataDir = path.join(__dirname, '..', 'data')
const dbPath = path.join(dataDir, 'incidents.db')
const jsonPath = path.join(dataDir, 'incidents.json')

let sqliteDb = null
let useJsonFallback = false

function createIncidentId() {
  return `INC-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`
}

function toSerializable(value) {
  if (Array.isArray(value)) return JSON.stringify(value)
  if (value && typeof value === 'object') return JSON.stringify(value)
  return value ?? null
}

function parseJsonField(value) {
  if (!value) return []
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed : [parsed]
  } catch {
    return [value]
  }
}

function normalizeIncident(record) {
  return {
    id: record.id,
    incidentId: record.incident_id || record.incidentId,
    title: record.title || 'Untitled incident',
    severity: record.severity || 'Medium',
    status: record.status || 'Open',
    probableRootCause: record.probable_root_cause || record.probableRootCause || 'Unknown cause',
    evidence: parseJsonField(record.evidence),
    detectedPatterns: parseJsonField(record.detected_patterns || record.detectedPatterns),
    affectedService: record.affected_service || record.affectedService || 'unknown service',
    remediationSteps: parseJsonField(record.remediation_steps || record.remediationSteps),
    verificationSteps: parseJsonField(record.verification_steps || record.verificationSteps),
    suggestedPriority: record.suggested_priority || record.suggestedPriority || 'P3',
    analysisMode: record.analysis_mode || record.analysisMode || 'rule-based',
    createdAt: record.created_at || record.createdAt || new Date().toISOString(),
    updatedAt: record.updated_at || record.updatedAt || new Date().toISOString(),
    rawLog: record.raw_log || record.rawLog || ''
  }
}

function promisifyRun(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(error) {
      if (error) {
        reject(error)
      } else {
        resolve({ lastID: this.lastID, changes: this.changes })
      }
    })
  })
}

function promisifyAll(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (error, rows) => {
      if (error) {
        reject(error)
      } else {
        resolve(rows)
      }
    })
  })
}

async function initSqlite() {
  try {
    await fs.mkdir(dataDir, { recursive: true })
    sqliteDb = new sqlite3.Database(dbPath)
    await new Promise((resolve, reject) => {
      sqliteDb.run(`
        CREATE TABLE IF NOT EXISTS incidents (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          incident_id TEXT UNIQUE NOT NULL,
          title TEXT NOT NULL,
          severity TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'Open',
          probable_root_cause TEXT,
          evidence TEXT,
          detected_patterns TEXT,
          affected_service TEXT,
          remediation_steps TEXT,
          verification_steps TEXT,
          suggested_priority TEXT,
          analysis_mode TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          raw_log TEXT
        )
      `, (error) => {
        if (error) reject(error)
        else resolve()
      })
    })
    return true
  } catch {
    useJsonFallback = true
    return false
  }
}

async function readJsonIncidents() {
  try {
    const content = await fs.readFile(jsonPath, 'utf8')
    const parsed = JSON.parse(content)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

async function writeJsonIncidents(items) {
  await fs.mkdir(dataDir, { recursive: true })
  await fs.writeFile(jsonPath, JSON.stringify(items, null, 2), 'utf8')
}

async function ensureStorage() {
  if (sqliteDb || useJsonFallback) return
  await initSqlite()
}

async function createIncident(data) {
  await ensureStorage()

  const createdAt = data.creationTimestamp || new Date().toISOString()
  const idValue = createIncidentId()
  const incident = {
    incidentId: idValue,
    title: data.incidentTitle || 'Untitled Incident',
    severity: data.severity || 'Medium',
    status: 'Open',
    probableRootCause: data.probableRootCause || 'Root cause not yet confirmed.',
    evidence: Array.isArray(data.evidence) ? data.evidence : [],
    detectedPatterns: Array.isArray(data.detectedPatterns) ? data.detectedPatterns : [],
    affectedService: data.affectedService || 'unknown service',
    remediationSteps: Array.isArray(data.remediationSteps) ? data.remediationSteps : [],
    verificationSteps: Array.isArray(data.verificationSteps) ? data.verificationSteps : [],
    suggestedPriority: data.suggestedPriority || 'P3',
    analysisMode: data.analysisMode || 'rule-based',
    createdAt,
    updatedAt: createdAt,
    rawLog: data.rawLog || ''
  }

  if (useJsonFallback) {
    const incidents = await readJsonIncidents()
    const record = { id: incidents.length ? Math.max(...incidents.map((item) => item.id || 0)) + 1 : 1, ...incident }
    incidents.push(record)
    await writeJsonIncidents(incidents)
    return normalizeIncident(record)
  }

  await promisifyRun(sqliteDb, `
    INSERT INTO incidents (
      incident_id,
      title,
      severity,
      status,
      probable_root_cause,
      evidence,
      detected_patterns,
      affected_service,
      remediation_steps,
      verification_steps,
      suggested_priority,
      analysis_mode,
      created_at,
      updated_at,
      raw_log
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    incident.incidentId,
    incident.title,
    incident.severity,
    incident.status,
    incident.probableRootCause,
    toSerializable(incident.evidence),
    toSerializable(incident.detectedPatterns),
    incident.affectedService,
    toSerializable(incident.remediationSteps),
    toSerializable(incident.verificationSteps),
    incident.suggestedPriority,
    incident.analysisMode,
    incident.createdAt,
    incident.updatedAt,
    incident.rawLog
  ])

  const rows = await promisifyAll(sqliteDb, 'SELECT * FROM incidents WHERE incident_id = ?', [incident.incidentId])
  return normalizeIncident(rows[0])
}

async function getIncidents({ search = '', severity = 'all', status = 'all', page = 1, limit = 8 } = {}) {
  await ensureStorage()

  if (useJsonFallback) {
    const incidents = await readJsonIncidents()
    const filtered = incidents.filter((incident) => {
      const text = `${incident.title} ${incident.affectedService || ''} ${incident.probableRootCause || ''}`.toLowerCase()
      const matchesSearch = !search || text.includes(search.toLowerCase())
      const matchesSeverity = severity === 'all' || incident.severity === severity
      const matchesStatus = status === 'all' || incident.status === status
      return matchesSearch && matchesSeverity && matchesStatus
    })

    const start = (Number(page) - 1) * Number(limit)
    return {
      items: filtered.slice(start, start + Number(limit)).map(normalizeIncident),
      total: filtered.length,
      page: Number(page),
      limit: Number(limit),
      totalPages: Math.max(1, Math.ceil(filtered.length / Number(limit)))
    }
  }

  const clauses = []
  const params = []
  if (search) {
    clauses.push('(title LIKE ? OR affected_service LIKE ? OR probable_root_cause LIKE ?)')
    params.push(`%${search}%`, `%${search}%`, `%${search}%`)
  }
  if (severity && severity !== 'all') {
    clauses.push('severity = ?')
    params.push(severity)
  }
  if (status && status !== 'all') {
    clauses.push('status = ?')
    params.push(status)
  }

  const whereClause = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
  const pageNumber = Number(page) || 1
  const pageLimit = Number(limit) || 8
  const offset = (pageNumber - 1) * pageLimit

  const countRows = await promisifyAll(sqliteDb, `SELECT COUNT(*) AS total FROM incidents ${whereClause}`, params)
  const rows = await promisifyAll(sqliteDb, `SELECT * FROM incidents ${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`, [...params, pageLimit, offset])
  return {
    items: rows.map(normalizeIncident),
    total: Number(countRows[0]?.total || 0),
    page: pageNumber,
    limit: pageLimit,
    totalPages: Math.max(1, Math.ceil((Number(countRows[0]?.total || 0)) / pageLimit))
  }
}

async function getIncidentById(id) {
  await ensureStorage()

  if (useJsonFallback) {
    const incidents = await readJsonIncidents()
    const match = incidents.find((incident) => String(incident.id) === String(id) || incident.incidentId === id)
    return match ? normalizeIncident(match) : null
  }

  const rows = await promisifyAll(sqliteDb, 'SELECT * FROM incidents WHERE id = ? OR incident_id = ?', [id, id])
  return rows.length ? normalizeIncident(rows[0]) : null
}

async function updateIncident(id, updates) {
  await ensureStorage()

  if (useJsonFallback) {
    const incidents = await readJsonIncidents()
    const index = incidents.findIndex((incident) => String(incident.id) === String(id) || incident.incidentId === id)
    if (index === -1) return null

    incidents[index] = {
      ...incidents[index],
      ...updates,
      updatedAt: new Date().toISOString()
    }
    await writeJsonIncidents(incidents)
    return normalizeIncident(incidents[index])
  }

  const fields = []
  const params = []
  if (updates.status) {
    fields.push('status = ?')
    params.push(updates.status)
  }
  if (updates.title) {
    fields.push('title = ?')
    params.push(updates.title)
  }
  if (updates.severity) {
    fields.push('severity = ?')
    params.push(updates.severity)
  }
  if (updates.probableRootCause) {
    fields.push('probable_root_cause = ?')
    params.push(updates.probableRootCause)
  }
  if (updates.analysisMode) {
    fields.push('analysis_mode = ?')
    params.push(updates.analysisMode)
  }
  if (updates.rawLog !== undefined) {
    fields.push('raw_log = ?')
    params.push(updates.rawLog)
  }
  if (fields.length === 0) return null

  fields.push('updated_at = ?')
  params.push(new Date().toISOString(), id)
  await promisifyRun(sqliteDb, `UPDATE incidents SET ${fields.join(', ')} WHERE id = ? OR incident_id = ?`, params)
  return getIncidentById(id)
}

async function deleteIncident(id) {
  await ensureStorage()

  if (useJsonFallback) {
    const incidents = await readJsonIncidents()
    const filtered = incidents.filter((incident) => String(incident.id) !== String(id) && incident.incidentId !== id)
    await writeJsonIncidents(filtered)
    return filtered.length
  }

  await promisifyRun(sqliteDb, 'DELETE FROM incidents WHERE id = ? OR incident_id = ?', [id, id])
  return true
}

async function clearIncidents() {
  await ensureStorage()

  if (useJsonFallback) {
    await writeJsonIncidents([])
    return true
  }

  await promisifyRun(sqliteDb, 'DELETE FROM incidents')
  return true
}

async function getStats() {
  await ensureStorage()

  if (useJsonFallback) {
    const incidents = await readJsonIncidents()
    const total = incidents.length
    const critical = incidents.filter((incident) => incident.severity === 'Critical').length
    const high = incidents.filter((incident) => incident.severity === 'High').length
    const open = incidents.filter((incident) => incident.status === 'Open').length
    const resolved = incidents.filter((incident) => incident.status === 'Resolved').length
    const severityDistribution = {
      Critical: incidents.filter((incident) => incident.severity === 'Critical').length,
      High: incidents.filter((incident) => incident.severity === 'High').length,
      Medium: incidents.filter((incident) => incident.severity === 'Medium').length,
      Low: incidents.filter((incident) => incident.severity === 'Low').length
    }
    return { total, critical, high, open, resolved, severityDistribution }
  }

  const rows = await promisifyAll(sqliteDb, `
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN severity = 'Critical' THEN 1 ELSE 0 END) AS critical,
      SUM(CASE WHEN severity = 'High' THEN 1 ELSE 0 END) AS high,
      SUM(CASE WHEN status = 'Open' THEN 1 ELSE 0 END) AS open,
      SUM(CASE WHEN status = 'Resolved' THEN 1 ELSE 0 END) AS resolved
    FROM incidents
  `)

  const severityRows = await promisifyAll(sqliteDb, `
    SELECT severity, COUNT(*) AS total FROM incidents GROUP BY severity
  `)

  const severityDistribution = { Critical: 0, High: 0, Medium: 0, Low: 0 }
  for (const row of severityRows) {
    if (severityDistribution[row.severity] !== undefined) {
      severityDistribution[row.severity] = Number(row.total)
    }
  }

  const result = rows[0] || {}
  return {
    total: Number(result.total || 0),
    critical: Number(result.critical || 0),
    high: Number(result.high || 0),
    open: Number(result.open || 0),
    resolved: Number(result.resolved || 0),
    severityDistribution
  }
}

export const storage = {
  createIncident,
  getIncidents,
  getIncidentById,
  updateIncident,
  deleteIncident,
  clearIncidents,
  getStats,
  initialize: ensureStorage
}

export default storage
