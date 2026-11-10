/**
 * scripts/spring-config-server.mjs —— Spring Cloud Config Server 客户端（Node.js 侧）。
 *
 * <p>它不做判断，只做**配置服务器模拟**：从本地 YAML/JSON 文件读取配置，按 Spring Cloud Config Server
 * 的 REST API 格式供出，供 Node.js 侧的 spring-config-client 等客户端在无真 Spring Boot 服务器时
 * 进行开发和测试。所有业务阈值与判定仍由 Node 侧负责；Spring 家族只负责编排/报告。
 *
 * **支持的端点**：
 *   GET /{application}/{profile}/{label}   - 获取指定应用/环境/标签的配置（Spring Cloud Config 标准）
 *   /health                               - 健康检查端点
 *   /                                     - 根路径，返回服务信息
 *
 * 用法：
 *   node scripts/spring-config-server.mjs [配置目录] [端口]
 *   例如：node scripts/spring-config-server.mjs ./config 8888
 *   例如：node scripts/spring-config-server.mjs   8888          （使用默认 ./config 目录）
 *
 * 退出码：0 = 启动成功，1 = 启动失败，2 = 用法不对。
 */

import { createServer as httpCreateServer } from 'node:http'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, extname } from 'node:path'

/** 默认配置目录 */
const DEFAULT_CONFIG_DIR = './config'
/** 默认监听端口 */
const DEFAULT_PORT = 8888

/**
 * 读取配置目录下的所有 YAML/JSON 文件，按文件名（不含扩展名）作为应用名组织。
 *
 * @param {string} dir 配置目录路径
 * @returns {Record<string, Record<string, unknown>>} 按应用名组织的配置映射
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
    // 目录不存在或读取失败，返回空映射
  }
  return configs
}

/**
 * 简单的 YAML 解析器：支持 key: value 格式的简单 YAML。
 * 不支持复杂的嵌套、列表、锚点等高级特性。
 */
function parseSimpleYaml(text) {
  const result = {}
  const lines = text.split(/\r?\n/)
  let currentSection = null

  for (const line of lines) {
    // 嵌套键值对（两空格缩进）- 必须在trim前检查缩进
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

    // 顶层键值对（先修剪空白）
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

/** 解析 YAML 值字符串为 JS 类型 */
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
 * 根据应用名、环境、标签查找配置。Spring Cloud Config Server 的名册查找顺序是：
 *   1. {application}-{profile}.yml
 *   2. {application}.yml
 *   3. application.yml
 *
 * @param {string} appName 应用名
 * @param {string} profile 环境名（如 dev, prod）
 * @param {string} label 标签名（如 master, develop）
 * @param {Record<string, Record<string, unknown>>} configs 配置映射
 * @returns {Record<string, unknown>|undefined} 匹配的配置
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
 * 构建 Spring Cloud Config Server 风格的响应体。
 *
 * @param {string} application 应用名
 * @param {string} profile 环境名
 * @param {string} label 标签名
 * @param {Record<string, unknown>} config 配置内容
 * @returns {object} Spring Cloud Config Server 风格的响应体
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
 * 创建 HTTP 服务器。
 *
 * @param {Record<string, Record<string, unknown>>} configs 配置映射
 * @returns {import('http').Server} HTTP 服务器实例
 */
function createServer(configs) {
  return httpCreateServer((req, res) => {
    const { pathname } = new URL(req.url, `http://${req.headers.host}`)
    const parts = pathname.split('/').filter(Boolean)

    // 根路径
    if (pathname === '/' || pathname === '') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ name: 'caesura-config-server', status: 'UP', version: '1.0.0' }))
      return
    }

    // 健康检查
    if (pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ status: 'UP' }))
      return
    }

    // 配置查询：/{application}/{profile}/{label}
    if (parts.length >= 2) {
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

    res.writeHead(404, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'Not Found' }))
  })
}

/**
 * CLI 主体：被直接运行时启动 HTTP 服务器；被 import 时只交出函数。
 */
if (process.argv[1] && new URL(process.argv[1], 'file://').pathname === new URL(import.meta.url).pathname) {
  const configDir = process.argv[2] || DEFAULT_CONFIG_DIR
  const port = parseInt(process.argv[3] || DEFAULT_PORT, 10)

  const configs = loadConfigs(configDir)
  const server = createServer(configs)

  server.listen(port, () => {
    console.log(`Spring Cloud Config Server 运行在 http://localhost:${port}`)
    console.log(`配置目录：${configDir}`)
    console.log(`已加载配置：${Object.keys(configs).join(', ')}`)
  })

  server.on('error', (e) => {
    console.error(`服务器启动失败：${e.message}`)
    process.exit(1)
  })
}

/**
 * 导出函数供测试和其他模块使用。
 */
export { createServer, loadConfigs, findConfig, buildConfigResponse }
