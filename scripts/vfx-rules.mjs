/**
 * scripts/vfx-rules.mjs — 表现层三件套（贴花 / 拖尾 / 发射器）的配置表判据（KI-135，Phase B4）。
 *
 * 为什么不住在 `validate-data.mjs` 里：那文件一被 import 就去校验真表并 `process.exit`，
 * 于是「喂一份坏配置、看它拒不拒」这一半在测试里做不了（`ambience-rules.mjs` /
 * `weather-rules.mjs` / `lighting-rules.mjs` 同一个理由）。判据搬到这里之后，
 * 门禁与 `tests/unit/vfx-table.test.ts` 读的是同一段代码。
 *
 * 这一节量的是**配置本身能不能被表现层兑现**：
 *   · 贴花：类型在名册里、寿命与淡入淡出非负、尺寸区间不倒、颜色是合法 hex、不透明度 ∈ [0,1]、
 *     实例上限 ≥ 1（上限 0 ＝ 永远画不出来，那一格不许静默通过）；
 *   · 拖尾：段数 ≥ 2（1 段画不出"拖尾"）、宽度两格非负且尖端不宽于根部、颜色两格合法 hex、
 *     寿命 > 0、混合模式在名册里、发射间距非负；
 *   · 发射器：类型与生成形状在名册里、粒子上限 ≥ 1、生成率 > 0、寿命区间不倒、尺寸两端非负、
 *     颜色两格合法 hex、速度区间逐轴不倒、重力与阻尼是有限数且阻尼 ≥ 0、混合模式在名册里。
 *
 * **一份表三段**（`decals` / `trails` / `emitters`）：与 `movements.json`（`slots`/`damage`/
 * `upgradeCost`/`pages`）同一族形状——一个表现层的"配置"本就是三样东西，硬拆成三个文件
 * 会让"读这张表"变成三次 import。**但 id 空间分三段**：三段各自唯一，不许跨段重名
 * （重名会让"这张 id 指的是哪一种配置"变成猜的）。
 *
 * 判据的分母全是现推的（表多长就多少行），不许手钉：表会长大，钉死的分母会骗人。
 */

const DECAL_TYPES = new Set(['bullet', 'impact', 'footstep', 'blood', 'scorch', 'crack', 'custom'])
const EMITTER_TYPES = new Set(['burst', 'stream', 'trail', 'ribbon'])
const SPAWN_SHAPES = new Set(['point', 'sphere', 'box', 'cone', 'disc'])
const BLENDINGS = new Set(['normal', 'additive', 'multiply'])

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v)
const isArr = (v) => Array.isArray(v)
const isStr = (v) => typeof v === 'string' && v.length > 0
const isNum = (v) => typeof v === 'number' && Number.isFinite(v)

/** `#rgb` / `#rrggbb`（与 `lighting.json` 的 hex 写法同一族） */
export const isHexColor = (v) => isStr(v) && /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(v)

/**
 * 判据本体。
 * @param {string} file 表名（只进消息里）
 * @param {any} table 整张表
 * @returns {{where: string, why: string}[]}
 */
export function vfxFindings(file, table) {
  const out = []
  if (!isObj(table)) {
    out.push({ where: file, why: '整张表必须是对象，且带 decals / trails / emitters 三段' })
    return out
  }
  for (const seg of ['decals', 'trails', 'emitters']) {
    if (!isArr(table[seg])) out.push({ where: `${file}.${seg}`, why: '这一段必须是数组（可以是空数组，但不能缺）' })
  }
  if (out.length > 0) return out

  const ids = new Map() // id → 段名（跨段重名的判据）
  const claim = (id, seg, where) => {
    if (ids.has(id)) {
      out.push({ where, why: `id '${id}' 已经在 ${ids.get(id)} 段出现过：两张表共用一个 id ⇒ "这一行指哪种配置"变成猜的` })
      return
    }
    ids.set(id, seg)
  }

  // ---- 贴花 ----
  table.decals.forEach((row, i) => {
    const where = `${file}.decals[${i}]`
    if (!isObj(row)) { out.push({ where, why: '必须是对象' }); return }
    if (!isStr(row.id)) out.push({ where: `${where}.id`, why: '必须是非空字符串' })
    else claim(row.id, 'decals', `${where}.id`)
    if (!DECAL_TYPES.has(row.type)) out.push({ where: `${where}.type`, why: `未知类型：${row.type}（${[...DECAL_TYPES].join('/')}）` })
    if (!isNum(row.lifetime) || row.lifetime < 0) out.push({ where: `${where}.lifetime`, why: '必须是非负数（-1 表示永久，但表里写 -1 之外的负数是错的）' })
    if (!isNum(row.fadeIn) || row.fadeIn < 0) out.push({ where: `${where}.fadeIn`, why: '必须是非负数' })
    if (!isNum(row.fadeOut) || row.fadeOut < 0) out.push({ where: `${where}.fadeOut`, why: '必须是非负数' })
    if (!isObj(row.size) || !isNum(row.size.min) || !isNum(row.size.max)) out.push({ where: `${where}.size`, why: '必须带 min / max 两个数' })
    else if (row.size.min > row.size.max) out.push({ where: `${where}.size`, why: 'min 不得大于 max（尺寸区间倒过来了）' })
    else if (row.size.min <= 0) out.push({ where: `${where}.size.min`, why: '必须大于 0：零尺寸的贴花画不出来' })
    if (!isObj(row.color)) out.push({ where: `${where}.color`, why: '必须带 base / opacity' })
    else {
      if (!isHexColor(row.color.base)) out.push({ where: `${where}.color.base`, why: '必须是 #rgb 或 #rrggbb 的 hex' })
      if (!isNum(row.color.opacity) || row.color.opacity < 0 || row.color.opacity > 1) out.push({ where: `${where}.color.opacity`, why: '必须落在 [0,1]' })
    }
    if (!isNum(row.normalStrength) || row.normalStrength < 0) out.push({ where: `${where}.normalStrength`, why: '必须是非负数' })
    if (!isNum(row.roughnessOffset)) out.push({ where: `${where}.roughnessOffset`, why: '必须是有限数' })
    if (!isNum(row.metalnessOffset)) out.push({ where: `${where}.metalnessOffset`, why: '必须是有限数' })
    if (typeof row.randomRotation !== 'boolean') out.push({ where: `${where}.randomRotation`, why: '必须是布尔' })
    if (typeof row.randomScale !== 'boolean') out.push({ where: `${where}.randomScale`, why: '必须是布尔' })
    if (!isNum(row.maxInstances) || row.maxInstances < 1) out.push({ where: `${where}.maxInstances`, why: '必须 ≥ 1：上限 0 意味着这一格永远画不出来' })
  })

  // ---- 拖尾 ----
  table.trails.forEach((row, i) => {
    const where = `${file}.trails[${i}]`
    if (!isObj(row)) { out.push({ where, why: '必须是对象' }); return }
    if (!isStr(row.id)) out.push({ where: `${where}.id`, why: '必须是非空字符串' })
    else claim(row.id, 'trails', `${where}.id`)
    if (!isNum(row.segments) || row.segments < 2) out.push({ where: `${where}.segments`, why: '必须 ≥ 2：1 段画不出拖尾（那是一块板）' })
    if (!isArr(row.width) || row.width.length !== 2 || !row.width.every(isNum)) out.push({ where: `${where}.width`, why: '必须是两个数 [根部, 尖端]' })
    else if (row.width[0] < 0 || row.width[1] < 0) out.push({ where: `${where}.width`, why: '宽度不得为负' })
    else if (row.width[1] > row.width[0]) out.push({ where: `${where}.width`, why: '尖端宽度不得宽于根部（拖尾是收尖的）' })
    if (!isArr(row.color) || row.color.length !== 2 || !row.color.every(isHexColor)) out.push({ where: `${where}.color`, why: '必须是两个合法 hex [根部, 尖端]' })
    if (!isNum(row.lifetime) || row.lifetime <= 0) out.push({ where: `${where}.lifetime`, why: '必须 > 0：寿命 0 的拖尾一帧都留不住' })
    if (!isStr(row.blending) || !BLENDINGS.has(row.blending)) out.push({ where: `${where}.blending`, why: `未知混合模式：${row.blending}（${[...BLENDINGS].join('/')}）` })
    if (typeof row.followRotation !== 'boolean') out.push({ where: `${where}.followRotation`, why: '必须是布尔' })
    if (!isNum(row.minEmitDist) || row.minEmitDist < 0) out.push({ where: `${where}.minEmitDist`, why: '必须是非负数' })
  })

  // ---- 发射器 ----
  table.emitters.forEach((row, i) => {
    const where = `${file}.emitters[${i}]`
    if (!isObj(row)) { out.push({ where, why: '必须是对象' }); return }
    if (!isStr(row.id)) out.push({ where: `${where}.id`, why: '必须是非空字符串' })
    else claim(row.id, 'emitters', `${where}.id`)
    if (!EMITTER_TYPES.has(row.type)) out.push({ where: `${where}.type`, why: `未知类型：${row.type}（${[...EMITTER_TYPES].join('/')}）` })
    if (!isNum(row.maxParticles) || row.maxParticles < 1) out.push({ where: `${where}.maxParticles`, why: '必须 ≥ 1' })
    if (!isNum(row.spawnRate) || row.spawnRate <= 0) out.push({ where: `${where}.spawnRate`, why: '必须 > 0' })
    if (!SPAWN_SHAPES.has(row.spawnShape)) out.push({ where: `${where}.spawnShape`, why: `未知生成形状：${row.spawnShape}（${[...SPAWN_SHAPES].join('/')}）` })
    if (!isObj(row.spawnSize) || !['x', 'y', 'z'].every((k) => isNum(row.spawnSize?.[k]))) out.push({ where: `${where}.spawnSize`, why: '必须带 x / y / z 三个数' })
    if (!isObj(row.lifetime) || !isNum(row.lifetime.min) || !isNum(row.lifetime.max)) out.push({ where: `${where}.lifetime`, why: '必须带 min / max 两个数' })
    else if (row.lifetime.min > row.lifetime.max) out.push({ where: `${where}.lifetime`, why: 'min 不得大于 max（寿命区间倒过来了）' })
    else if (row.lifetime.min < 0) out.push({ where: `${where}.lifetime.min`, why: '不得为负' })
    if (!isObj(row.size) || !isNum(row.size.start) || !isNum(row.size.end)) out.push({ where: `${where}.size`, why: '必须带 start / end 两个数' })
    else if (row.size.start < 0 || row.size.end < 0) out.push({ where: `${where}.size`, why: '不得为负' })
    if (!isObj(row.color) || !isHexColor(row.color.start) || !isHexColor(row.color.end)) out.push({ where: `${where}.color`, why: '必须带 start / end 两个合法 hex' })
    if (!isObj(row.velocity) || !isObj(row.velocity.min) || !isObj(row.velocity.max)) out.push({ where: `${where}.velocity`, why: '必须带 min / max 两个向量' })
    else {
      for (const k of ['x', 'y', 'z']) {
        if (!isNum(row.velocity.min?.[k]) || !isNum(row.velocity.max?.[k])) out.push({ where: `${where}.velocity`, why: `min / max 都必须带 ${k} 分量` })
        else if (row.velocity.min[k] > row.velocity.max[k]) out.push({ where: `${where}.velocity`, why: `${k} 分量 min 不得大于 max` })
      }
    }
    if (!isObj(row.acceleration) || !['x', 'y', 'z'].every((k) => isNum(row.acceleration?.[k]))) out.push({ where: `${where}.acceleration`, why: '必须带 x / y / z 三个数' })
    if (!isNum(row.gravity)) out.push({ where: `${where}.gravity`, why: '必须是有限数' })
    if (!isNum(row.drag) || row.drag < 0) out.push({ where: `${where}.drag`, why: '必须是非负数' })
    if (!isStr(row.blending) || !BLENDINGS.has(row.blending)) out.push({ where: `${where}.blending`, why: `未知混合模式：${row.blending}（${[...BLENDINGS].join('/')}）` })
    if (typeof row.depthWrite !== 'boolean') out.push({ where: `${where}.depthWrite`, why: '必须是布尔' })
    if (typeof row.sizeAttenuation !== 'boolean') out.push({ where: `${where}.sizeAttenuation`, why: '必须是布尔' })
  })

  return out
}

/** 三个 id 段的全集（发射方按 id 找配置时用；跨段重名在判据里已经红） */
export function vfxConfigIds(table) {
  const ids = []
  for (const seg of ['decals', 'trails', 'emitters']) {
    for (const row of isArr(table?.[seg]) ? table[seg] : []) {
      if (isObj(row) && isStr(row.id)) ids.push(row.id)
    }
  }
  return ids
}
