import { useCallback, useEffect, useMemo, useState } from 'react'
import { Activity, AlertTriangle, BarChart3, BellRing, CheckCircle2, CircleDashed, Gauge, LayoutDashboard, Menu, ShieldCheck, Sparkles, Trash2, UploadCloud, XCircle, Download, Copy, Server, Search, FileText, Settings, Cpu, HardDrive, PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { BarChart, Bar, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import './App.css'

const NAV_ITEMS = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'analyze', label: 'Analyze Logs', icon: FileText },
  { id: 'history', label: 'Incident History', icon: Activity },
  { id: 'reports', label: 'Reports', icon: BarChart3 },
  { id: 'settings', label: 'Settings', icon: Settings }
]

const SAMPLE_LOGS = {
  db: `2026-10-29T09:12:34Z INFO Starting database migration
2026-10-29T09:12:45Z ERROR Failed to connect to database primary: connection refused
2026-10-29T09:12:46Z ERROR Timeout while connecting to postgres.prod.internal:5432
2026-10-29T09:12:48Z FATAL Database connection failed for api-gateway service after 3 retries`,
  http500: `2026-10-29T11:40:17Z WARN Request to /checkout started
2026-10-29T11:40:19Z ERROR HTTP 500 Internal Server Error from checkout-api
2026-10-29T11:40:20Z ERROR Unhandled exception in thread worker-3: ValueError: order total invalid
2026-10-29T11:40:21Z ERROR Traceback (most recent call last): ...
2026-10-29T11:40:24Z WARN Retry policy triggered for order submission`,
  memory: `2026-10-29T08:07:09Z ERROR Out of memory condition detected in worker-7
2026-10-29T08:07:12Z FATAL Killed process due to memory limit exceeded
2026-10-29T08:07:15Z WARN oom-killer invoked for java-worker-1
2026-10-29T08:07:20Z ERROR Cannot allocate memory for object cache` 
}

const initialStats = {
  total: 0,
  critical: 0,
  high: 0,
  open: 0,
  resolved: 0,
  severityDistribution: { Critical: 0, High: 0, Medium: 0, Low: 0 }
}

const severityStyles = {
  Critical: 'severity-critical',
  High: 'severity-high',
  Medium: 'severity-medium',
  Low: 'severity-low',
  Open: 'status-open',
  Investigating: 'status-investigating',
  Resolved: 'status-resolved'
}

const severityOrder = ['Critical', 'High', 'Medium', 'Low']

function formatDate(value) {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

async function fetchJson(url, options) {
  const response = await fetch(url, options)
  const text = await response.text()
  let payload = null
  try {
    payload = text ? JSON.parse(text) : null
  } catch {
    payload = { message: text }
  }

  if (!response.ok) {
    throw new Error(payload?.error || payload?.message || 'Request failed.')
  }

  return payload
}

function App() {
  const [activePage, setActivePage] = useState('overview')
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [stats, setStats] = useState(initialStats)
  const [incidents, setIncidents] = useState([])
  const [health, setHealth] = useState({ status: 'checking', analysisMode: 'rule-based' })
  const [loading, setLoading] = useState(false)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [search, setSearch] = useState('')
  const [severityFilter, setSeverityFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [logText, setLogText] = useState(SAMPLE_LOGS.db)
  const [analysisResult, setAnalysisResult] = useState(null)
  const [uploading, setUploading] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [successMessage, setSuccessMessage] = useState('')
  const [selectedIncidentId, setSelectedIncidentId] = useState(null)

  const loadStats = useCallback(async () => {
    try {
      const data = await fetchJson('http://localhost:3001/api/stats')
      setStats(data)
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error))
    }
  }, [])

  const loadIncidents = useCallback(async () => {
    try {
      setLoading(true)
      const data = await fetchJson(`http://localhost:3001/api/incidents?search=${encodeURIComponent(search)}&severity=${encodeURIComponent(severityFilter)}&status=${encodeURIComponent(statusFilter)}&page=${page}&limit=8`)
      setIncidents(data.items || [])
      setTotalPages(data.totalPages || 1)
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setLoading(false)
    }
  }, [page, search, severityFilter, statusFilter])

  useEffect(() => {
    const fetchHealth = async () => {
      try {
        const result = await fetchJson('http://localhost:3001/api/health')
        setHealth(result)
      } catch (error) {
        setHealth({ status: 'offline', analysisMode: 'rule-based', error: error instanceof Error ? error.message : String(error) })
      }
    }

    fetchHealth()
    loadStats()
    loadIncidents()
  }, [loadIncidents, loadStats])

  const chartData = useMemo(
    () =>
      severityOrder.map((key) => ({
        name: key,
        count: stats.severityDistribution?.[key] || 0
      })),
    [stats]
  )

  const currentIncident = useMemo(
    () => incidents.find((incident) => incident.id === selectedIncidentId) || null,
    [incidents, selectedIncidentId]
  )

  async function handleAnalyze(logInput) {
    try {
      setErrorMessage('')
      setSuccessMessage('')
      const response = await fetchJson('http://localhost:3001/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ logText: logInput })
      })
      setAnalysisResult(response.report || response.incident)
      await loadStats()
      await loadIncidents()
      setSuccessMessage('Analysis complete. Incident was saved to the incident history.')
      setActivePage('history')
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error))
    }
  }

  async function handleStatusUpdate(id, status) {
    try {
      const result = await fetchJson(`http://localhost:3001/api/incidents/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status })
      })
      if (result.incident) {
        setSelectedIncidentId(result.incident.id)
      }
      await loadStats()
      await loadIncidents()
      setSuccessMessage('Incident status updated successfully.')
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error))
    }
  }

  async function handleDelete(id) {
    if (!window.confirm('Delete this incident? This action cannot be undone.')) return
    try {
      await fetchJson(`http://localhost:3001/api/incidents/${id}`, { method: 'DELETE' })
      await loadStats()
      await loadIncidents()
      setSelectedIncidentId(null)
      setSuccessMessage('Incident deleted successfully.')
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error))
    }
  }

  async function handleClearHistory() {
    if (!window.confirm('Clear all incident history?')) return
    try {
      await fetchJson('http://localhost:3001/api/incidents/clear', { method: 'DELETE' })
      setSelectedIncidentId(null)
      await loadStats()
      await loadIncidents()
      setSuccessMessage('Incident history cleared.')
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error))
    }
  }

  const handleFileUpload = async (event) => {
    const file = event.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      const text = await file.text()
      setLogText(text)
      setSuccessMessage(`Loaded ${file.name} (${text.length} chars).`)
    } catch {
      setErrorMessage('Unable to read the uploaded file.')
    } finally {
      setUploading(false)
      event.target.value = ''
    }
  }

  const handleCopy = async () => {
    if (!analysisResult) return
    const text = JSON.stringify(analysisResult, null, 2)
    try {
      await navigator.clipboard.writeText(text)
      setSuccessMessage('Analysis report copied to clipboard.')
    } catch {
      setErrorMessage('Clipboard access is unavailable in this browser.')
    }
  }

  const handleDownloadJson = () => {
    if (!analysisResult) return
    const blob = new Blob([JSON.stringify(analysisResult, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = 'incident-report.json'
    anchor.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="app-shell">
      <aside className={`sidebar ${sidebarOpen ? 'open' : 'collapsed'}`}>
        <div className="brand-row">
          <div className="brand-mark">AI</div>
          {sidebarOpen && <div className="brand-copy"><strong>AI Production</strong><span>Incident Copilot</span></div>}
          <button className="icon-button compact" onClick={() => setSidebarOpen((value) => !value)}>
            {sidebarOpen ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />}
          </button>
        </div>
        <nav className="sidebar-nav">
          {NAV_ITEMS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              className={`nav-item ${activePage === id ? 'active' : ''}`}
              onClick={() => setActivePage(id)}
            >
              <Icon size={18} />
              {sidebarOpen && <span>{label}</span>}
            </button>
          ))}
        </nav>
      </aside>

      <main className="main-panel">
        <header className="topbar">
          <div className="header-left">
            <button className="icon-button mobile-menu" onClick={() => setSidebarOpen((value) => !value)}>
              <Menu size={18} />
            </button>
            <div>
              <p className="eyebrow">Operations overview</p>
              <h1>
                {activePage === 'overview' && 'Overview'}
                {activePage === 'analyze' && 'Analyze Logs'}
                {activePage === 'history' && 'Incident History'}
                {activePage === 'reports' && 'Reports'}
                {activePage === 'settings' && 'Settings'}
              </h1>
            </div>
          </div>
          <div className="header-right">
            <div className={`status-pill ${health.status === 'ok' ? 'online' : 'offline'}`}>
              <Server size={14} />
              <span>{health.status === 'ok' ? 'Backend Healthy' : 'Backend Offline'}</span>
            </div>
            <div className="mode-pill">
              <Sparkles size={14} />
              <span>{health.analysisMode === 'ai-assisted' ? 'AI-assisted' : 'Rule-based'}</span>
            </div>
          </div>
        </header>

        {errorMessage && <div className="message-banner error">{errorMessage}</div>}
        {successMessage && <div className="message-banner success">{successMessage}</div>}

        {activePage === 'overview' && (
          <>
            <section className="stat-grid">
              <StatCard label="Total incidents" value={stats.total} tone="indigo" icon={Activity} />
              <StatCard label="Critical" value={stats.critical} tone="red" icon={AlertTriangle} />
              <StatCard label="High-severity" value={stats.high} tone="amber" icon={BellRing} />
              <StatCard label="Open" value={stats.open} tone="cyan" icon={CircleDashed} />
              <StatCard label="Resolved" value={stats.resolved} tone="green" icon={CheckCircle2} />
            </section>

            <section className="content-grid two-col">
              <div className="panel">
                <div className="panel-head">
                  <h2>Severity Distribution</h2>
                </div>
                <div className="chart-wrap">
                  <ResponsiveContainer width="100%" height={250}>
                    <BarChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.15)" />
                      <XAxis dataKey="name" stroke="#94a3b8" />
                      <YAxis allowDecimals={false} stroke="#94a3b8" />
                      <Tooltip />
                      <Bar dataKey="count" fill="#64d2ff" radius={[8, 8, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="panel">
                <div className="panel-head">
                  <h2>Operational Health</h2>
                </div>
                <ul className="health-list">
                  <li><Gauge size={16} /> Backend status <strong>{health.status === 'ok' ? 'Operational' : 'Offline'}</strong></li>
                  <li><Cpu size={16} /> Analysis mode <strong>{health.analysisMode === 'ai-assisted' ? 'AI-assisted' : 'Rule-based'}</strong></li>
                  <li><HardDrive size={16} /> Storage <strong>{stats.total > 0 ? 'Persisted' : 'Empty'}</strong></li>
                  <li><ShieldCheck size={16} /> Review policy <strong>Evidence-based</strong></li>
                </ul>
              </div>
            </section>

            <section className="panel">
              <div className="panel-head with-actions">
                <h2>Recent Incidents</h2>
                <button className="secondary-button" onClick={() => setActivePage('history')}>Open History</button>
              </div>
              {incidents.length === 0 ? (
                <EmptyState title="No incidents recorded yet" description="Analyze a log or upload a file to create the first incident record." />
              ) : (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Incident</th>
                        <th>Title</th>
                        <th>Severity</th>
                        <th>Status</th>
                        <th>Created</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {incidents.slice(0, 5).map((incident) => (
                        <tr key={incident.id}>
                          <td>{incident.incidentId || incident.id}</td>
                          <td>{incident.title}</td>
                          <td><span className={`badge ${severityStyles[incident.severity] || 'severity-medium'}`}>{incident.severity}</span></td>
                          <td><span className={`badge ${severityStyles[incident.status] || 'status-open'}`}>{incident.status}</span></td>
                          <td>{formatDate(incident.createdAt)}</td>
                          <td><button className="link-button" onClick={() => { setSelectedIncidentId(incident.id); setActivePage('history') }}>Open</button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </>
        )}

        {activePage === 'analyze' && (
          <section className="analysis-page">
            <div className="panel log-panel">
              <div className="panel-head with-actions">
                <h2>Log Editor</h2>
                <div className="action-group">
                  <button className="secondary-button" onClick={() => setLogText('')}>Clear</button>
                  <label className="primary-button upload-button">
                    <UploadCloud size={16} /> Upload
                    <input type="file" accept=".log,.txt" onChange={handleFileUpload} />
                  </label>
                </div>
              </div>

              <div className="sample-buttons">
                <button className="sample-chip" onClick={() => setLogText(SAMPLE_LOGS.db)}>Database failure</button>
                <button className="sample-chip" onClick={() => setLogText(SAMPLE_LOGS.http500)}>HTTP 500 app exception</button>
                <button className="sample-chip" onClick={() => setLogText(SAMPLE_LOGS.memory)}>High CPU / OOM</button>
              </div>

              <textarea value={logText} onChange={(event) => setLogText(event.target.value)} placeholder="Paste logs here..." />
              <div className="editor-meta">
                <span>{logText.length} chars</span>
                <span>{logText.split(/\r?\n/).length} lines</span>
              </div>
              <button className="primary-button analyze-button" onClick={() => handleAnalyze(logText)} disabled={uploading || !logText.trim()}>
                {uploading ? 'Loading...' : 'Analyze Logs'}
              </button>
            </div>

            {analysisResult && (
              <div className="panel result-panel">
                <div className="panel-head with-actions">
                  <h2>{analysisResult.incidentTitle || analysisResult.title}</h2>
                  <div className="action-group">
                    <button className="secondary-button" onClick={handleCopy}><Copy size={15} /> Copy</button>
                    <button className="secondary-button" onClick={handleDownloadJson}><Download size={15} /> JSON</button>
                  </div>
                </div>
                <div className="result-grid">
                  <div><span>Severity</span><strong>{analysisResult.severity}</strong></div>
                  <div><span>Priority</span><strong>{analysisResult.suggestedPriority}</strong></div>
                  <div><span>Root cause</span><strong>{analysisResult.probableRootCause}</strong></div>
                  <div><span>Service</span><strong>{analysisResult.affectedService}</strong></div>
                  <div><span>Mode</span><strong>{analysisResult.analysisMode}</strong></div>
                  <div><span>Created</span><strong>{formatDate(analysisResult.creationTimestamp)}</strong></div>
                </div>
                <section>
                  <h3>Detected patterns</h3>
                  <div className="tag-row">
                    {(analysisResult.detectedPatterns || []).map((pattern) => <span className="tag" key={pattern}>{pattern}</span>)}
                  </div>
                </section>
                <section>
                  <h3>Evidence</h3>
                  <ul className="detail-list">
                    {(analysisResult.evidence || []).map((item, index) => (
                      <li key={`${item.lineNumber}-${index}`}>
                        <span>{item.lineNumber || index + 1}</span>
                        <code>{item.content}</code>
                      </li>
                    ))}
                  </ul>
                </section>
                <section>
                  <h3>Recommended remediation</h3>
                  <ul className="bullet-list">
                    {(analysisResult.remediationSteps || []).map((step) => <li key={step}>{step}</li>)}
                  </ul>
                </section>
                <section>
                  <h3>Verification checklist</h3>
                  <ul className="bullet-list">
                    {(analysisResult.verificationSteps || []).map((step) => <li key={step}>{step}</li>)}
                  </ul>
                </section>
              </div>
            )}
          </section>
        )}

        {activePage === 'history' && (
          <section className="panel">
            <div className="panel-head with-actions filters-row">
              <h2>Incident Timeline</h2>
              <div className="filter-controls">
                <div className="search-box">
                  <Search size={15} />
                  <input value={search} onChange={(event) => { setPage(1); setSearch(event.target.value) }} placeholder="Search incidents" />
                </div>
                <select value={severityFilter} onChange={(event) => { setPage(1); setSeverityFilter(event.target.value) }}>
                  <option value="all">All severities</option>
                  {severityOrder.map((level) => <option key={level} value={level}>{level}</option>)}
                </select>
                <select value={statusFilter} onChange={(event) => { setPage(1); setStatusFilter(event.target.value) }}>
                  <option value="all">All statuses</option>
                  <option value="Open">Open</option>
                  <option value="Investigating">Investigating</option>
                  <option value="Resolved">Resolved</option>
                </select>
              </div>
            </div>

            {loading ? <div className="loading-box">Loading incidents...</div> : incidents.length === 0 ? (
              <EmptyState title="No matching incidents" description="Refine filters or analyze a new log to populate the history." />
            ) : (
              <>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Incident ID</th>
                        <th>Title</th>
                        <th>Severity</th>
                        <th>Status</th>
                        <th>Created</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {incidents.map((incident) => (
                        <tr key={incident.id}>
                          <td>{incident.incidentId || incident.id}</td>
                          <td>{incident.title}</td>
                          <td><span className={`badge ${severityStyles[incident.severity] || 'severity-medium'}`}>{incident.severity}</span></td>
                          <td><span className={`badge ${severityStyles[incident.status] || 'status-open'}`}>{incident.status}</span></td>
                          <td>{formatDate(incident.createdAt)}</td>
                          <td className="action-cell">
                            <button className="link-button" onClick={() => setSelectedIncidentId(incident.id)}>View</button>
                            <select value={incident.status} onChange={(event) => handleStatusUpdate(incident.id, event.target.value)}>
                              <option value="Open">Open</option>
                              <option value="Investigating">Investigating</option>
                              <option value="Resolved">Resolved</option>
                            </select>
                            <button className="icon-button danger" onClick={() => handleDelete(incident.id)}><Trash2 size={14} /></button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="pager-row">
                  <button className="secondary-button" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={page === 1}>Previous</button>
                  <span>Page {page} / {totalPages}</span>
                  <button className="secondary-button" onClick={() => setPage((value) => Math.min(totalPages, value + 1))} disabled={page >= totalPages}>Next</button>
                </div>
              </>
            )}

            {currentIncident && (
              <div className="modal-backdrop" onClick={() => setSelectedIncidentId(null)}>
                <div className="incident-modal" onClick={(event) => event.stopPropagation()}>
                  <div className="panel-head with-actions">
                    <h3>{currentIncident.title}</h3>
                    <button className="icon-button" onClick={() => setSelectedIncidentId(null)}><XCircle size={16} /></button>
                  </div>
                  <div className="modal-grid">
                    <div><span>ID</span><strong>{currentIncident.incidentId || currentIncident.id}</strong></div>
                    <div><span>Severity</span><strong>{currentIncident.severity}</strong></div>
                    <div><span>Status</span><strong>{currentIncident.status}</strong></div>
                    <div><span>Service</span><strong>{currentIncident.affectedService}</strong></div>
                  </div>
                  <section>
                    <h4>Probable root cause</h4>
                    <p>{currentIncident.probableRootCause}</p>
                  </section>
                  <section>
                    <h4>Evidence</h4>
                    <ul className="bullet-list">
                      {(currentIncident.evidence || []).map((item, index) => <li key={`${item.lineNumber}-${index}`}>{item.content}</li>)}
                    </ul>
                  </section>
                  <section>
                    <h4>Recommended remediation</h4>
                    <ul className="bullet-list">
                      {(currentIncident.remediationSteps || []).map((step) => <li key={step}>{step}</li>)}
                    </ul>
                  </section>
                </div>
              </div>
            )}
          </section>
        )}

        {activePage === 'reports' && (
          <section className="panel reports-panel">
            <div className="panel-head with-actions">
              <h2>Report Export</h2>
              <div className="action-group">
                <button className="secondary-button" onClick={() => window.open('http://localhost:3001/api/incidents/report', '_blank')}>Download JSON</button>
              </div>
            </div>
            {incidents.length === 0 ? (
              <EmptyState title="No report available" description="Create an incident first to generate structured exports." />
            ) : (
              <div className="report-box">
                <div className="report-metric"><span>Total</span><strong>{stats.total}</strong></div>
                <div className="report-metric"><span>Critical</span><strong>{stats.critical}</strong></div>
                <div className="report-metric"><span>High</span><strong>{stats.high}</strong></div>
                <div className="report-metric"><span>Open</span><strong>{stats.open}</strong></div>
              </div>
            )}
          </section>
        )}

        {activePage === 'settings' && (
          <section className="settings-grid">
            <div className="panel">
              <div className="panel-head">
                <h2>System state</h2>
              </div>
              <ul className="health-list compact">
                <li><Server size={16} /> Backend health <strong>{health.status === 'ok' ? 'Healthy' : 'Offline'}</strong></li>
                <li><Sparkles size={16} /> Analysis mode <strong>{health.analysisMode === 'ai-assisted' ? 'AI-assisted' : 'Rule-based'}</strong></li>
                <li><ShieldCheck size={16} /> AI configuration <strong>{health.analysisMode === 'ai-assisted' ? 'Available' : 'Unavailable'}</strong></li>
              </ul>
            </div>
            <div className="panel">
              <div className="panel-head">
                <h2>Safe configuration</h2>
              </div>
              <p className="settings-copy">Set the environment variable <code>AI_API_KEY</code> or <code>OPENAI_API_KEY</code> on the backend host only. Never commit secrets into the repository or expose them to the browser.</p>
            </div>
            <div className="panel danger-panel">
              <div className="panel-head">
                <h2>Clear incident history</h2>
              </div>
              <button className="danger-button" onClick={handleClearHistory}>Clear all incidents</button>
            </div>
          </section>
        )}
      </main>
    </div>
  )
}

function StatCard({ label, value, tone, icon: Icon }) {
  return (
    <div className="stat-card">
      <div className={`stat-icon ${tone}`}><Icon size={16} /></div>
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
      </div>
    </div>
  )
}

function EmptyState({ title, description }) {
  return (
    <div className="empty-state">
      <FileText size={28} />
      <h3>{title}</h3>
      <p>{description}</p>
    </div>
  )
}

export default App
