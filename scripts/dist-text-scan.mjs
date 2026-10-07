/**
 * scripts/dist-text-scan.mjs — 把 `text-integrity.mjs` 那两句判据接到**构建产物**总体上（KI-098 没做③，2026-10-08）
 *
 * 为什么交付总体（`text-corpus.mjs`）把 `dist` 列进 SKIP_DIRS 还要再来一份：交付总体扫的是**人写的东西**，
 * 而 `dist/` 是**用户真正加载的东西**——同一台写盘路径若把坏字符写进源码，源头有交付总体拦着；
 * 可构建链自己（压缩器、插件、模板填充）同样是一次"写盘"，它产出的字节之前没有任何人看过。
 * 源码干净而产物坏掉是可能的，所以产物要有自己的哨兵，挂在 `npm run build` 的尾巴上
 * （`scripts/check-dist.mjs`）——dist 只在构建后存在，所以这道门的**消费者只能是 build 腿**，
 * 单元测试用合成 fixture 钉判据，真产物的读数由每次 build 自己给出。
 *
 * 分工与 `text-corpus.mjs` 一样：判据（纯函数）住 `text-integrity.mjs`，**总体**住这里，零副作用
 * （`process.exit` 只许出现在 CLI 那份里——判据模块一被 import 就退出，测试就没法喂坏东西给它了）。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { decodeUtf8, looksBinary } from './text-corpus.mjs'
import { mojibakeFindings, strayControlFindings } from './text-integrity.mjs'

export const DIST_DIR = 'dist'

/**
 * 走一遍 dist → `{ exists, files, binaries }`（POSIX 风格、以 `dist/` 开头的相对路径）。
 *
 * 二进制（含 NUL）**静默跳过而不报错**——这与 `text-corpus` 相反，理由是总体不同：
 * dist 里出现图片/字体是**正常**的（今天实测两趟 build 都是 0 份二进制，但那是 vite 没拷素材，
 * 不是"永远不会有"）；把二进制定罪会让这道门在第一个真素材进来的那天误报。
 * "跳过会藏坏文件"的那一格由**空总体拒绝**兜着：文本文件一个都没有照样红。
 */
export function walkDist(root) {
  const distAbs = join(String(root).replace(/\/+$/, ''), DIST_DIR)
  let st
  try {
    st = statSync(distAbs)
  } catch {
    return { exists: false, files: [], binaries: [] }
  }
  if (!st.isDirectory()) return { exists: false, files: [], binaries: [] }
  const files = []
  const binaries = []
  const walk = (cur, prefix) => {
    for (const name of readdirSync(cur).sort()) {
      const full = join(cur, name)
      const rel = `${prefix}/${name}`
      if (statSync(full).isDirectory()) walk(full, rel)
      else {
        const bytes = readFileSync(full)
        if (looksBinary(bytes)) binaries.push(rel)
        else files.push({ file: rel, bytes })
      }
    }
  }
  walk(distAbs, DIST_DIR)
  return { exists: true, files, binaries }
}

/**
 * 总体 + 判据一次走完：`{ exists, files, binaries, findings }`。
 * findings 的形状与 `corpusFindings` 一致（`{ level, file, where, msg }`），三条拒绝都在最前面：
 * ① dist 不存在；② 文本总体为空（含"只有二进制"的形状）；③ 解码失败（致命解码，不让坏字节
 * 静默变成 U+FFFD 混进下一句的读数——那是判据自己造自己的假阳性）。
 */
export function scanDist(root) {
  const { exists, files, binaries } = walkDist(root)
  const findings = []
  if (!exists) {
    findings.push({
      level: 'error',
      file: `(${DIST_DIR})`,
      where: '总体',
      msg: `${DIST_DIR}/ 不存在，构建产物的文本完整性无从谈起。build 腿走到这一步说明 vite build 没产出它——先查构建，别跳过这道门。`,
    })
    return { exists, files, binaries, findings }
  }
  const decodable = []
  /** 空总体的口径包含"全是 0 字节"：一句断言拿着零份非空文本照样全绿——与 0 份是同一种空集冒充 */
  const nonEmpty = files.filter((x) => x.bytes.length > 0)
  if (nonEmpty.length === 0) {
    findings.push({
      level: 'error',
      file: `(${DIST_DIR})`,
      where: '总体',
      msg: `${DIST_DIR}/ 里读不到任何有内容的文本（文本 ${files.length} 份、其中非空 0 份；二进制 ${binaries.length} 份被按内容跳过）＝ 这道门在读一个空集合。`
        + 'vite build 不会产出这种形状（index.html + js/css 至少各一，且不为 0 字节）——要么构建坏了，要么扫错了地方。',
    })
    return { exists, files, binaries, findings }
  }
  for (const f of nonEmpty) {
    const d = decodeUtf8(f.bytes)
    if (!d.ok) {
      findings.push({
        level: 'error',
        file: f.file,
        where: '字节',
        msg: `这份产物不是合法 UTF-8（解码器原话：${JSON.stringify(d.error.slice(0, 160))}）。`
          + '判据刻意用**致命**解码：非致命解码会把坏字节悄悄变成 U+FFFD，等于判据自己造出自己的假阳性，'
          + '也把真正的代码页错位混进"替换字符"那一格里读不出来了。',
      })
      continue
    }
    decodable.push({ file: f.file, text: d.text })
  }
  findings.push(...mojibakeFindings(decodable))
  findings.push(...strayControlFindings(decodable))
  return { exists, files, binaries, findings }
}

/** 只取 findings 的一步薄封装（CLI 与测试各自取所需） */
export function distScanFindings(root) {
  return scanDist(root).findings
}
