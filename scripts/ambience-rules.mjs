/**
 * scripts/ambience-rules.mjs — 环境声床表（`ambience.json`）的判据本体（KI-083）
 *
 * 为什么不住在 `validate-data.mjs` 里：与 `explore-rules.mjs`／`battle-rules.mjs` **一字不差**的
 * 同一个理由——那个文件一被 import 就去校验真表并 `process.exit`，于是"喂一张非法床、看它拒不拒"
 * 这一半在测试里做不了。一条只有 accept 侧有人量的门
 * 不算门。判据搬到这里之后，门禁与 `tests/unit/ambience-table.test.ts` 读的是同一段代码。
 *
 * 刻意留在校验器的那一半：`hz`/`peak`/`detune`/`attackSec`/`durSec`/`everySec` 的范围、缺失、
 * 非有限数——那三种说法由 `report.num`/`report.sub` 全场统一管，搬过来等于给同一句话配第二个主人。
 */

/** `schema.ts > AmbienceBed` 的字段。运行时白名单就是这一张（vocab 对账钉着它与声明同长） */
export const AMB_BED_FIELDS = ['id', 'layers', 'lpHz', 'breath', 'sources', 'bell']
/** `AmbienceLayer`：§4 的 L1 drone 的一条声部 */
export const AMB_LAYER_FIELDS = ['hz', 'wave', 'peak', 'detune']
/** `AmbienceBell`：§4 的 L4 稀疏事件 */
export const AMB_BELL_FIELDS = ['scale', 'everySec', 'peak', 'hammerP']
/** `AmbienceSource`：§4 的 L2／L3 真位置声源（KI-083） */
export const AMB_SOURCE_FIELDS = ['layer', 'hz', 'pos', 'peak', 'attackSec', 'durSec', 'everySec']
/** 四份 WebAudio 波形（主人是 `AmbienceLayer.wave` 那条声明） */
export const AMB_WAVES = new Set(['sine', 'square', 'sawtooth', 'triangle'])
/** §4 的两层：顺序就是文档里的层序（L2 在前），报错话术按它走 */
export const AMB_SOURCE_LAYERS = ['texture', 'motion']
/** 上面那两种层的人话读法，只用在报错里（读表的人不该为了看懂一句 ERROR 去翻文档） */
export const AMB_SOURCE_LAYER_NAMES = { texture: 'L2 颗粒声纹', motion: 'L3 物理动源' }
/** 「一区一主音」的可辨阈值（音分）：低于这个数，跨那两区听不出换了地方 */
export const MIN_ROOT_CENTS = 50

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v)
const isArr = (v) => Array.isArray(v)
const isStr = (v) => typeof v === 'string' && v.length > 0
const isNum = (v) => typeof v === 'number' && Number.isFinite(v)

/**
 * 表 + 区域 → 一串 findings（`{ level, file, where, msg }`）。
 * `beds` 是 `ambience.json` 的顶层数组、`regions` 是 `regions.json` 的顶层数组；
 * 两个入参都由调用方原样传入，这里只读不改。
 */
export function ambienceFindings(beds, regions) {
  const file = 'ambience.json'
  const out = []
  const err = (where, msg, at = file) => out.push({ level: 'error', file: at, where, msg })

  if (!isArr(beds)) { err(file, '顶层必须是数组'); return out }

  /** 反查表：`regions.json > music.ambience` 指过的床 id → 指它的那些区域 id（双向对账的左半边） */
  const refBy = new Map()
  /** 区域 id → 那一区的行：既是"一区一床"的另一半，也是声源 `pos` 的框 */
  const regionOf = new Map()
  for (const rg of (isArr(regions) ? regions : []).filter(isObj)) {
    if (!isStr(rg.id)) continue
    regionOf.set(rg.id, rg)
    const a = isObj(rg.music) ? rg.music.ambience : undefined
    if (!isStr(a)) continue // 那一格由 validateRegions 报
    refBy.set(a, [...(refBy.get(a) ?? []), rg.id])
  }

  const ids = new Set()
  /** 主音名册：`床 id → drone 主音`（= 最低那条层），用来逐对量音分 */
  const roots = new Map()
  let belowBand = 0

  for (const [i, bed] of beds.entries()) {
    if (!isObj(bed)) { err(`[${i}]`, '必须是对象'); continue }
    const w = isStr(bed.id) ? bed.id : `[${i}]`
    if (!isStr(bed.id)) err(w, 'id 缺失或非字符串')
    else if (ids.has(bed.id)) err(w, `id 重复：${bed.id}`)
    else ids.add(bed.id)
    for (const k of Object.keys(bed)) {
      if (!AMB_BED_FIELDS.includes(k)) err(`${w}.${k}`, '未知字段：声床的字段就是 `schema.ts > AmbienceBed` 那六个，加字段要连消费方一起加')
    }

    if (!isArr(bed.layers)) err(`${w}.layers`, '必须是数组（可以为空——空 = 这一区没有 drone）')
    else {
      bed.layers.forEach((l, li) => {
        const lw = `${w}.layers[${li}]`
        if (!isObj(l)) { err(lw, '必须是对象'); return }
        for (const k of Object.keys(l)) if (!AMB_LAYER_FIELDS.includes(k)) err(`${lw}.${k}`, '未知字段：drone 单层只有 hz/wave/peak/detune')
        if (!AMB_WAVES.has(l.wave)) err(`${lw}.wave`, `wave=${JSON.stringify(l.wave)} 非法（${[...AMB_WAVES].join('/')}）`)
      })
      // 存在性绑定：drone 子图不在，暖度低通与呼吸 LFO 就没有落脚的节点
      if (bed.layers.length > 0) {
        if (bed.breath === undefined) err(`${w}.breath`, '有 drone 层就必须写 breath——静止不变的 drone 是电流声，不是风箱')
      } else {
        if (bed.lpHz !== undefined) err(`${w}.lpHz`, 'layers 为空（这一区没有 drone）却写了 lpHz：给一张不存在的图配参数')
        if (bed.breath !== undefined) err(`${w}.breath`, 'layers 为空（这一区没有 drone）却写了 breath：给一张不存在的图配参数')
      }
      /**
       * §1.2 的结构性承诺：七区七主音。这里只查**彼此不同**（两区同主音 = 跨区听不出换了地方），
       * 不查"是不是 F/C/G…"——那要把文档那张表的音名抄进脚本，正是 KI-074 要拆掉的手抄。
       */
      const hzs = bed.layers.filter((l) => isObj(l) && isNum(l.hz)).map((l) => l.hz)
      if (hzs.length > 0) {
        const root = Math.min(...hzs)
        // 状态变体床（§2.3 盐歌人声垫片那族）：`X_meg` 是床 X 的变体——同一张床加一层，
        // 主音**必须**与基床相同（同一区的调性不因她在不在而换），所以它不进两两比对
        //（比对自己人必红），改查同主音这条更强的构造约束。
        const variantOf = w.endsWith('_meg') ? w.slice(0, -'_meg'.length) : null
        if (variantOf && roots.has(variantOf)) {
          const baseRoot = roots.get(variantOf)
          if (Math.abs(root - baseRoot) > 0.01) err(w, `变体床的主音 ${root.toFixed(2)}Hz 与基床 ${variantOf} 的 ${baseRoot.toFixed(2)}Hz 不同——变体是「同一张床加一层」，不是换调（§1.2 一区一主音）`)
        } else {
          for (const [other, or] of roots) {
            const cents = Math.abs(1200 * Math.log2(root / or))
            if (cents < MIN_ROOT_CENTS) err(w, `drone 主音 ${root.toFixed(2)}Hz 与 ${other} 的 ${or.toFixed(2)}Hz 只差 ${cents.toFixed(1)} 音分——§1.2「一区一主音」塌了，跨区听不出换地方`)
          }
        }
        roots.set(w, root)
      }
    }

    if (bed.bell === null || bed.bell === undefined) {
      if (bed.bell === undefined) err(`${w}.bell`, '必须显式写 null 或一张铃点表——缺字段读不出是"没有事件"还是"忘了写"')
    } else if (!isObj(bed.bell)) err(`${w}.bell`, '必须是对象或 null')
    else {
      for (const k of Object.keys(bed.bell)) if (!AMB_BELL_FIELDS.includes(k)) err(`${w}.bell.${k}`, '未知字段：铃点表只有 scale/everySec/peak/hammerP')
      const sc = bed.bell.scale
      if (!isArr(sc) || sc.length === 0) err(`${w}.bell.scale`, '必须是非空数组（空 = 这一区有事件位却永远掷不出音）')
      else {
        const seen = new Set()
        sc.forEach((f, si) => {
          if (!isNum(f)) return // 不是数的那些由 report.num 说，重复与否在这里没有意义
          if (seen.has(f)) err(`${w}.bell.scale[${si}]`, `音高重复：${f}Hz 在同一张名册里出现两次——它只会让那一颗被掷得更勤，不是另一个色彩`)
          seen.add(f)
        })
      }
      // §4 的 L4 那一格写的是「30–120s 随机」。本表的间隔沿用的是 KI-077 之前的实机口径（雾语林 5–9s 一颗），
      // 把它挪进文档那一格是一次**听感裁决**而不是数据整理，所以这里只登记不擅改（KNOWN_ISSUES KI-077）。
      if (isArr(bed.bell.everySec) && bed.bell.everySec[1] < 30) belowBand++
    }

    /**
     * §4 的 L2／L3（KI-083）。这一格钉四件事：
     * ①两层都要有——§4 那张表每一区都写了 L2 与 L3，少一层就是声景少了一半；
     * ②字段集合与 `layer` 的名册（只有 texture/motion 两个词）；
     * ③`pos` 必须落在**拥有这张床那一区的 bounds 之内**——§4 要的是真位置，区外的声源永远听不见（§55）；
     * ④`everySec` 是一对且下限不大于上限（"最短比最长还长"是写着玩的，读出来只会得到一堆并列的随机）。
     * 数值范围不在这里（`report.num` 管那三种说法），存在性也一样。
     */
    if (!isArr(bed.sources)) {
      err(`${w}.sources`, '必须是数组：§4 那张表每一区都写了 L2（颗粒声纹）与 L3（物理动源），缺这一格 = 这一区的声景整层缺席')
    } else if (bed.sources.length === 0) {
      err(`${w}.sources`, '不能为空：§4 那张表每一区都写了 L2 与 L3，一格都没写就是声景整层缺席')
    } else {
      const owner = (refBy.get(w) ?? []).map((rid) => regionOf.get(rid)).find(Boolean)
      const seenLayers = new Set()
      /**
       * 有哪一条源的 `layer` 读不出来（不是对象 / 不是那两个词）时**不判"少了哪一层"**：
       * 那一句的结论这时不成立（缺的那一层可能就藏在这条读不出来的源里），两条一起红只会让人
       * 在"层名打错"与"少写一层"之间读不出真因——一条错报两条是读数质量问题，不是严格。
       */
      let opaque = false
      bed.sources.forEach((s, si) => {
        const sw = `${w}.sources[${si}]`
        if (!isObj(s)) { err(sw, '必须是对象'); opaque = true; return }
        for (const k of Object.keys(s)) {
          if (!AMB_SOURCE_FIELDS.includes(k)) err(`${sw}.${k}`, '未知字段：真位置声源只有 layer/hz/pos/peak/attackSec/durSec/everySec')
        }
        if (!AMB_SOURCE_LAYERS.includes(s.layer)) {
          err(`${sw}.layer`, `layer=${JSON.stringify(s.layer)} 非法：§4 只有 texture（L2 颗粒声纹）与 motion（L3 物理动源）两层`)
          opaque = true
        } else seenLayers.add(s.layer)
        const e = s.everySec
        if (isArr(e)) {
          if (!isNum(e[0]) || !isNum(e[1])) err(`${sw}.everySec`, '两端必须是有限数值')
          else if (e[0] > e[1]) err(`${sw}.everySec`, `需 下限 <= 上限（${e[0]} / ${e[1]}）`)
        }
        if (s.pos !== undefined && !isObj(s.pos)) err(`${sw}.pos`, '必须是 { x, y, z } 对象')
        else if (isObj(s.pos) && owner && isObj(owner.bounds) && ['x', 'y', 'z'].every((k) => isNum(s.pos[k]))) {
          const b = owner.bounds
          const outside = s.pos.x < b.minX || s.pos.x > b.maxX || s.pos.y < b.minY || s.pos.y > b.maxY || s.pos.z < b.minZ || s.pos.z > b.maxZ
          if (outside) err(`${sw}.pos`, `声源落在 ${owner.id} 的 bounds 之外（${s.pos.x}/${s.pos.y}/${s.pos.z}）——§4 要的是真位置，区外的声源永远听不见，那就是 §55 的死数据`)
        }
      })
      for (const layer of (opaque ? [] : AMB_SOURCE_LAYERS)) {
        if (!seenLayers.has(layer)) {
          err(`${w}.sources`, `少了 ${AMB_SOURCE_LAYER_NAMES[layer]} 那一层（layer: "${layer}"）：§4 那张表每一区 L2 与 L3 都写了，只写一半 = 声景少了一半`)
        }
      }
    }
  }

  // 与 regions.json 双向对账（两个方向都是 ERROR：少一行 = 那一区永远没有底噪，多一行 = §55 死数据）
  for (const [a, regs] of refBy) {
    if (!ids.has(a)) err(a, `${regs.join(', ')} 指它当环境声床，但表里没有这一行 ⇒ 进那一区永远没有底噪，听感上等价于"音频坏了"`)
    if (regs.length > 1) err('music.ambience', `${regs.join(' / ')} 共用同一张声床 '${a}'——一区一张是 §1.2 的承诺，共用 = 跨那两区什么都没换`, 'regions.json')
  }
  for (const id of ids) {
    // 状态变体床的引用是**组合根机械派生**的（main.ts 的 `ambienceBedOf`：基床 id + '_meg'）——
    // 基床被区域引用 + 变体行存在 ⇒ 可达；不认这条就会把「她在的时候休垒加一层人声」判成死数据。
    const variantBase = id.endsWith('_meg') ? id.slice(0, -'_meg'.length) : null
    if (!refBy.has(id) && !(variantBase && refBy.has(variantBase))) err(id, '没有任何区域指它 ⇒ §55 死数据：这张床永远不会被装进耳朵')
  }

  if (belowBand > 0) {
    out.push({
      level: 'warn',
      file,
      where: 'bell.everySec',
      msg: `${belowBand} 张声床的铃点间隔上限低于 §4 的「30–120s 稀疏事件」那一格（现值沿用 KI-077 之前的实机口径 5–9s）：挪进文档那一格是听感裁决，已登记，不做静默改动`,
    })
  }
  return out
}
