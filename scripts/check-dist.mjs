/**
 * scripts/check-dist.mjs — 构建产物文本哨兵的 CLI（KI-098 没做③，2026-10-08）。
 *
 * 判据与总体都住在 `dist-text-scan.mjs`（纯函数、零副作用，测试要能 import 它喂坏东西）；
 * 这里只有三件事：算根、跑一遍、按 findings 决定退出码。挂进 `npm run build` 的尾巴：
 * dist 只在 vite build 之后存在，所以这道门的消费者只能是 build 腿。
 *
 * `--root=<路径>` 是给测试与平面用的显式覆盖（默认从本文件自己的位置向上取仓库根）；
 * 不认识的参数响亮拒绝，不许静默忽略——"扫了但扫的是别处"比"没扫"更糟。
 */
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { scanDist } from './dist-text-scan.mjs'

const argRoot = process.argv.slice(2).find((a) => a.startsWith('--root='))
const unknown = process.argv.slice(2).filter((a) => !a.startsWith('--root='))
if (unknown.length > 0) {
  console.error(`[dist] 不认识的参数：${unknown.join(' ')}——这道门只认 --root=<路径>。`)
  process.exit(1)
}
const root = argRoot
  ? resolve(argRoot.slice('--root='.length))
  : resolve(dirname(fileURLToPath(import.meta.url)), '..')

const { exists, files, binaries, findings } = scanDist(root)
if (!exists) {
  console.error(`[dist] ${root} 下没有 dist/ ——先构建再扫（这道门挂在 build 腿的尾巴上）。`)
  for (const f of findings) console.error(`  ✗ ${f.file} / ${f.where}：${f.msg}`)
  process.exit(1)
}
if (findings.length === 0) {
  console.log(`[dist] 文本 ${files.length} 份（二进制 ${binaries.length} 份按内容跳过）/ 0 findings`)
  process.exit(0)
}
console.error(`[dist] ${findings.length} 条 findings（文本 ${files.length} 份 / 二进制 ${binaries.length} 份跳过）：`)
for (const f of findings) console.error(`  ✗ ${f.file} / ${f.where}：${f.msg}`)
process.exit(1)
