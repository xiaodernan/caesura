/**
 * 盒截面的**斜线**回归守卫 —— `core/Occlusion.ts > boxEnter` 的 slab 排序（第 137-141 行）。
 *
 * 为什么单开一条：`boxEnter` 的源码注释里记着一次真事故 ——
 * 「沿负方向走的那一轴，`b` 那一侧才是**离开**：先排好序，否则"进面"参数会是负数并把 hi 压到 0 以下
 * （实测：一条从胸口往下斜的线会整条被判为"没穿过墙"，红线不剪、近战不被吃）」。
 * 病根是 `d < 0` 时 `(b-p)/d` 与 `(t-p)/d` 的大小关系翻转：不排序就把**出参**当成了进参，
 * `lo >= hi` 直接判成「擦着边过去」。
 *
 * 而此前这一格只有两条**恒真断言**（`tests/unit/core-misc.test.ts` 与 `tests/unit/small-gaps.test.ts`
 * 各一条 `expect(true).toBe(true)`，注释还写着"firstBlock 没导出"——它其实导出了）。
 * 把它们删掉、排序也删掉，全量套件照样全绿。本文件补上真正会红的腿：
 * 三条用例全部手算几何，不读数据表。
 *
 * 墙（`box('w', 0, 0, 1.5, 18, 3)`）：x∈[-0.75, 0.75] ／ z∈[-9, 9] ／ y∈[0, 3]。
 * 线段 x 从 -10 到 10 ⇒ 进面 t = (-0.75+10)/20 = 0.4625，截点恒在 x = -0.75。
 */
import { describe, expect, it } from 'vitest'
import { firstBlock, type Occluder } from '@/core/Occlusion'

/** 轴对齐盒：`size` 是**全尺寸**（与 `regions.json > walls` 同口径），这里折成半尺寸 */
const box = (id: string, x: number, z: number, sizeX: number, sizeZ: number, heightM = 10, baseY = 0): Occluder =>
  ({ id, shape: 'box', pos: { x, y: baseY, z }, halfX: sizeX / 2, halfZ: sizeZ / 2, heightM })

describe('firstBlock 盒截面：斜线（slope ≠ 0）', () => {
  const wall = box('w', 0, 0, 1.5, 18, 3)

  it('向下斜穿（dy < 0，事故那一型）⇒ 必须被挡住，截在进面 x=-0.75', () => {
    const hit = firstBlock([wall], { x: -10, y: 2.5, z: 0 }, { x: 10, y: 0.5, z: 0 })
    expect(hit, '从胸口往下斜的线穿过墙 ⇒ 不许被判成「没穿过」').not.toBeNull()
    expect(hit!.occluderId).toBe('w')
    expect(hit!.at.x, '截在朝向我方的那一面（不是穿出面）').toBeCloseTo(-0.75, 6)
    // y 沿 t 线性：2.5 + (0.5-2.5) × 0.4625 = 1.575
    expect(hit!.at.y, '斜线的截点高度跟着 t 走').toBeCloseTo(1.575, 6)
  })

  it('向上斜穿（dy > 0，对照腿）⇒ 同一答案（排序不能只修一半）', () => {
    const hit = firstBlock([wall], { x: -10, y: 0.5, z: 0 }, { x: 10, y: 2.5, z: 0 })
    expect(hit).not.toBeNull()
    expect(hit!.at.x).toBeCloseTo(-0.75, 6)
    // 0.5 + (2.5-0.5) × 0.4625 = 1.425
    expect(hit!.at.y).toBeCloseTo(1.425, 6)
  })

  it('向下斜但从墙顶上方飞过 ⇒ 不算挡（斜 ≠ 挡）', () => {
    // y 从 8 降到 6，全程高于墙顶 3 ⇒ y 那一轴先把区间压空
    expect(firstBlock([wall], { x: -10, y: 8, z: 0 }, { x: 10, y: 6, z: 0 })).toBeNull()
  })
})
