#!/usr/bin/env node
/**
 * scripts/bake-navmesh.mjs — 导航网格烘焙工具（Phase B1 结案落点）。
 *
 * 从 regions.json 的 walls 烘焙导航网格，输出到 data/json/navmesh/ 目录。
 * 每个有 navmeshRef 的区域生成一个 .navmesh.json 文件，包含：
 *   - 顶点（平面 x/z，y=groundY）
 *   - 面（三角形索引，构成可走多边形）
 *   - 边（共享边，用于 A* 相邻搜索）
 *
 * 算法：将墙的外扩盒作为障碍，在区域 bounds 内做约束德劳内三角剖分，
 * 移除落在障碍内的三角形，剩余即可走区域。
 *
 * 用法：
 *   node scripts/bake-navmesh.mjs           # 烘焙所有有 navmeshRef 的区域
 *   node scripts/bake-navmesh.mjs --clean   # 先清空输出目录
 */

import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, readdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const REGIONS_PATH = resolve(ROOT, 'src/data/json/regions.json')
const OUTPUT_DIR = resolve(ROOT, 'src/data/json/navmesh')

const regions = JSON.parse(readFileSync(REGIONS_PATH, 'utf8'))

if (!existsSync(OUTPUT_DIR)) {
  mkdirSync(OUTPUT_DIR, { recursive: true })
}

const args = process.argv.slice(2)
if (args.includes('--clean') && existsSync(OUTPUT_DIR)) {
  rmSync(OUTPUT_DIR, { recursive: true })
  mkdirSync(OUTPUT_DIR, { recursive: true })
}

/**
 * 约束德劳内三角剖分（简化版 Bowyer-Watson + 约束边）。
 * 这里用简单的网格采样 + 障碍检测，因为区域墙是轴对齐矩形，
 * 完全可见性图本身也是基于墙角的，烘焙目的是把在线计算离线化。
 */
function bakeNavmesh(region) {
  const { id, bounds, groundY, walls = [], chunkSize = 48 } = region
  const wallBoxes = walls.map(w => ({
    minX: w.pos.x - w.size.x / 2,
    maxX: w.pos.x + w.size.x / 2,
    minZ: w.pos.z - w.size.z / 2,
    maxZ: w.pos.z + w.size.z / 2,
  }))

  // 采样网格：以 chunkSize 为步长，在 bounds 内生成顶点
  // 加上墙的外扩角作为强制顶点
  const vertices = []
  const vertexIndex = new Map() // key: "x,z" -> index

  function addVertex(x, z) {
    const key = `${x.toFixed(3)},${z.toFixed(3)}`
    if (!vertexIndex.has(key)) {
      vertexIndex.set(key, vertices.length)
      vertices.push({ x, y: groundY, z })
    }
    return vertexIndex.get(key)
  }

  // 1. 区域边界角点
  addVertex(bounds.minX, bounds.minZ)
  addVertex(bounds.maxX, bounds.minZ)
  addVertex(bounds.minX, bounds.maxZ)
  addVertex(bounds.maxX, bounds.maxZ)

  // 2. 墙的外扩角（半径 = 0，烘焙时不带半径，运行时加半径）
  for (const w of walls) {
    const hx = w.size.x / 2
    const hz = w.size.z / 2
    addVertex(w.pos.x - hx, w.pos.z - hz)
    addVertex(w.pos.x + hx, w.pos.z - hz)
    addVertex(w.pos.x - hx, w.pos.z + hz)
    addVertex(w.pos.x + hx, w.pos.z + hz)
  }

  // 3. 区域内规则网格采样（密度由 chunkSize 决定）
  const step = chunkSize / 2 // 半格采样，足够捕捉走廊
  for (let x = bounds.minX; x <= bounds.maxX; x += step) {
    for (let z = bounds.minZ; z <= bounds.maxZ; z += step) {
      addVertex(x, z)
    }
  }

  // 4. 简单三角化：对凸包做三角化（这里用耳切法，简化版）
  // 实际项目中可接 earclipping 或 triangle 库
  // 这里生成简单的网格三角形
  const triangles = []

  // 生成规则网格三角形（只在无障碍处）
  const grid = new Map() // (gx, gz) -> vertex index
  for (let i = 0; i < vertices.length; i++) {
    const v = vertices[i]
    const gx = Math.round(v.x / step)
    const gz = Math.round(v.z / step)
    grid.set(`${gx},${gz}`, i)
  }

  const gxMin = Math.floor(bounds.minX / step)
  const gxMax = Math.floor(bounds.maxX / step)
  const gzMin = Math.floor(bounds.minZ / step)
  const gzMax = Math.floor(bounds.maxZ / step)

  function pointInObstacle(x, z) {
    for (const b of wallBoxes) {
      if (x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ) return true
    }
    return false
  }

  for (let gx = gxMin; gx < gxMax; gx++) {
    for (let gz = gzMin; gz < gzMax; gz++) {
      const v00 = grid.get(`${gx},${gz}`)
      const v10 = grid.get(`${gx + 1},${gz}`)
      const v01 = grid.get(`${gx},${gz + 1}`)
      const v11 = grid.get(`${gx + 1},${gz + 1}`)

      if (v00 !== undefined && v10 !== undefined && v01 !== undefined && v11 !== undefined) {
        const cx = (gx + 0.5) * step
        const cz = (gz + 0.5) * step
        if (!pointInObstacle(cx, cz)) {
          triangles.push([v00, v10, v11])
          triangles.push([v11, v01, v00])
        }
      }
    }
  }

  // 5. 计算共享边（用于 A* 相邻搜索）
  const edgeMap = new Map() // "v1,v2" -> { tri1, tri2 }
  for (let ti = 0; ti < triangles.length; ti++) {
    const [a, b, c] = triangles[ti]
    for (const [u, v] of [[a, b], [b, c], [c, a]]) {
      const key = u < v ? `${u},${v}` : `${v},${u}`
      if (!edgeMap.has(key)) edgeMap.set(key, { tri1: ti, tri2: -1 })
      else edgeMap.get(key).tri2 = ti
    }
  }

  // 6. 计算三角形中心（用于 A* 代价）
  const centroids = triangles.map(([a, b, c]) => {
    const va = vertices[a], vb = vertices[b], vc = vertices[c]
    return { x: (va.x + vb.x + vc.x) / 3, z: (va.z + vb.z + vc.z) / 3 }
  })

  // 7. 过滤掉面积过小的三角形（数值噪声）
  const validTriangles = []
  const triRemap = new Map() // old -> new
  for (let ti = 0; ti < triangles.length; ti++) {
    const [a, b, c] = triangles[ti]
    const va = vertices[a], vb = vertices[b], vc = vertices[c]
    const area = Math.abs((vb.x - va.x) * (vc.z - va.z) - (vc.x - va.x) * (vb.z - va.z)) / 2
    if (area > 0.01) {
      triRemap.set(ti, validTriangles.length)
      validTriangles.push(triangles[ti])
    }
  }

  // 重新计算有效三角形的边邻接
  const validEdges = []
  const edgeToTri = new Map()
  for (let ti = 0; ti < validTriangles.length; ti++) {
    const [a, b, c] = validTriangles[ti]
    for (const [u, v] of [[a, b], [b, c], [c, a]]) {
      const key = u < v ? `${u},${v}` : `${v},${u}`
      if (!edgeToTri.has(key)) edgeToTri.set(key, [ti])
      else edgeToTri.get(key).push(ti)
    }
  }
  for (const [key, tris] of edgeToTri) {
    if (tris.length === 2) {
      validEdges.push({ v1: parseInt(key.split(',')[0]), v2: parseInt(key.split(',')[1]), tri1: tris[0], tri2: tris[1] })
    }
  }

  // 8. 三角形中心
  const validCentroids = validTriangles.map(([a, b, c]) => {
    const va = vertices[a], vb = vertices[b], vc = vertices[c]
    return { x: (va.x + vb.x + vc.x) / 3, z: (va.z + vb.z + vc.z) / 3 }
  })

  // 9. 写入文件
  const navmesh = {
    regionId: id,
    groundY,
    bounds,
    vertices,
    triangles: validTriangles,
    edges: validEdges,
    centroids: validCentroids,
    step,
    bakedAt: new Date().toISOString(),
  }

  const outPath = resolve(OUTPUT_DIR, `${id}.navmesh.json`)
  writeFileSync(outPath, JSON.stringify(navmesh, null, 2))
  console.log(`[bake] ${id}: ${vertices.length} vertices, ${validTriangles.length} triangles, ${validEdges.length} edges → ${outPath}`)
  return navmesh
}

// 执行烘焙
console.log('[bake] Starting navmesh bake...')
let count = 0
for (const region of regions) {
  if (region.navmeshRef) {
    bakeNavmesh(region)
    count++
  }
}
console.log(`[bake] Done. Baked ${count} region(s).`)