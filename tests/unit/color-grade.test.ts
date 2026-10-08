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
 *
 * **这份文件不量的那一半**：「脚下这一区当前生效的是哪一格天气」——那是 `weatherPresets` × 任务线
 * 旗标的推导，住在 `src/world/WeatherSwitch.ts`，由 `tests/unit/weather-switch.test.ts` 量。
 * 这里只按**名字**喂仲裁者，因为仲裁者本来就不该认识区域（它一旦认识区域，画面层就有了第二份切换判据）。
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

/** 真场景形状（three 在 node 里可以直接构造，不需要 WebGL 上下文）：指数雾 + 构造前别人写的那一格密度。
 * 默认的 0.028 不是任何文档的数：它是 KI-094① 之前场景构造里那个写死的数，现在只留在这里当
 * 「别人写过一格」的合成读数——证明仲裁者构造时按基线把它按掉（下一条用例的 0.028→0.008 那一跳）。
 * 生产里的场景从 KI-094 遗留⑤（2026-10-01）起不再写密度（`world/PlaceholderArena.ts`），
 * 所以这里的数不是对生产的复刻，是「万一还有别人写雾」的挡板。 */
function fogScene(density = 0.028): { scene: THREE.Scene; fog: THREE.FogExp2 } {
  const fog = new THREE.FogExp2(0x0b0e16, density)
  const scene = new THREE.Scene()
  scene.fog = fog
  return { scene, fog }
}

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

describe('仲裁者：天气与失谐各自改输入，动手的只有 apply() 一处', () => {
  it('雾语林修钟后那格 fog 按名字喂进来 ⇒ 雾从写死的 0.028 变成表里的 0.030，滤镜跟着对比乘数', () => {
    const { scene, fog } = fogScene(0.028)
    const c = fakeCanvas()
    const grade = new ColorGrade(scene, c.el)
    expect(fog.density, '构造时没走基线：ColorGrade 建好那一刻就该把雾接过去').toBeCloseTo(0.008, 6)
    grade.setWeather('fog')
    expect(fog.density).toBeCloseTo(0.03, 6)
    expect(c.value()).toBe('contrast(0.60)')
    expect(grade.fogDensity()).toBe(0.03)
  })

  it('深窖的驻留名 hush 欠读数 ⇒ 走基线那一行，而**这个事实是量出来的**不是注释', () => {
    const { scene, fog } = fogScene(0.028)
    const c = fakeCanvas()
    const grade = new ColorGrade(scene, c.el)
    grade.setWeather('hush') // 区 → 天气名那一腿（含 pending 名字怎么落回基线）住在 tests/unit/weather-switch.test.ts
    expect(fog.density).toBeCloseTo(0.008, 6)
    expect(c.value()).toBe('')
    expect(grade.fogDensity()).toBe(0.008)
  })

  it('失谐读数落在天气之上：换天气不清掉褪色，褪色也不清掉天气', () => {
    const { scene, fog } = fogScene()
    const c = fakeCanvas()
    const grade = new ColorGrade(scene, c.el)
    grade.setWeather('fog')
    grade.setVeil(0.6)
    expect(c.value(), '天气先写、失谐后写而结果是单侧字符串 = 后盖前的那个 bug 又回来了')
      .toBe('saturate(0.40) brightness(0.82) contrast(0.60)')
    grade.setWeather('still') // 未竟厅的驻留名：欠读数 ⇒ 基线
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
    grade.setWeather('clear')
    grade.setWeather('clear')
    expect(c.writes(), '50 帧同读数 + 两次同天气 ⇒ 应该是零次重排').toBe(after)
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
    // 生产里原来那个别人（`world/PlaceholderArena.ts:25` 那个写死的构造参数）
    // 已随 KI-094 遗留⑤（2026-10-01）删掉；这一条钉的是"没声明 fogDensity 的行不许动雾"——
    // 0.05 只是"别人写过一格"的合成读数，有没有人真的写过它不重要。
    fog.density = 0.05
    grade.setWeather('rainy')
    expect(fog.density, '没声明 fogDensity 的行不该去动雾：那会把别人的雾改成基线值').toBe(0.05)
    expect(c.value()).toBe('brightness(0.80)')
    expect(grade.fogDensity()).toBeNull()
  })

  it('天气名换成表里没有的 ⇒ 落回基线（判据那侧叫 pending，画面这侧叫按 clear 奏）', () => {
    const { scene, fog } = fogScene(0.028)
    const grade = new ColorGrade(scene, fakeCanvas().el)
    // 'emberfall'（落烬）已在 eb97e2e 落成 §38 Rain 的行（雾 0.018 / 明度 ×0.8），不再是“没有读数”的名字。
    // 这里换成同样属于“区域自己的叫法”、但至今在 weather.json 里仍**没有行**的 'stone-wind'（石风）。
    grade.setWeather('stone-wind')
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
    // 按**次数**判而不是按"出现过"判：KI-094① 那一批的 A4 臂（删掉换区那一句喂天气的调用）在只写
    // `toMatch` 的门上是**存活**的——开局那一次调用替它把字符串留着了，门一声不响。
    // 数的时候锚在行首：注释里也写着 `applyWeather(homeRegion …)`，不锚行首会把注释数进去。
    const applied = (main.match(/^[ \t]*applyWeather\(/gm) ?? []).length
    expect(applied, 'main.ts 里作为语句出现的 `applyWeather(` 次数变了：应当是"开局一次 + 换区一次"两处，少一处就是有一侧不喂天气')
      .toBe(2)
    // 第三处入口：旗标广播。修钟那一刻人通常就站在那口钟旁边，等下一次跨区才换天就是"回报没兑现"。
    // 这一句独立成条是因为上面那个次数对它完全无感：把 `bus.on('world.flag', …)` 整句删掉，
    // 行首的 `applyWeather(` 仍然是 2。
    expect(main, '旗标广播不再重算天气：修好钟要走到下一个区域才看得见天变').toMatch(/^\s*bus\.on\('world\.flag',[^\n]*applyWeather\(/m)
    // 推导只有一个入口点：区域 ⇄ 旗标 ⇄ 天气名那一腿算出来的名字，只从 `applyWeather` 里那一句进仲裁者。
    const entries = (main.match(/^[ \t]*grade\.setWeather\(/gm) ?? []).length
    expect(entries, 'main.ts 里出现了第二处 `grade.setWeather(`：又变成两个写方各说一半').toBe(1)
    // `setRegion` 在 KI-094② 之后已从仲裁者身上删掉（它认识区域就等于把切换判据抄进画面层）。
    // 这里全 src 扫，而不是只扫 main.ts：`rpg.loot.setRegion(...)` 那种同名方法是另一个人的，所以锚在 `grade.`。
    expect(writersOf(/grade\.setRegion\(/g), '还有人在调 `grade.setRegion`：那个方法已经不存在，这行代码今天跑不到').toEqual([])
  })

  it('`fog.density` 的赋值点只有 ColorGrade；场景构造那一格仍是 FogExp2（那句类型收窄靠它）+ 里面没有密度字面量（KI-094 遗留⑤）', () => {
    expect(writersOf(/\.density\s*=/g)).toEqual(['src/vfx/ColorGrade.ts'])
    const arena = SRC.find((f) => f.path === 'src/world/PlaceholderArena.ts')!.text
    expect(arena).toMatch(/scene\.fog = new THREE\.FogExp2\(/)
    // 遗留⑤（2026-10-01）：场景里那个写死的 0.028 删了。这里钉的不是"今天怎么写"而是"密度这个数
    // 从此不住在场景里"——`FogExp2(color, density)` 的第二个实参一回来，就等于又给雾编了第二个主人。
    expect(arena, '场景构造里又出现了雾密度字面量：`FogExp2(color,`␣后面那个数唯一的家是 weather.json').not.toMatch(/new THREE\.FogExp2\([^()]*,/)
  })

  it('基线那个 id 字面量在两个平面是同一个字：判据的 WEATHER_BASELINE_ID ⇄ 读者的 BASELINE_ID', () => {
    const reader = SRC.find((f) => f.path === 'src/vfx/ColorGrade.ts')!.text.match(/const BASELINE_ID = '([^']+)'/)?.[1]
    expect(reader, '读不到 BASELINE_ID = 这条对账在空转').toBeTypeOf('string')
    expect(reader).toBe(WEATHER_BASELINE_ID)
    expect(weatherRows.find((r) => r.id === WEATHER_BASELINE_ID)?.fogDensity, '基线行没有雾密度：读者会在运行时才发现退路是空的')
      .toBeTypeOf('number')
  })

  it('天气腿的写方普查：`setWeather` 在仲裁者之外恰好被组合根调用一处', () => {
    // 这一格在 KI-094① 落地时断言的是**空集**（「`[1]` 那条路今天没有写方」），并在注释里写明
    // ② 落地时必须翻过来。今天翻了：`world/WeatherSwitch > activeWeather` 有了运行时读者，
    // main.ts 把名字喂进来。断言从"零"变成"恰一"而不是"若干"——第二个写方就是第二个仲裁者。
    const callers = SRC.filter((f) => f.path !== 'src/vfx/ColorGrade.ts' && /\.setWeather\(/.test(f.text)).map((f) => f.path)
    expect(callers, '天气名的外部写方不是恰好 src/main.ts：还是零 = 切换没接线，多于一个 = 又长出第二个写方').toEqual(['src/main.ts'])
  })

  it('regions.json 里被指着的**每一个**天气名（驻留那格与修钟后那格都算）都由仲裁者读得出行或落回基线', () => {
    const { scene } = fogScene(0.028)
    const grade = new ColorGrade(scene, fakeCanvas().el)
    const baseline = weatherRows.find((r) => r.id === WEATHER_BASELINE_ID)!.fogDensity as number
    const referenced = [...new Set(regions.flatMap((rg) => rg.weatherPresets))]
    expect(referenced.length, 'regions.json 的天气名读空 ⇒ 这一趟什么都没走').toBeGreaterThan(0)
    // 两侧都要有货：只有 `[0]` 被走到的话，"每一格都读得出"就退化成上一批那条被翻掉的现状量测。
    const secondSlot = [...new Set(regions.map((rg) => rg.weatherPresets[1]).filter((n): n is string => typeof n === 'string'))]
    expect(secondSlot.length, '没有任何一区声明第二格天气 ⇒ 这一趟走不到切换那一侧').toBeGreaterThan(0)
    let offBaseline = 0
    for (const name of referenced) {
      grade.setWeather(name)
      const row = weatherRows.find((r) => r.id === name)
      expect(grade.fogDensity(), `'${name}' 奏出了 null`).toBe(row?.fogDensity ?? baseline)
      if (row) {
        expect(grade.fogDensity(), `'${name}' 没用上表里的读数（${row.fogDensity}）`).toBe(row.fogDensity)
        if (row.fogDensity !== baseline) offBaseline++
      }
    }
    // 「修钟后天真的变了」这句话在画面层的前提：表里至少有一个非基线名能被走到。
    expect(offBaseline, '被指着的名字里没有一个给出非基线雾密度：切换拨到哪一格都是同一片雾').toBeGreaterThan(0)
  })
})
