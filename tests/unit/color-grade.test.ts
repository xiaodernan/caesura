import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { ColorGrade, gradeFilter } from '@/vfx/ColorGrade'
import { regions, weatherRows } from '@/data'
import type { WeatherRow } from '@/data/schema'
import { WEATHER_BASELINE_ID } from '../../scripts/weather-rules.mjs'

/**
 * 画面调色唯一仲裁者的行为腿（KI-094①）。
 *
 * **这一格为什么必须存在**：`weather.json` 的读数与 §11 失谐的褪色在 2026-09-30 之前写的是同一条
 * `canvas.style.filter`，而写它的是 `main.ts` 里那个 `setVeil()`。任何一方单独往这条字符串上写，
 * 浏览器里就是后盖前的：天气乘数会擦掉失谐，失谐会擦掉天气。这份文件量的不是"读得到表"，
 * 而是**合成发生了**，并且发生在唯一一个写方身上。
 *
 * 最后那一组是源码门：雾密度与滤镜今天各只有一个写方，`ColorGrade` 里那个基线 id 字面量与判据
 * 用的是同一个字（两个平面各写一遍就会有一天不一致）。
 */

/** 中文目录名在 `.pathname` 上会被百分号编码成一条不存在的路径 ⇒ 走 `fileURLToPath`（与 `ducking.test.ts` 同一个根） */
const ROOT = fileURLToPath(new URL('../../', import.meta.url))

function srcFiles(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const p = `${dir}/${name}`
    if (statSync(p).isDirectory()) out.push(...srcFiles(p))
    else if (/\.(ts|tsx)$/.test(name)) out.push(p)
  }
  return out
}

/** 普查结果一律换成相对 root 的正斜杠名（绝对路径混进 `not.toContain` 会静默通过，与 ducking.test.ts 同一条理由） */
const rel = (f: string): string => f.slice(ROOT.length).replace(/\\/g, '/')
const SRC = srcFiles(`${ROOT}src`).map((f) => ({ path: rel(f), text: readFileSync(f, 'utf8') }))

/** 假画布：只记"被写了几次"与最后一次的值——重复写同一条字符串是本模块唯一的性能风险 */
function fakeCanvas(): { el: HTMLCanvasElement; writes: () => number; value: () => string } {
  let n = 0
  let v = ''
  const style = {
    get filter(): string { return v },
    set filter(next: string) { v = next; n++ },
  }
  return { el: { style } as unknown as HTMLCanvasElement, writes: () => n, value: () => v }
}

/** 真场景形状（three 在 node 里可以直接构造，不需要 WebGL 上下文）：指数雾 + 构造时那个写死的密度 */
function fogScene(density = 0.028): { scene: THREE.Scene; fog: THREE.FogExp2 } {
  const fog = new THREE.FogExp2(0x0b0e16, density)
  const scene = new THREE.Scene()
  scene.fog = fog
  return { scene, fog }
}

const region = (id: string) => regions.find((r) => r.id === id) ?? null

/** 合成律本身（不碰 DOM 的那一半，测试直接吃它） */
describe('合成律：天气说话与失谐说话是乘在一起，不是互相覆盖', () => {
  it('两边都没话说 ⇒ 空串（= 不挂滤镜，与"没天气、没失谐"逐像素等价）', () => {
    expect(gradeFilter(0, {})).toBe('')
  })

  it('只有天气（Fog 对比 ×0.6）⇒ 只有 contrast，不去动 saturate', () => {
    expect(gradeFilter(0, { contrastMul: 0.6 })).toBe('contrast(0.60)')
  })

  it('只有失谐 ⇒ 与 `setVeil` 搬走之前**逐字相同**（行为回归带：旧公式在这里重算一遍）', () => {
    for (const v of [0.05, 0.33, 0.6, 1]) {
      const q = Math.round(v * 20) / 20
      const legacy = q > 0 ? `saturate(${(1 - q).toFixed(2)}) brightness(${(1 - q * 0.3).toFixed(2)})` : ''
      expect(gradeFilter(v, {}), `失谐 ${v} 的读数换了：§11 那条视觉压力被这次改动改掉了`).toBe(legacy)
    }
  })

  it('两边都说话 ⇒ 亮度是天气乘数 × 失谐斜率，谁也没盖掉谁', () => {
    // q = 0.5：失谐那一半给 1 − 0.5×0.3 = 0.85；天气那一半给 ×0.8 ⇒ 0.68
    expect(gradeFilter(0.5, { brightnessMul: 0.8 })).toBe('saturate(0.50) brightness(0.68)')
    expect(gradeFilter(0.5, { contrastMul: 1.15 })).toBe('saturate(0.50) brightness(0.85) contrast(1.15)')
  })

  it('量化到 5% 一档仍然成立：0.024 不说任何话，0.026 说一档', () => {
    expect(gradeFilter(0.024, {}), '不过 5% 也写滤镜 = 每帧重排，这条量化是性能量').toBe('')
    // 0.026 → q=0.05 ⇒ saturate(0.95)；亮度 = 1 − 0.05×0.3 = 0.985，`toFixed(2)` 在小数点后第二位
    // 走的是二进制那个略小的表示 ⇒ "0.98"。这里照抄读者真正得到的字符串，不照抄我以为的算术。
    expect(gradeFilter(0.026, {})).toBe('saturate(0.95) brightness(0.98)')
  })
})

describe('仲裁者：区域与失谐各自改输入，动手的只有 apply() 一处', () => {
  it('雾语林修钟后换成 fog（`weatherPresets[1]` 那条路今天没人写，先按名字喂）⇒ 雾从写死的 0.028 变成表里的 0.030，滤镜跟着对比乘数', () => {
    const { scene, fog } = fogScene(0.028)
    const c = fakeCanvas()
    const grade = new ColorGrade(scene, c.el)
    expect(fog.density, '构造时没走基线：ColorGrade 建好那一刻就该把雾接过去').toBeCloseTo(0.008, 6)
    grade.setWeather('fog')
    expect(fog.density).toBeCloseTo(0.03, 6)
    expect(c.value()).toBe('contrast(0.60)')
    expect(grade.fogDensity()).toBe(0.03)
  })

  it('换到深窖（驻留天气 hush 欠读数）⇒ 走基线那一行，而**这个事实是量出来的**不是注释', () => {
    const { scene, fog } = fogScene(0.028)
    const c = fakeCanvas()
    const grade = new ColorGrade(scene, c.el)
    grade.setRegion(region('rg_earless_deeps'))
    expect(fog.density).toBeCloseTo(0.008, 6)
    expect(c.value()).toBe('')
    expect(grade.fogDensity()).toBe(0.008)
  })

  it('失谐读数落在天气之上：换区不清掉褪色，褪色也不清掉天气', () => {
    const { scene, fog } = fogScene()
    const c = fakeCanvas()
    const grade = new ColorGrade(scene, c.el)
    grade.setWeather('fog')
    grade.setVeil(0.6)
    expect(c.value(), '天气先写、失谐后写而结果是单侧字符串 = 后盖前的那个 bug 又回来了')
      .toBe('saturate(0.40) brightness(0.82) contrast(0.60)')
    grade.setRegion(region('rg_unfinished_hall')) // 驻留 still：欠读数 ⇒ 基线
    expect(fog.density).toBeCloseTo(0.008, 6)
    expect(c.value()).toBe('saturate(0.40) brightness(0.82)')
  })

  it('每帧被叫同一个读数 ⇒ 一个字都不再写（量化与 applied 两条腿共同负责的这件事）', () => {
    const { scene } = fogScene()
    const c = fakeCanvas()
    const grade = new ColorGrade(scene, c.el)
    grade.setVeil(0.6)
    const after = c.writes()
    expect(after, '构造加一次 setVeil 之后一次都没写过 = 下面那句"不再写"什么都没证明').toBeGreaterThan(0)
    for (let i = 0; i < 50; i++) grade.setVeil(0.6)
    grade.setRegion(regions[0])
    grade.setRegion(regions[0])
    expect(c.writes(), '50 帧同读数 + 两次同区域 ⇒ 应该是零次重排').toBe(after)
  })

  it('表里这一行没给雾密度 ⇒ 雾保持**当时**的样子，而滤镜照旧（两格读数各自独立生效）', () => {
    const { scene, fog } = fogScene(0.05)
    const c = fakeCanvas()
    const rows = [
      weatherRows.find((r) => r.id === WEATHER_BASELINE_ID) as WeatherRow,
      { id: 'rainy', docWeather: 'rain', brightnessMul: 0.8 } as WeatherRow,
    ]
    const grade = new ColorGrade(scene, c.el, rows)
    // 构造走的是基线（它给了 fogDensity ⇒ 0.008）。这里再把它当成"别人写的"改回 0.05：
    // 今天 `world/PlaceholderArena.ts:25` 那个写死的构造参数就是这么一个别人， KI-094① 之后它该删，
    // 而删掉之前那一格不能被一条没声明雾密度的天气行悄悄按回基线值。
    fog.density = 0.05
    grade.setWeather('rainy')
    expect(fog.density, '没声明 fogDensity 的行不该去动雾：那会把别人的雾改成基线值').toBe(0.05)
    expect(c.value()).toBe('brightness(0.80)')
    expect(grade.fogDensity()).toBeNull()
  })

  it('天气名换成表里没有的 ⇒ 落回基线（判据那侧叫 pending，画面这侧叫按 clear 奏）', () => {
    const { scene, fog } = fogScene(0.028)
    const grade = new ColorGrade(scene, fakeCanvas().el)
    grade.setWeather('emberfall')
    expect(fog.density).toBeCloseTo(0.008, 6)
    grade.setWeather(null)
    expect(grade.fogDensity()).toBe(0.008)
  })
})

describe('源码门：这两格今天各只有一个写方', () => {
  const writersOf = (needle: RegExp): string[] => SRC.filter((f) => needle.test(f.text)).map((f) => f.path)

  it('先自证普查是活的：种群非空，而且真的含着要判的那两份文件', () => {
    const paths = SRC.map((f) => f.path)
    expect(paths.length, 'src 下读不到任何 .ts ⇒ 下面每一条"只有一个写方"都是空集合上的真话').toBeGreaterThan(50)
    expect(paths).toContain('src/vfx/ColorGrade.ts')
    expect(paths).toContain('src/main.ts')
  })

  it('`canvas.style.filter` 的赋值点只剩 ColorGrade 一处（main.ts 那个 setVeil 是真的搬走了）', () => {
    expect(writersOf(/style\.filter\s*=/g), '两个写方 = 后盖前的那个 bug 的形状').toEqual(['src/vfx/ColorGrade.ts'])
    const main = SRC.find((f) => f.path === 'src/main.ts')!.text
    expect(main).toMatch(/grade\.setVeil\(/)
    expect(main).not.toMatch(/function setVeil/)
    // 这里按**次数**判而不是按"出现过"判：A4 那一臂（删掉换区块里那句 `grade.setRegion(here)`）
    // 在只写 `toMatch(/grade\.setRegion\(/)` 的门上是**存活**的 —— 开局那一次调用替它把字符串留着了。
    // 天气腿于是只剩构造时那一遍，换区不再改雾，而门一声不响。
    // 数的时候锚在行首：main.ts:110 那句注释里也写着 `grade.setRegion(homeRegion …)`，
    // 不锚行首会把注释数进去（我第一次就这么把期望写成了 2 而实测 3）。
    const setRegion = (main.match(/^[ \t]*grade\.setRegion\(/gm) ?? []).length
    expect(setRegion, 'main.ts 里作为语句出现的 `grade.setRegion(` 次数变了：应当是"开局一次 + 换区一次"两处，少一处就是换区不喂天气')
      .toBe(2)
  })

  it('`fog.density` 的赋值点只有 ColorGrade；场景构造那一格仍是 FogExp2（那句类型收窄靠它）', () => {
    expect(writersOf(/\.density\s*=/g)).toEqual(['src/vfx/ColorGrade.ts'])
    expect(SRC.find((f) => f.path === 'src/world/PlaceholderArena.ts')!.text).toMatch(/scene\.fog = new THREE\.FogExp2\(/)
  })

  it('基线那个 id 字面量在两个平面是同一个字：判据的 WEATHER_BASELINE_ID ⇄ 读者的 BASELINE_ID', () => {
    const reader = SRC.find((f) => f.path === 'src/vfx/ColorGrade.ts')!.text.match(/const BASELINE_ID = '([^']+)'/)?.[1]
    expect(reader, '读不到 BASELINE_ID = 这条对账在空转').toBeTypeOf('string')
    expect(reader).toBe(WEATHER_BASELINE_ID)
    expect(weatherRows.find((r) => r.id === WEATHER_BASELINE_ID)?.fogDensity, '基线行没有雾密度：读者会在运行时才发现退路是空的')
      .toBeTypeOf('number')
  })

  it('现状量测（KI-094② 的靶子）：七区的**驻留**天气今天全部落回基线，非基线那两行只挂在 `weatherPresets[1]` 上', () => {
    const baseline = weatherRows.find((r) => r.id === WEATHER_BASELINE_ID)!.fogDensity as number
    const resting = weatherRows.filter((w) => regions.some((rg) => rg.weatherPresets[0] === w.id))
    expect(resting.map((r) => r.id), '驻留天气里出现了非基线行：那说明 ② 那条切换已经落地 ⇒ 这条"现状量测"必须换成按 [1] 断言，不许留着当假话')
      .toEqual([WEATHER_BASELINE_ID])
    const { scene, fog } = fogScene(0.028)
    const grade = new ColorGrade(scene, fakeCanvas().el)
    for (const rg of regions) {
      grade.setRegion(rg)
      expect(fog.density, `${rg.id} 的驻留天气奏出了非基线密度`).toBeCloseTo(baseline, 6)
    }
    // `[1]` 那条路今天的写方数量：除仲裁者自己（`setRegion` 内部走 `setWeather`）之外为零。
    // 这一格不是"设计如此"的糖衣，是把 §38/§2 那半句（换天气要任务线给的世界状态）欠的具体形状量出来。
    const callers = SRC.filter((f) => f.path !== 'src/vfx/ColorGrade.ts' && /\.setWeather\(/.test(f.text)).map((f) => f.path)
    expect(callers, '`setWeather` 出现了外部调用点：天气腿已接线 ⇒ KI-094 那行的 Partial 要改，这条臂也要跟着改').toEqual([])
  })

  it('每一区的驻留天气都由仲裁者读得到行或落回基线（表 ⇄ 真区 ⇄ 读者在同一趟里对上）', () => {
    const { scene } = fogScene(0.028)
    const grade = new ColorGrade(scene, fakeCanvas().el)
    const baseline = weatherRows.find((r) => r.id === WEATHER_BASELINE_ID)!.fogDensity as number
    const resting = regions.map((rg) => ({ id: rg.id, name: rg.weatherPresets[0] }))
    expect(resting.length, 'regions.json 读空 ⇒ 这一趟什么都没走').toBeGreaterThan(0)
    for (const rg of regions) {
      grade.setRegion(rg)
      const name = rg.weatherPresets[0]
      const row = weatherRows.find((r) => r.id === name)
      expect(grade.fogDensity(), `${rg.id} 的驻留天气 '${name}' 奏出了 null`).toBe(row?.fogDensity ?? baseline)
      if (row) expect(grade.fogDensity(), `${rg.id} 上 '${name}' 没用上表里的读数`).toBe(row.fogDensity)
    }
  })
})
