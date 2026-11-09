#!/usr/bin/env node
/**
 * services/spring/container-image-check.mjs —— **这一族的容器镜像核对器**（KI-430）。
 *
 * **它回答两个问题**：
 *   ① **静态那半**：把 node 的二进制从 `node:22` 抄进 `eclipse-temurin:25-jre` 这个底座，
 *      **方向对不对**？（glibc 向后兼容：从旧往新抄安全，从新往旧抄会找不到符号。）
 *   ② **运行那半**：这个镜像里的 node **真的跑得起来吗**（`node --version`／`npm --version`）。
 *
 * **为什么静态那半要用「不启容器」的办法**：`docker cp` 直接读镜像的文件系统，**不用 exec**。
 * 这不是取巧——本批实测到：本机 Docker 的**容器运行时**当时是卡死的
 * （WSL2 虚拟机被 OOM 掏空 ⇒ 新容器永远停在 `Created` ⇒ runc 报
 * `failed to open /proc/<pid>/ns/ipc`），而 COPY 步骤一直是好的。
 * ⇒ **运行时坏掉的时候，静态量测仍然做得成**，那就不该跟着一起坏。
 *
 * **判据不许抄数**：两个底座的名字是从 **Dockerfile 里现读**的（`FROM … AS node`／`FROM …`），
 * 不是写死在这儿——写死就等于有了第二个主人。
 *
 * 用法：node services/spring/container-image-check.mjs
 * 退出码：0 = 两半都绿；1 = 有红（静态红／运行红或跑不了）。
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = fileURLToPath(new URL('.', import.meta.url))
const DOCKERFILE = join(HERE, 'Dockerfile')
const COMPOSE = join(HERE, 'docker-compose.yml')

/** 跑一条 docker 命令（带超时；超时不算抛错，算「跑不了」——退出码／信号／spawnSync 的错误码都记下来，归因才有着落） */
function docker(args, { timeoutMs = 60000 } = {}) {
  const r = spawnSync('docker', args, { encoding: 'utf8', timeout: timeoutMs, windowsHide: true })
  if (r.error) {
    return { ok: false, code: -1, signal: null, err: r.error.code ?? String(r.error.message ?? r.error), stdout: '', stderr: String(r.error.message ?? r.error) }
  }
  return {
    ok: r.status === 0,
    code: r.status ?? -1,
    signal: r.signal ?? null,
    err: null,
    stdout: r.stdout ?? '',
    stderr: r.stderr ?? '',
  }
}

/** 「跑不起来」那一格的**归因文字**：三种死法说的话不一样，不许把它们并成一句 */
function deadReason(r, timeoutMs) {
  if (r.err) return `spawnSync 等不到 docker 客户端（${r.err}，围栏 ${timeoutMs}ms）`
  if (r.signal) return `docker 客户端被超时杀掉（信号 ${r.signal}，围栏 ${timeoutMs}ms）`
  return `docker 客户端自己退了（退出码 ${r.code}）`
}

/** 从 Dockerfile 的**文本**里现读两个底座（不写死；注释不算指令，先剥掉） */
export function parseBaseImages(text) {
  const lines = String(text ?? '').split(/\r?\n/).filter((l) => !/^\s*#/.test(l))
  const froms = []
  for (const l of lines) {
    const m = /^FROM\s+(\S+)(?:\s+AS\s+(\S+))?\s*$/i.exec(l.trim())
    if (m) froms.push({ image: m[1], alias: m[2] ?? null })
  }
  const nodeStage = froms.find((f) => f.alias && /node/i.test(f.alias)) ?? froms.find((f) => /^node/i.test(f.image))
  const target = froms.find((f) => f !== nodeStage)
  return { nodeStage: nodeStage ?? null, target: target ?? null, froms }
}

/** 从 Dockerfile 文件里现读两个底座 */
function readBaseImages() {
  return parseBaseImages(readFileSync(DOCKERFILE, 'utf8'))
}

/**
 * 从 compose 的文本里现读那几格 `image:`（运行那半要知道**跑哪一个镜像**——写死一个 tag 就是第二个主人）。
 * 只认缩进在 service 那一层下面的 `image:`（`^\s{4}image:`），别把 build 里的 `dockerfile:` 读进来。
 */
export function composeImageTags(text) {
  const out = []
  for (const l of String(text ?? '').split(/\r?\n/)) {
    const m = /^ {4}image:\s*(\S+)\s*$/.exec(l)
    if (m && !out.includes(m[1])) out.push(m[1])
  }
  return out
}

/** 扫**二进制文本**里出现的所有 `GLIBC_x.y`（去重、按数值升序：`2.9` 排在 `2.28` 前面才是对的） */
export function parseGlibcNeeded(text) {
  const hits = new Set()
  const rx = /GLIBC_(\d+)\.(\d+)/g
  let m
  while ((m = rx.exec(String(text ?? ''))) !== null) hits.add(`${Number(m[1])}.${Number(m[2])}`)
  return [...hits].sort((a, b) => {
    const [a1, a2] = a.split('.').map(Number)
    const [b1, b2] = b.split('.').map(Number)
    return a1 - b1 || a2 - b2
  })
}

/** 从一个文件里扫 node 二进制需要的所有 glibc 版本（最高在最后一格） */
function maxGlibcNeeded(file) {
  return parseGlibcNeeded(readFileSync(file).toString('latin1'))
}

/** libc.so.6 自己提供的版本：两种拼法都认（glibc 在二进制里同时写着这两种） */
export function parseGlibcProvided(text) {
  const t = String(text ?? '')
  const stable = /stable release version (\d+)\.(\d+)/.exec(t)
  if (stable) return `${stable[1]}.${stable[2]}`
  const m = /GLIBC (\d+)\.(\d+)/.exec(t)
  return m ? `${m[1]}.${m[2]}` : null
}

/** 从 libc.so.6 里读出它自己提供的版本 */
function glibcProvided(file) {
  return parseGlibcProvided(readFileSync(file).toString('latin1'))
}

const cmpVer = (a, b) => {
  const [a1, a2] = a.split('.').map(Number)
  const [b1, b2] = b.split('.').map(Number)
  return a1 - b1 || a2 - b2
}

/**
 * 跑一遍两半量测，返回 `{verdict, readings, findings}`。
 *
 * **为什么它得是一个函数而不是顶层代码**：这份仓里「import 即求值」那一族病（KI-113／KI-118）
 * 说的是同一件事——顶层代码在**被 import 的那一刻**就跑，而这一跑要动 docker。
 * 判据的三台解析器（`parseBaseImages`／`parseGlibcNeeded`／`parseGlibcProvided`）今天有腿，
 * 腿是从**测试里 import 这个模块**拿到的 ⇒ 顶层不能再自己跑，否则测试一起跑就撞上 docker。
 */
export function runContainerImageCheck() {
  const findings = []
  const readings = {}

  const bases = readBaseImages()
  if (!bases.nodeStage || !bases.target) {
    findings.push({ key: '镜像底座', msg: `Dockerfile 里读不出两个底座（读到 ${JSON.stringify(bases)}）` })
    return { verdict: 'RED', readings, findings }
  }

  readings.nodeSourceImage = bases.nodeStage.image
  readings.targetImage = bases.target.image

  const work = mkdtempSync(join(tmpdir(), 'caesura-imgcheck-'))
  const created = []
  try {
    /** 建一个**不启动**的容器，好把里面的文件取出来 */
    /** 本地有就不去 registry 问（pull 要重新核对清单，慢） */
    const ensure = (image) => {
      if (docker(['image', 'inspect', image], { timeoutMs: 30000 }).ok) return { ok: true, code: 0, stdout: '', stderr: '' }
      return docker(['pull', image], { timeoutMs: 600000 })
    }
    const pull = ensure(bases.nodeStage.image)
    if (!pull.ok) findings.push({ key: '取源镜像', msg: `docker pull ${bases.nodeStage.image} 失败：${pull.stderr.trim().slice(0, 200)}` })
    const pull2 = ensure(bases.target.image)
    if (!pull2.ok) findings.push({ key: '取目标镜像', msg: `docker pull ${bases.target.image} 失败：${pull2.stderr.trim().slice(0, 200)}` })

    for (const image of [bases.nodeStage.image, bases.target.image]) {
      const name = `caesura-imgcheck-${Math.random().toString(36).slice(2, 10)}`
      const c = docker(['create', '--name', name, image])
      if (c.ok) {
        created.push(name)
        const id = c.stdout.trim()
        readings[`container_${image}`] = id.slice(0, 12)
      } else {
        findings.push({ key: '建容器', msg: `docker create ${image} 失败：${c.stderr.trim().slice(0, 200)}` })
      }
    }

    const nodeC = created[0]
    const targetC = created[1]
    if (nodeC) {
      const bin = join(work, 'node-bin')
      // 那一格是 **124,902,584 字节**（实测大小）⇒ 60 秒的围栏不够，实测就红在 `spawnSync docker ETIMEDOUT` 上
      const cp = docker(['cp', `${nodeC}:/usr/local/bin/node`, bin], { timeoutMs: 600000 })
      if (cp.ok) {
        const need = maxGlibcNeeded(bin)
        readings.node_binary_bytes = existsSync(bin) ? readFileSync(bin).length : null
        readings.node_binary_needs_glibc_max = need.length ? need[need.length - 1] : null
        readings.node_binary_needs_all = need
      } else {
        findings.push({
          key: '取 node 二进制',
          msg: `docker cp 失败：${deadReason(cp, 600000)} ${cp.stderr.trim().slice(0, 200)}`,
        })
      }
    }
    if (targetC) {
      const libc = join(work, 'libc.so.6')
      const cp = docker(['cp', `${targetC}:/lib/x86_64-linux-gnu/libc.so.6`, libc], { timeoutMs: 300000 })
      if (cp.ok) {
        readings.target_glibc_provides = glibcProvided(libc)
      } else {
        findings.push({
          key: '取目标 libc',
          msg: `docker cp libc 失败：${deadReason(cp, 300000)} ${cp.stderr.trim().slice(0, 200)}`,
        })
      }
      const osr = join(work, 'os-release')
      const cp2 = docker(['cp', `${targetC}:/usr/lib/os-release`, osr])
      if (cp2.ok) {
        const m = /^PRETTY_NAME="?([^"\n]+)"?$/m.exec(readFileSync(osr, 'utf8'))
        readings.target_distro = m ? m[1] : null
      }
    }

    // ── 静态那半的判决 ────────────────────────────────────────────
    if (readings.node_binary_needs_glibc_max && readings.target_glibc_provides) {
      const ok = cmpVer(readings.target_glibc_provides, readings.node_binary_needs_glibc_max) >= 0
      readings.glibc_direction = ok ? 'OK' : 'BROKEN'
      if (!ok) {
        findings.push({
          key: 'glibc 方向',
          msg: `目标镜像的 glibc ${readings.target_glibc_provides} 比 node 二进制需要的 ${readings.node_binary_needs_glibc_max} 还旧`
            + ' ⇒ 从新 glibc 往旧 glibc 抄会找不到符号（**方向反了**）。',
        })
      }
    } else {
      // 缺哪一侧就**点哪一侧的名**：上一版这里写成 `else if (!findings.length)`，于是「cp 失败」那一格把
      // 「方向这一格没有读数」这句话吃掉了——注释里的 2.28 就成了谁也没核对的抄数。
      readings.glibc_direction = 'NO-READING'
      findings.push({
        key: 'glibc 方向',
        msg: `这一格没有完整读数（需求侧＝${readings.node_binary_needs_glibc_max ?? '无'}／提供侧＝${readings.target_glibc_provides ?? '无'}）`
          + ' ⇒ **不猜方向**：抄进注释的那两个数今天不是这台机器说的。',
      })
    }

    // ── 运行那半：真把镜像跑起来问一句 ────────────────────────────
    // 跑哪一个镜像**不写死**：从 compose 现读那几格 `image:`，拿本机已有的第一个（compose 里每一格
    // 都是从同一份 Dockerfile 构建的，所以任何一格都是那份镜像的形态；写死一个 tag 就是第二个主人）。
    const tags = composeImageTags(readFileSync(COMPOSE, 'utf8'))
    readings.composeImageTags = tags
    const img = tags.find((t) => docker(['image', 'inspect', t], { timeoutMs: 30000 }).ok) ?? null
    if (img) {
      const cname = `caesura-imgcheck-run-${Math.random().toString(36).slice(2, 10)}`
      const c = docker(['create', '--name', cname, img, 'sh', '-c', 'node --version && npm --version'], { timeoutMs: 30000 })
      if (c.ok) {
        created.push(cname)
        const started = docker(['start', '-a', cname], { timeoutMs: 60000 })
        if (started.ok && /v\d+\.\d+\.\d+/.test(started.stdout)) {
          readings.runtime_image = img
          readings.runtime_node_version = /v\d+\.\d+\.\d+/.exec(started.stdout)?.[0] ?? null
          readings.runtime_npm_version = /(\d+\.\d+\.\d+)\s*$/.exec(started.stdout)?.[1] ?? null
          readings.runtime_half = 'OK'
        } else {
          readings.runtime_half = 'BLOCKED'
          readings.runtime_exit = { image: img, code: started.code, signal: started.signal, err: started.err }
          findings.push({
            key: '运行那半',
            msg: `镜像 ${img} 起不来：${deadReason(started, 60000)} ${(started.stderr || started.stdout).trim().slice(0, 240)}`
              + '⇒ 客户端等不到容器退出 ⇒ 容器停在 `Created` 不动：**运行时**坏了，而不是这个镜像的错。',
          })
        }
      } else {
        readings.runtime_half = 'BLOCKED'
        readings.runtime_exit = { image: img, code: c.code, signal: c.signal, err: c.err }
        findings.push({ key: '运行那半', msg: `docker create ${img} 失败：${deadReason(c, 30000)} ${c.stderr.trim().slice(0, 240)}` })
      }
    } else {
      readings.runtime_half = 'SKIPPED'
      findings.push({
        key: '运行那半',
        msg: `compose 里那几格镜像本机都还没构建出来（${JSON.stringify(tags)}）⇒ 这一半今天没有读数`,
      })
    }
  } finally {
    for (const n of created) docker(['rm', '-f', n], { timeoutMs: 30000 })
    try { rmSync(work, { recursive: true, force: true }) } catch { /* 量测目录，删不掉也不影响判决 */ }
  }

  const verdict = findings.length ? 'RED' : 'OK'
  return { verdict, readings, findings }
}

/**
 * 只有**当命令跑**才动 docker；被 import（测试只要三台解析器）时一个进程都不起。
 * 名册主人是 `validate-data.mjs`／`head-compiles-rules.mjs` 用的那同一把判据：argv[1] 解析到本文件。
 */
const invoked = process.argv[1] ? resolve(process.argv[1]) : ''
if (invoked && existsSync(invoked) && invoked === resolve(fileURLToPath(import.meta.url))) {
  const { verdict, readings, findings } = runContainerImageCheck()
  console.log(JSON.stringify({ verdict, readings, findings }, null, 2))
  process.exit(verdict === 'OK' ? 0 : 1)
}
