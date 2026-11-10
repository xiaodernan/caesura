/**
 * scripts/spring-config-server.mjs - Spring Cloud Config Server client (Node.js side).
 *
 * It does not make judgments, only acts as a Config Server simulator: reads configuration
 * from local YAML/JSON files and serves them in Spring Cloud Config Server REST API format,
 * for Node.js side clients such as spring-config-client to use during development and testing
 * without a real Spring Boot server. All business thresholds and judgments remain the
 * responsibility of the Node side; the Spring family is only responsible for orchestration/reporting.
 *
 * Supported endpoints:
 *   GET /{application}/{profile}/{label}   - Get config for a specific app/env/label (Spring Cloud Config standard)
 *   /health                               - Health check endpoint
 *   /                                     - Root path, returns server info
 *   GET /config/{application}             - Get all config versions for a given application
 *   POST /config/{application}/refresh    - Trigger config hot-refresh for a given application
 *   GET /config/{application}/versions    - Get config version list for a given application
 *   POST /config/{application}/rollback   - Roll back specified application to a specified version
 *
 * Usage:
 *   node scripts/spring-config-server.mjs [config-dir] [port]
 *   e.g.: node scripts/spring-config-server.mjs ./config 8888
 *   e.g.: node scripts/spring-config-server.mjs   8888          (use default ./config directory)
 *
 * Exit codes: 0 = started successfully, 1 = startup failed, 2 = usage error.
 */

import { createServer as httpCreateServer } from 'node:http'
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs'
import { join, extname } from 'node:path'

/** Default config directory */
const DEFAULT_CONFIG_DIR = './config'
/** Default listen port */
const DEFAULT_PORT = 8888
/** Config file change detection interval (ms) */
const WATCH_INTERVAL_MS = 2000

/**
 * Read all YAML/JSON files in the config directory, organized by app name (filename without extension).
 *
 * @param {string} dir Config directory path
 * @returns {Record<string, Record<string, unknown>>} Config map keyed by app name
 */
function loadConfigs(dir) {
  const configs = {}
  try {
    const files = readdirSync(dir)
    for (const file of files) {
      const ext = extname(file).toLowerCase()
      if (ext !== '.yml' && ext !== '.yaml' && ext !== '.json') continue
      const name = file.replace(ext, '')
      const content = readFileSync(join(dir, file), 'utf8')
      let parsed
      if (ext === '.json') {
        parsed = JSON.parse(content)
      } else {
        parsed = parseSimpleYaml(content)
      }
      configs[name] = parsed
    }
  } catch (e) {
    // Directory does not exist or read failed, return empty map
  }
  return configs
}

/**
 * Simple YAML parser: supports key: value format simple YAML.
 * Does not support complex nesting, lists, anchors, etc.
 */
function parseSimpleYaml(text) {
  const result = {}
  const lines = text.split(/\r?\n/)
  let currentSection = null

  for (const line of lines) {
    // Nested key-value pair (two-space indent) - must check before trim
    const indentMatch = line.match(/^(\s+)(\S+)\s*:\s*(.*)$/)
    if (indentMatch && currentSection) {
      const [, indent, key, value] = indentMatch
      if (indent.length >= 2) {
        if (!result[currentSection] || typeof result[currentSection] !== 'object') {
          result[currentSection] = {}
        }
        result[currentSection][key.trim()] = parseYamlValue(value.trim())
      }
      continue
    }

    // Top-level key-value (trim first)
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue

    const topMatch = trimmed.match(/^(\S+)\s*:\s*(.*)$/)
    if (topMatch) {
      const [, key, value] = topMatch
      currentSection = key.trim()
      if (value.trim() === '') {
        result[key.trim()] = {}
      } else {
        result[key.trim()] = parseYamlValue(value.trim())
      }
    }
  }

  return result
}

/** Parse YAML value string into JS type */
function parseYamlValue(value) {
  if (value === '' || value === null || value === undefined) return value
  if (value === 'true') return true
  if (value === 'false') return false
  if (value === 'null' || value === '~') return null
  const num = Number(value)
  if (!isNaN(num)) return num
  return value
}

/**
 * Look up config by app name, environment, label. Spring Cloud Config Server name lookup order:
 *   1. {application}-{profile}.yml
 *   2. {application}.yml
 *   3. application.yml
 *
 * @param {string} appName App name
 * @param {string} profile Environment name (e.g. dev, prod)
 * @param {string} label Label name (e.g. master, develop)
 * @param {Record<string, Record<string, unknown>>} configs Config map
 * @returns {Record<string, unknown>|undefined} Matching config
 */
function findConfig(appName, profile, label, configs) {
  const candidates = [`${appName}-${profile}`, appName, 'application']
  for (const name of candidates) {
    if (configs[name]) {
      return configs[name]
    }
  }
  return undefined
}

/**
 * Build Spring Cloud Config Server style response body.
 *
 * @param {string} application App name
 * @param {string} profile Environment name
 * @param {string} label Label name
 * @param {Record<string, unknown>} config Config content
 * @returns {object} Spring Cloud Config Server style response body
 */
function buildConfigResponse(application, profile, label, config) {
  return {
    name: application,
    profiles: [profile],
    label: label || 'master',
    version: config.version || '1',
    state: null,
    propertySources: [
      {
        name: `${application}-${profile}`,
        source: config,
      },
    ],
  }
}

/**
 * Create HTTP server.
 *
 * @param {Record<string, Record<string, unknown>>} configs Config map
 * @returns {import('http').Server} HTTP server instance
 */
function createServer(configs) {
  // Config version history: { appName: { version: timestamp, configs: {...} }[] }
  const configHistory = new Map()
  // Config file mtime: { filePath: mtime }
  const fileMtimes = new Map()
  // Config change listeners: { appName: Set<callback> }
  const configWatchers = new Map()

  /**
   * Load a specific config file
   */
  function loadConfigFile(filePath) {
    try {
      const content = readFileSync(filePath, 'utf8')
      const ext = extname(filePath).toLowerCase()
      let parsed
      if (ext === '.json') {
        parsed = JSON.parse(content)
      } else {
        parsed = parseSimpleYaml(content)
      }
      const name = filePath.split('/').pop().replace(ext, '')
      configs[name] = parsed
      return { name, config: parsed }
    } catch (e) {
      return null
    }
  }

  /**
   * Scan config directory, load all config files
   */
  function scanConfigs(dir, onChange) {
    try {
      const files = readdirSync(dir)
      for (const file of files) {
        const ext = extname(file).toLowerCase()
        if (ext !== '.yml' && ext !== '.yaml' && ext !== '.json') continue
        const filePath = join(dir, file)
        const stat = statSync(filePath)
        const fileKey = join(dir, file)

        // Check if file has changed
        const prevMtime = fileMtimes.get(fileKey)
        const currMtime = stat.mtimeMs
        if (prevMtime !== undefined && prevMtime === currMtime) {
          continue // File unchanged, skip
        }

        fileMtimes.set(fileKey, currMtime)
        const result = loadConfigFile(filePath)
        if (result) {
          // Record config change history
          recordConfigChange(result.name, result.config, fileKey)
          // Notify watchers
          notifyConfigWatchers(result.name, result.config)
          // Notify global callback
          if (onChange) {
            try {
              onChange(result.name, result.config)
            } catch (e) {
              // Ignore callback errors
            }
          }
        }
      }
    } catch (e) {
      // Directory does not exist or read failed, ignore
    }
  }

  /**
   * Record config change history
   */
  function recordConfigChange(appName, config, fileKey) {
    if (!configHistory.has(appName)) {
      configHistory.set(appName, [])
    }
    const history = configHistory.get(appName)
    const version = Date.now()
    history.push({
      version: version.toString(),
      timestamp: version,
      config: JSON.parse(JSON.stringify(config)), // Deep copy
      source: fileKey,
    })
    // Keep only last 50 versions
    if (history.length > 50) {
      history.shift()
    }
  }

  /**
   * Notify config watchers
   */
  function notifyConfigWatchers(appName, config) {
    const watchers = configWatchers.get(appName)
    if (watchers) {
      for (const callback of watchers) {
        try {
          callback(appName, config)
        } catch (e) {
          // Ignore callback errors
        }
      }
    }
  }

  /**
   * Register config change listener
   */
  function onConfigChange(appName, callback) {
    if (!configWatchers.has(appName)) {
      configWatchers.set(appName, new Set())
    }
    configWatchers.get(appName).add(callback)
    return () => {
      configWatchers.get(appName).delete(callback)
    }
  }

  return httpCreateServer((req, res) => {
    const { pathname } = new URL(req.url, `http://${req.headers.host}`)
    const parts = pathname.split('/').filter(Boolean)

    // Root path
    if (pathname === '/' || pathname === '') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ name: 'caesura-config-server', status: 'UP', version: '1.0.0' }))
      return
    }

    // Health check
    if (pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ status: 'UP' }))
      return
    }

    // Config query: /{application}/{profile}/{label}
    if (parts.length >= 2 && parts[0] !== 'config') {
      const [application, profile, label] = parts
      const config = findConfig(application, profile, label, configs)
      if (config) {
        const response = buildConfigResponse(application, profile, label || 'master', config)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(response))
        return
      }
      res.writeHead(404, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Not Found' }))
      return
    }

    // Config management: GET /config/{application} - Get all config versions for an app
    if (parts.length >= 2 && parts[0] === 'config') {
      const appName = parts[1]
      if (req.method === 'GET' && pathname === `/config/${appName}`) {
        // Return all config versions for this app
        const history = configHistory.get(appName) || []
        const versions = history.map((h) => ({
          version: h.version,
          timestamp: h.timestamp,
          source: h.source,
        }))
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ application: appName, versions: history }))
        return
      }

      // Config rollback: POST /config/{application}/rollback
      if (parts.length === 3 && parts[2] === 'rollback' && req.method === 'POST') {
        let body = ''
        req.on('data', (chunk) => { body += chunk })
        req.on('end', () => {
          try {
            const { version } = JSON.parse(body)
            const history = configHistory.get(appName)
            if (!history) {
              res.writeHead(404, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ error: 'Application not found' }))
              return
            }
            const target = history.find((h) => h.version === version)
            if (!target) {
              res.writeHead(404, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ error: 'Version not found' }))
              return
            }
            // Rollback to specified version
            configs[appName] = JSON.parse(JSON.stringify(target.config))
            // Record rollback action
            recordConfigChange(appName, target.config, target.source)
            // Notify listeners
            notifyConfigWatchers(appName, target.config)
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ application: appName, version: target.version, status: 'rolled back' }))
            return
          } catch (e) {
            res.writeHead(400, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'Invalid request body' }))
            return
          }
        })
        return
      }

      // Config refresh: POST /config/{application}/refresh
      if (parts.length === 3 && parts[2] === 'refresh' && req.method === 'POST') {
        // Re-scan config directory
        scanConfigs(DEFAULT_CONFIG_DIR)
        const config = configs[appName]
        if (config) {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ application: appName, status: 'refreshed', config }))
          return
        }
        res.writeHead(404, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Application not found' }))
        return
      }

      res.writeHead(404, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Not Found' }))
      return
    }

    res.writeHead(404, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'Not Found' }))
  })
}

/**
 * Start config file watcher.
 *
 * @param {Record<string, Record<string, unknown>>} configs Config map (mutated on change)
 * @param {string} dir Config directory path
 * @param {number} interval Check interval (ms)
 * @param {function} onChange Config change callback (appName, config) => void
 * @returns {function} Stop listening function
 */
function startConfigWatcher(configs, dir, interval = WATCH_INTERVAL_MS, onChange) {
  const fileMtimes = new Map()

  function check() {
    try {
      const files = readdirSync(dir)
      for (const file of files) {
        const ext = extname(file).toLowerCase()
        if (ext !== '.yml' && ext !== '.yaml' && ext !== '.json') continue
        const filePath = join(dir, file)
        const stat = statSync(filePath)
        const fileKey = join(dir, file)

        const prevMtime = fileMtimes.get(fileKey)
        const currMtime = stat.mtimeMs
        if (prevMtime !== undefined && prevMtime === currMtime) continue

        fileMtimes.set(fileKey, currMtime)
        const content = readFileSync(filePath, 'utf8')
        let parsed
        if (ext === '.json') {
          parsed = JSON.parse(content)
        } else {
          parsed = parseSimpleYaml(content)
        }
        const name = file.replace(ext, '')
        configs[name] = parsed

        if (onChange) {
          try {
            onChange(name, parsed)
          } catch (e) {
            // Ignore callback errors
          }
        }
      }
    } catch (e) {
      // Directory does not exist or read failed, ignore
    }
  }

  // Execute immediately once
  check()

  // Periodic check
  const intervalId = setInterval(check, interval)

  return function stop() {
    if (intervalId) {
      clearInterval(intervalId)
    }
  }
}

/**
 * CLI entry point: when run directly start HTTP server; when import only export functions.
 */
if (process.argv[1] && new URL(process.argv[1], 'file://').pathname === new URL(import.meta.url).pathname) {
  const configDir = process.argv[2] || DEFAULT_CONFIG_DIR
  const port = parseInt(process.argv[3] || DEFAULT_PORT, 10)

  const configs = loadConfigs(configDir)
  const server = createServer(configs)

  // Start config file watcher
  const stopWatcher = startConfigWatcher(configs, configDir, WATCH_INTERVAL_MS)

  server.listen(port, () => {
    console.log(`Spring Cloud Config Server running at http://localhost:${port}`)
    console.log(`Config dir: ${configDir}`)
    console.log(`Loaded configs: ${Object.keys(configs).join(', ')}`)
  })

  server.on('error', (e) => {
    console.error(`Server start failed: ${e.message}`)
    process.exit(1)
  })

  // Graceful shutdown
  process.on('SIGTERM', () => {
    stopWatcher()
    server.close()
    process.exit(0)
  })
  process.on('SIGINT', () => {
    stopWatcher()
    server.close()
    process.exit(0)
  })
}

/**
 * Export functions for testing and other modules.
 */
export { createServer, loadConfigs, findConfig, buildConfigResponse, startConfigWatcher }
