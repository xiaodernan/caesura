import * as THREE from 'three'
import type { VfxDecalRow, VfxEmitterRow, VfxTrailRow } from '@/data/schema'
import type { DecalConfig } from './Decals'
import type { TrailConfig } from './Trails'
import type { EmitterConfig } from './GPUParticles'

/**
 * 表现层三件套的**配置转换层**（Phase B4，KI-135）。
 *
 * **为什么有这一层**：数据表是纯 JSON（hex 字符串、`{x,y,z}`、混合模式的名字），
 * 而三个表现层模块内部用的是 three 的类型（`THREE.Color`／`THREE.Vector3`／`THREE.Blending`）。
 * 转换必须**发生在表现层**——数据层不认识 three（依赖方向单向），战斗层与 AI 层更不该认识。
 * 所以：表在 `src/data/json/vfx.json`（形状在 `src/data/schema.ts`），转换在这里，
 * 三个模块各自 `loadConfigs()` 时调它。**转换点只有一个**（谁在表现层，谁转）。
 *
 * **值域判据在 `scripts/vfx-rules.mjs`**，不在这里：那一层要能被合成夹具喂（校验器与测试读同一份），
 * 而这里的转换假定输入已经合法——它不是判据，是翻译。
 */


/** 名字 → `THREE.Blending`。认不出的名字回落 `normal`（不抛：一张表的坏值由判据红，不该把画面带崩） */
export function blendingOf(name: string): THREE.Blending {
  switch (name) {
    case 'additive':
      return THREE.AdditiveBlending
    case 'multiply':
      return THREE.MultiplyBlending
    default:
      return THREE.NormalBlending
  }
}

/** `#rgb` / `#rrggbb` → `THREE.Color`（认不出的串回落黑——判据那边会红，这里不许抛） */
export function colorOf(hex: string): THREE.Color {
  return new THREE.Color(hex)
}

/** 一行贴花配置 → 表现层用的那份 */
export function toDecalConfig(row: VfxDecalRow): DecalConfig {
  return {
    id: row.id,
    type: row.type,
    lifetime: row.lifetime,
    fadeIn: row.fadeIn,
    fadeOut: row.fadeOut,
    size: { min: row.size.min, max: row.size.max },
    color: { base: colorOf(row.color.base), opacity: row.color.opacity },
    normalStrength: row.normalStrength,
    roughnessOffset: row.roughnessOffset,
    metalnessOffset: row.metalnessOffset,
    randomRotation: row.randomRotation,
    randomScale: row.randomScale,
    maxInstances: row.maxInstances,
    ...(row.textures ? { textures: { ...row.textures } } : {}),
  }
}

/** 一行拖尾配置 → 表现层用的那份 */
export function toTrailConfig(row: VfxTrailRow): TrailConfig {
  return {
    id: row.id,
    segments: row.segments,
    width: [row.width[0], row.width[1]],
    color: [colorOf(row.color[0]), colorOf(row.color[1])],
    lifetime: row.lifetime,
    ...(row.texture ? { texture: row.texture } : {}),
    blending: blendingOf(row.blending),
    followRotation: row.followRotation,
    minEmitDist: row.minEmitDist,
  }
}

/** 一行发射器配置 → 表现层用的那份 */
export function toEmitterConfig(row: VfxEmitterRow): EmitterConfig {
  return {
    id: row.id,
    type: row.type,
    maxParticles: row.maxParticles,
    spawnRate: row.spawnRate,
    spawnShape: row.spawnShape,
    spawnSize: new THREE.Vector3(row.spawnSize.x, row.spawnSize.y, row.spawnSize.z),
    lifetime: { min: row.lifetime.min, max: row.lifetime.max },
    size: { start: row.size.start, end: row.size.end },
    color: { start: colorOf(row.color.start), end: colorOf(row.color.end) },
    velocity: {
      min: new THREE.Vector3(row.velocity.min.x, row.velocity.min.y, row.velocity.min.z),
      max: new THREE.Vector3(row.velocity.max.x, row.velocity.max.y, row.velocity.max.z),
    },
    acceleration: new THREE.Vector3(row.acceleration.x, row.acceleration.y, row.acceleration.z),
    gravity: row.gravity,
    drag: row.drag,
    blending: blendingOf(row.blending),
    depthWrite: row.depthWrite,
    sizeAttenuation: row.sizeAttenuation,
    ...(row.trailLength !== undefined ? { trailLength: row.trailLength } : {}),
    ...(row.ribbonWidth !== undefined ? { ribbonWidth: row.ribbonWidth } : {}),
  }
}
