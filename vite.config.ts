import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

/**
 * KI-005 的根因：vite 5.4 的 `build` 段**没有** `manualChunks` 这一项——写在
 * `build.manualChunks` 上的分组表被静默忽略（vite dist 里这个字符串只剩警告文案），
 * 于是 821 kB 常年单 chunk、还被误记成"rollup 对 CJS 依赖分包限制"（three 是 ESM）。
 * 唯一落点在 `build.rollupOptions.output.manualChunks`。
 *
 * 分组判据按解析后的模块 id（先归一为斜杠再比对，Windows 下反斜杠会漏配）：vendor 的 three 一片，
 * 数据/UI/音频/灰盒渲染各一片；核心玩法（combat/ai/player/core）留在入口——它们
 * 互相引用的边最多，切开只会增加跨块运行时开销，不减首包（three 才是那座山）。
 */
export default defineConfig({
  resolve: { alias: { '@': resolve(__dirname, 'src') } },
  server: { port: 5173 },
  // KI-099：`test.include` 今天才第一次存在，而它必须**锚在 `tests/` 下面**。
  // vitest 的默认值是仓库级的 glob（`**` 打头，吃 `.test`/`.spec` 两种词干），根目录 walk 会走进
  // `.scratch/plane_*/` 那些 `git archive` 解出来的冻结副本：它们各有各的 `tests/` 树，同名同案例，
  // 与这一趟真正要量的那份代码毫无关系。实测（2026-10-02，仓库根跑一条只管 `tests/unit/text-integrity`
  // 一个文件的筛选器）：收到 **3 个文件 / 51 条用例**，其中 2 个文件在 `.scratch/` 里。
  // 后果不是崩，是**分母失真**——"套件共 N 条"不再由仓库决定，而由此刻活着几个平面决定。
  // 这一格收窄不会少收任何真测试：磁盘上 117 个测试文件今天**全部**在 `tests/` 下面（`.scratch/ki099_files.mjs` 量的），
  // 而这条 pattern 与 `scripts/test.mjs` 的磁盘名册由 `tests/unit/test-scope.test.ts` 逐条对账（两边不一致就是红）。
  test: {
    include: ['tests/**/*.{test,spec}.?(c|m)[jt]s?(x)'],
  },
  build: {
    target: 'es2022',
    // three 拆出来后仍是 531 kB（three.module 只是 three.core 的再导出，原子片切不动）。
    // 阈值抬到 550 只为放行这一片第三方原子 vendor；应用侧各片都 ≤104 kB，
    // 若将来有自家代码涨到这个尺寸，这条警告照样会响——别把它再抬回去。
    chunkSizeWarningLimit: 550,
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          const f = id.replace(/\\/g, '/')
          if (f.includes('node_modules/three')) return 'three'
          if (f.includes('/src/data/')) return 'data'
          if (f.includes('/src/ui/')) return 'ui'
          if (f.includes('/src/audio/')) return 'audio'
          if (f.includes('/src/world/') || f.includes('/src/vfx/')) return 'render'
          return undefined
        }
      }
    }
  }
})
