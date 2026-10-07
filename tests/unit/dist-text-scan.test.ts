import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { DIST_DIR, distScanFindings, scanDist, walkDist } from '../../scripts/dist-text-scan.mjs'
/**
 * 构建产物的文本哨兵（KI-098 没做③，2026-10-08）。
 *
 * 为什么交付总体（text-corpus）把 dist 列进 SKIP_DIRS 之后还要一份独立的总体：dist 是**用户
 * 真正加载的东西**，而它的字节是**构建链自己写的**——压缩器、插件、模板填充同样是一次写盘，
 * 在此之前没有任何人看过产物。源码干净而产物坏掉是可能的，所以产物要有自己的哨兵，挂在
 * `npm run build` 的尾巴上（dist 只在构建后存在 ⇒ 这道门的消费者只能是 build 腿）。
 *
 * 真产物的读数由每次 build 自己给出（plane 实测两趟：7 份文本 / 0 findings）；这里全部用
 * **合成 fixture** 钉判据——拒的一侧要能逐个数判，且新克隆上没有 dist 时这套测试照样全绿。
 */

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const f = (rel: string) => join(ROOT, rel).replace(/\//g, '\\')

/** 建一个带 `dist/` 的临时仓库根；返回根路径，统一在 afterEach 清 */
const made: string[] = []
function makeDist(files: Record<string, string | Buffer>): string {
  const root = mkdtempSync(join(tmpdir(), 'dist-scan-'))
  made.push(root)
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(root, rel)
    mkdirSync(dirname(abs), { recursive: true })
    writeFileSync(abs, content)
  }
  return root
}
const CLEAN = {
  'dist/index.html': '<!doctype html><html lang="zh-CN"><body>静默之环</body></html>',
  'dist/assets/main.js': 'console.log("hello")\n',
  'dist/assets/main.css': 'body{color:#ccc}\n',
}

afterEach(() => {
  for (const root of made.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('walkDist：总体按内容认文本，二进制静默跳过（与 text-corpus 相反，dist 里图片/字体是正常的）', () => {
  it('干净 dist：三份文本、零二进制、存在', () => {
    const root = makeDist(CLEAN)
    const w = walkDist(root)
    expect(w.exists).toBe(true)
    expect(w.files.map((x) => x.file).sort()).toEqual(['dist/assets/main.css', 'dist/assets/main.js', 'dist/index.html'])
    expect(w.binaries).toEqual([])
  })

  it('含 NUL 的产物（图片/字体形状）被跳过且列在 binaries 里——跳过要看得见，不许静默', () => {
    const root = makeDist({ ...CLEAN, 'dist/assets/logo.png': Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x0a]) })
    const w = walkDist(root)
    expect(w.files).toHaveLength(3)
    expect(w.binaries).toEqual(['dist/assets/logo.png'])
  })

  it('dist 不存在：exists=false、双空——总体红由 findings 那一层出，walk 自己不炸', () => {
    const root = makeDist({})
    expect(walkDist(root)).toEqual({ exists: false, files: [], binaries: [] })
  })
})

describe('scanDist：三条拒绝 + 两句判据（判据本体是 text-integrity 的，这里钉的是接线与总体）', () => {
  it('干净 dist：0 findings；薄封装与 DIST_DIR 各一格证人', () => {
    const root = makeDist(CLEAN)
    expect(scanDist(root).findings).toEqual([])
    expect(distScanFindings(root)).toEqual(scanDist(root).findings)
    expect(DIST_DIR).toBe('dist')
  })

  it('产物里种一个 U+FFFD ⇒ 恰 1 条，点名文件与上下文', () => {
    const root = makeDist({ 'dist/index.html': '<title>静默之环\uFFFD</title>' })
    const r = scanDist(root)
    expect(r.findings).toHaveLength(1)
    expect(r.findings[0].level).toBe('error')
    expect(r.findings[0].file).toBe('dist/index.html')
    expect(r.findings[0].msg).toContain('U+FFFD')
  })

  it('产物里种一个 U+0008（转义被写盘吃掉一次的那个真件形状）⇒ 恰 1 条，点名码点', () => {
    const root = makeDist({ 'dist/assets/main.js': 'const re = /<button\u0008[^>]*>/\n' })
    const r = scanDist(root)
    expect(r.findings).toHaveLength(1)
    expect(r.findings[0].file).toBe('dist/assets/main.js')
    expect(r.findings[0].msg).toContain('U+0008')
  })

  it('非法 UTF-8 走致命解码：一条"字节"红，且**不**替它造出 U+FFFD 的第二条红', () => {
    const root = makeDist({ 'dist/assets/main.js': Buffer.from([0x43, 0x21, 0xc3, 0x28, 0x0a]) })
    const r = scanDist(root)
    expect(r.findings).toHaveLength(1)
    expect(r.findings[0].where).toBe('字节')
    expect(r.findings[0].file).toBe('dist/assets/main.js')
    expect(r.findings[0].msg).toContain('UTF-8')
  })

  it('dist 缺失 ⇒ 一条总体红，不许读成"没东西可扫就算过"', () => {
    const root = makeDist({})
    const r = scanDist(root)
    expect(r.exists).toBe(false)
    expect(r.findings).toHaveLength(1)
    expect(r.findings[0].where).toBe('总体')
    expect(r.findings[0].msg).toContain('dist')
  })

  it('dist 在但空 ⇒ 一条总体红（构建坏了的形状，不是"干净"）', () => {
    const root = makeDist({})
    mkdirSync(join(root, 'dist'))
    const r = scanDist(root)
    expect(r.exists).toBe(true)
    expect(r.files).toHaveLength(0)
    expect(r.findings).toHaveLength(1)
    expect(r.findings[0].where).toBe('总体')
    expect(r.findings[0].msg).toContain('读不到任何有内容的文本')
    expect(r.findings[0].msg).toContain('文本 0 份、其中非空 0 份')
  })

  it('dist 里只有 0 字节文本 ⇒ 同一张空总体红——"全是 0 字节"与"0 份"是同一种空集冒充', () => {
    const root = makeDist({ 'dist/assets/main.js': '' })
    const r = scanDist(root)
    expect(r.findings).toHaveLength(1)
    expect(r.findings[0].where).toBe('总体')
    expect(r.findings[0].msg).toContain('文本 1 份、其中非空 0 份')
  })

  it('dist 里只有二进制 ⇒ 同样空总体红——跳过二进制不许变成伪造一个空绿的总体', () => {
    const root = makeDist({ 'dist/assets/tex.png': Buffer.from([0x00, 0x01]) })
    const r = scanDist(root)
    expect(r.binaries).toEqual(['dist/assets/tex.png'])
    expect(r.findings).toHaveLength(1)
    expect(r.findings[0].where).toBe('总体')
  })
})

/** 本机 vitest worker 内 spawn 实测可用（KI-075 的探针留在此处：换一台被拒的机器它是响亮跳过而非假绿） */
const probe = spawnSync(process.execPath, ['-e', 'process.exit(0)'], { encoding: 'utf8' })
const CAN_SPAWN = probe.status === 0
if (!CAN_SPAWN) console.warn('[dist-text-scan.test] 本机 worker 内 spawn 被拒，CLI 两腿响亮跳过（见 KI-075）')

describe.runIf(CAN_SPAWN)('CLI（scripts/check-dist.mjs）：退出码与点名', () => {
  const run = (args: string[]) =>
    spawnSync(process.execPath, [f('scripts/check-dist.mjs'), ...args], { encoding: 'utf8', cwd: ROOT })

  it('干净 fixture ⇒ exit 0，且摘要行带总体读数（不是无声的 0）', () => {
    const root = makeDist(CLEAN)
    const r = run([`--root=${root}`])
    expect(r.status).toBe(0)
    expect(r.stdout).toContain('[dist] 文本 3 份')
    expect(r.stdout).toContain('0 findings')
  })

  it('种植 U+FFFD 的 fixture ⇒ exit 1 且点名文件', () => {
    const root = makeDist({ 'dist/index.html': '<title>静默\ufffd</title>' })
    const r = run([`--root=${root}`])
    expect(r.status).toBe(1)
    expect(r.stderr).toContain('dist/index.html')
    expect(r.stderr).toContain('1 条 findings')
  })

  it('dist 缺失的 root ⇒ exit 1（不许静默当干净）', () => {
    const root = makeDist({})
    const r = run([`--root=${root}`])
    expect(r.status).toBe(1)
  })

  it('不认识的参数 ⇒ 响亮拒绝，不许静默忽略（"扫了但扫的是别处"比"没扫"更糟）', () => {
    const root = makeDist(CLEAN)
    const r = run([`--root=${root}`, '--dangerously-ignore-me'])
    expect(r.status).toBe(1)
    expect(r.stderr).toContain('--dangerously-ignore-me')
  })
})

describe('源码门：这道门的消费者只能是 build 腿，判据本体必须是 import 不是复刻', () => {
  const pkg = JSON.parse(readFileSync(f('package.json'), 'utf8')) as { scripts: Record<string, string> }
  const scanSrc = readFileSync(f('scripts/dist-text-scan.mjs'), 'utf8')
    .split(/[\r\n]+/)
    .filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*') && !l.trim().startsWith('/*'))
  const cliSrc = readFileSync(f('scripts/check-dist.mjs'), 'utf8')

  it('build 腿在 vite build 之后接 node scripts/check-dist.mjs（顺序是形状：先有产物才有得扫）', () => {
    expect(pkg.scripts.build).toMatch(/^tsc --noEmit && vite build && node scripts\/check-dist\.mjs$/)
  })

  it('判据接线：check-dist 调 scanDist；dist-text-scan 从 text-corpus 拿总体工具、从 text-integrity 拿两句判据，不自带第二份', () => {
    expect(cliSrc).toContain("from './dist-text-scan.mjs'")
    expect(cliSrc).toContain('scanDist(')
    expect(scanSrc.some((l) => /^import \{ decodeUtf8, looksBinary \} from '\.\/text-corpus\.mjs'$/.test(l)),
      'looksBinary/decodeUtf8 的主人是 text-corpus——从别处拿就是第二份口径').toBe(true)
    expect(scanSrc.some((l) => /^import \{ mojibakeFindings, strayControlFindings \} from '\.\/text-integrity\.mjs'$/.test(l)),
      '没 import = 判据是复刻的').toBe(true)
    expect(scanSrc.some((l) => /mojibakeFindings|strayControlFindings/.test(l)), 'import 了却不调用 = 判据是装饰').toBe(true)
  })

  it('纯度：判据模块零副作用（process.exit 只许住在 CLI 里——import 即退出的判据没有证人，KI-078 同课）', () => {
    expect(scanSrc.filter((l) => /process\.exit/.test(l))).toEqual([])
    expect(cliSrc).toContain('process.exit')
  })

  it('致命解码是判据形状的一部分：dist-text-scan 不许用非致命解码自己造 U+FFFD', () => {
    expect(scanSrc.some((l) => /decodeUtf8\(/.test(l))).toBe(true)
    expect(scanSrc.filter((l) => /toString\(['"]utf-?8['"]\)/.test(l)), "Buffer→string 的非致命解码会把坏字节静默变成 U+FFFD").toEqual([])
  })
})
