export const ruleCatalog = [
  {
    id: 'fatal-error',
    name: 'Fatal or panic condition',
    severity: 'Critical',
    patterns: [/\bFATAL\b/i, /\bpanic\b/i, /SIGKILL|SIGABRT/i, /process.*(exited|terminated|crashed)/i],
    cause: 'A critical service process exited unexpectedly or entered a panic state.',
    remediation: [
      'Restart the affected service after confirming the root cause and deployment state.',
      'Check recent deployments, config changes, or crash loops linked to the failing process.',
      'Review crash dumps, exit codes, and runtime logs before redeploying to production.'
    ]
  },
  {
    id: 'database-failure',
    name: 'Database connection failure',
    severity: 'Critical',
    patterns: [/database connection failed/i, /could not connect to .*database/i, /connection refused/i, /ECONNREFUSED/i, /connect(e|ing) .*database.*(failed|timeout|error)/i, /password authentication failed/i, /timeout while connecting to .*database/i],
    cause: 'The application could not establish or sustain a database connection.',
    remediation: [
      'Verify the target database host, port, credentials, and network reachability.',
      'Check database health, replication lag, authentication settings, and recent schema changes.',
      'If the service is degraded, reduce load or fail over to a healthy database replica.'
    ]
  },
  {
    id: 'http-500',
    name: 'HTTP 5xx application errors',
    severity: 'High',
    patterns: [/HTTP\s+5(0|0[0-9]|[1-9][0-9])\b/i, /status\s+5(0|0[0-9]|[1-9][0-9])/i, /Internal Server Error/i, /Application Error/i, /Unhandled exception/i, /exception in thread/i],
    cause: 'The application raised unhandled exceptions or downstream dependencies returned 5xx responses.',
    remediation: [
      'Trace the failing request ID and correlate the stack trace with the relevant service call.',
      'Review recent application deploys, dependency changes, and external service outages.',
      'Add focused telemetry and retries only where safe to protect affected workflows.'
    ]
  },
  {
    id: 'http-502-503-504',
    name: 'Upstream or gateway failure',
    severity: 'High',
    patterns: [/HTTP\s+50[234]\b/i, /502 Bad Gateway/i, /503 Service Unavailable/i, /504 Gateway Timeout/i, /upstream.*(timeout|unavailable|failed)/i, /gateway.*(timeout|error)/i],
    cause: 'An upstream service, reverse proxy, or ingress route failed or timed out.',
    remediation: [
      'Inspect upstream dependency health and ingress or load balancer metrics to isolate the failing hop.',
      'Confirm whether the outage is isolated to one microservice or a shared edge component.',
      'Increase observability around retries and timeout budgets before scaling or redeploying.'
    ]
  },
  {
    id: 'oom',
    name: 'Out-of-memory condition',
    severity: 'Critical',
    patterns: [/out of memory/i, /oom\b/i, /memory limit exceeded/i, /Killed process/i, /cannot allocate memory/i, /malloc\s*failed/i],
    cause: 'The runtime exhausted memory and began killing or failing workloads.',
    remediation: [
      'Check process memory usage, heap trends, and recent memory-heavy deployments or jobs.',
      'Limit concurrent workers or expand resource quotas where the service is genuinely memory-bound.',
      'Inspect for leak conditions or unbounded data loads that can consume memory.'
    ]
  },
  {
    id: 'disk-space',
    name: 'Disk space exhaustion',
    severity: 'High',
    patterns: [/No space left on device/i, /disk full/i, /ENOSPC/i, /out of disk space/i, /disk.*(full|exhausted)/i],
    cause: 'The node or service hit disk pressure and could not continue normal operations.',
    remediation: [
      'Free disk space or expand the backing volume before continuing business-critical writes.',
      'Review log retention, temporary storage, and backup cleanup policies.',
      'Add capacity alerts to detect this condition earlier in future incidents.'
    ]
  },
  {
    id: 'permission',
    name: 'Permission or file access error',
    severity: 'Medium',
    patterns: [/permission denied/i, /EACCES/i, /operation not permitted/i, /access denied/i, /cannot open.*(file|directory)/i],
    cause: 'The process lacked the required filesystem or OS permissions to proceed.',
    remediation: [
      'Verify the service identity and effective file ownership or ACL configuration.',
      'Review any recent permission changes, mounts, or security hardening policies.',
      'Test a minimal read/write action to confirm the corrected access path.'
    ]
  },
  {
    id: 'timeout',
    name: 'Timeout condition',
    severity: 'Medium',
    patterns: [/timed out/i, /timeout exceeded/i, /request timed out/i, /deadline exceeded/i, /operation timed out/i],
    cause: 'A request, dependency call, or queued task exceeded a timeout threshold.',
    remediation: [
      'Check downstream service latency and network reliability for the timed-out dependency.',
      'Review timeout budgets and retries to avoid noisy false failures under load.',
      'Make sure queued work and backpressure controls are aligned with the current traffic profile.'
    ]
  },
  {
    id: 'warn',
    name: 'Warning-level instability',
    severity: 'Low',
    patterns: [/\bWARN\b/i, /warning/i, /retrying/i],
    cause: 'The system signalled degraded health or degraded resilience but has not yet failed outright.',
    remediation: [
      'Monitor the warning trend and correlate it with recent changes or traffic spikes.',
      'Review the underlying endpoint or subsystem before it reaches an error threshold.',
      'Add proactive alerting if this warning becomes recurrent.'
    ]
  }
]
