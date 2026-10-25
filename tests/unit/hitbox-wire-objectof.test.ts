/**
 * HitboxWire.objectOf 守卫（src/world/HitboxWire.ts，KI-315 新模块）。
 *
 * 覆盖实测（v8，hitbox-wire.test.ts）报 HitboxWire.ts 语句 100%，唯一未取分支在 `objectOf`
 * （源码 221）：`return this.entries.get(key)?.obj ?? null` 的 **查无此 key ⇒ null** 那一腿。
 * `hitbox-wire.test.ts` 通篇没调过 objectOf（grep 确认）⇒ 这是加法守卫，不是重复验证。
 *
 * objectOf 是调试面板「按 key 取这一格的线段对象」的访问器：在场的 key 交回那份 LineSegments，
 * 查无此 key 必须交回 **null**（不是 undefined、不抛）——上层据此判断"这一格此刻有没有在画"。
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { HitboxWire, type WireInput } from '@/world/HitboxWire'

/* HitboxWire 用**裸全局** addEventListener（node 里不存在 ⇒ 构造即 ReferenceError），先替身。
   与 hitbox-wire.test.ts 同一套手法；afterAll 还原，afterEach  dispose，绝不污染别的文件。 */
const hooked: Array<{ type: string; cb: (e: unknown) => void }> = []
const glob = globalThis as unknown as Record<string, unknown>
const realAdd = glob.addEventListener
const realRemove = glob.removeEventListener
beforeAll(() => {
  glob.addEventListener = (type: string, cb: (e: unknown) => void): void => { hooked.push({ type, cb }) }
  glob.removeEventListener = (type: string, cb: (e: unknown) => void): void => {
    const i = hooked.findIndex((l) => l.type === type && l.cb === cb)
    if (i >= 0) hooked.splice(i, 1)
  }
})
afterAll(() => {
  if (realAdd === undefined) delete glob.addEventListener
  else glob.addEventListener = realAdd
  if (realRemove === undefined) delete glob.removeEventListener
  else glob.removeEventListener = realRemove
})

const alive: Array<() => void> = []
afterEach(() => { while (alive.length) alive.pop()!() })

function press(key: string): void {
  const ev = { key, preventDefault(): void {} }
  for (const l of [...hooked]) if (l.type === 'keydown') l.cb(ev)
}

const CONE: WireInput['box'] = { shape: 'cone', angleDeg: 100, radius: 2.1, height: 1.6, offsetY: 0.9 }
const input = (key: string, box: WireInput['box']): WireInput =>
  ({ key, hostile: false, box, origin: { x: 0, y: 0, z: 0 }, yaw: 0 })

describe('HitboxWire.objectOf：按 key 取线段对象', () => {
  it('在场的 key 交回那份 LineSegments；查无此 key 交回 null（不抛、不是 undefined）', () => {
    const scene = new THREE.Scene()
    const wire = new HitboxWire({ scene, key: 'F6', feed: () => [input('a', CONE)] })
    alive.push(() => wire.dispose())
    press('F6') // 打开调试叠加
    wire.sync() // 灌进 entries：key 'a'
    expect(wire.live).toBe(1)
    expect(wire.objectOf('a'), '在场的 key 交回那份几何').toBeInstanceOf(THREE.LineSegments)
    expect(wire.objectOf('missing'), '查无此 key ⇒ null').toBeNull()
  })
})
