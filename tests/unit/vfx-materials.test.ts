import { describe, expect, it } from "vitest"
import * as THREE from "three"
import {
  VFX_PALETTE,
  createRingMaterial,
  createShardMaterial,
  createSparkMaterial,
  makeRingGeometry,
} from "../../src/vfx/materials"

/** 文件头承诺：全部特效材质共享「加色混合 + 不写深度 + 双面」的发光前提 */
function expectAdditiveGlow(m: THREE.ShaderMaterial): void {
  expect(m.transparent).toBe(true)
  expect(m.blending).toBe(THREE.AdditiveBlending)
  expect(m.depthWrite).toBe(false)
  expect(m.depthTest).toBe(true)
  expect(m.side).toBe(THREE.DoubleSide)
}

describe("VFX 调色板（这五颗 hex 与三个工厂的自身形状；对 art-direction §2/§7.1 那两句「唯一合法」的对账在 tests/unit/vfx-hue-table.test.ts）", () => {
  it("五色 hex 与色板定义逐一对齐", () => {
    expect(VFX_PALETTE.warmGold).toBe(0xc9b458)
    expect(VFX_PALETTE.parryWhite).toBe(0xf5f3e6)
    expect(VFX_PALETTE.discordViolet).toBe(0x9a4fd0)
    expect(VFX_PALETTE.ember).toBe(0xffb86b)
    expect(VFX_PALETTE.silver).toBe(0xdde6ea)
    expect(Object.keys(VFX_PALETTE)).toHaveLength(5)
  })
})

describe("makeRingGeometry：单位环（环心线半径 1，半带宽 1）", () => {
  it("是 BufferGeometry 且按承诺删除 uv 属性", () => {
    const geo = makeRingGeometry()
    expect(geo).toBeInstanceOf(THREE.BufferGeometry)
    expect(geo.getAttribute("uv")).toBeUndefined()
    expect(geo.getAttribute("position")).toBeDefined()
  })

  it("顶点半径带覆盖 [0.5, 1.5]，且存在半径恰为 1 的环心线", () => {
    const geo = makeRingGeometry()
    const pos = geo.getAttribute("position")
    let min = Number.POSITIVE_INFINITY
    let max = 0
    let hasUnit = false
    for (let i = 0; i < pos.count; i++) {
      const r = Math.hypot(pos.getX(i), pos.getY(i))
      min = Math.min(min, r)
      max = Math.max(max, r)
      if (Math.abs(r - 1) < 1e-6) hasUnit = true
    }
    expect(min).toBeCloseTo(0.5, 6)
    expect(max).toBeCloseTo(1.5, 6)
    expect(hasUnit).toBe(true)
  })
})

describe("createRingMaterial：声纹环（双环 + 干涉条纹 + 伪波形）", () => {
  it("加色混合 / 不写深度 / 双面（文件头共享承诺）", () => {
    expectAdditiveGlow(createRingMaterial())
  })

  it("uniforms：uTime 从 0 起步，uBandHalf 与几何半带宽一致为 1", () => {
    const m = createRingMaterial()
    expect(m.uniforms.uTime.value).toBe(0)
    expect(m.uniforms.uBandHalf.value).toBe(1)
  })

  it("顶点属性清单齐备，aOrigin 声源锚点直接进 gl_Position", () => {
    const vs = createRingMaterial().vertexShader
    expect(vs).toContain("attribute vec3 aOrigin")
    expect(vs).toContain("attribute vec4 aQuat")
    expect(vs).toContain("attribute vec3 aColor")
    expect(vs).toContain("attribute float aBirth")
    expect(vs).toContain("attribute float aDur")
    expect(vs).toContain("attribute float aR0")
    expect(vs).toContain("attribute float aR1")
    expect(vs).toContain("attribute float aWidth")
    expect(vs).toContain("attribute vec4 aParam")
    expect(vs).toContain("aOrigin * alive")
  })

  it("声波轮廓：三段正弦叠加的伪波形（0.5/0.3/0.2）随扩散抹平", () => {
    const vs = createRingMaterial().vertexShader
    expect(vs).toContain("sin(ang * 3.0")
    expect(vs).toContain("sin(ang * 7.0")
    expect(vs).toContain("sin(ang * 13.0")
    expect(vs).toContain(") * 0.5")
    expect(vs).toContain(") * 0.3")
    expect(vs).toContain(") * 0.2")
    expect(vs).toContain("1.0 - t")
  })

  it("片元：单环/双环 lobe 与 art-direction §1.2 的 0.42/0.58 干涉阈值", () => {
    const fs = createRingMaterial().fragmentShader
    expect(fs).toContain("lobe(vQ, 0.0, 0.34)")
    expect(fs).toContain("lobe(vQ, -0.48, 0.2)")
    expect(fs).toContain("lobe(vQ, 0.48, 0.2)")
    expect(fs).toContain("smoothstep(0.42, 0.58")
  })

  it("输出 linear 工作色空间：不套 ACES tonemap", () => {
    const fs = createRingMaterial().fragmentShader
    expect(fs).not.toMatch(/tonemapping|ACES/i)
  })
})

describe("createSparkMaterial：粒子（火星 / 方向光带）", () => {
  it("加色混合 / 不写深度 / 双面（文件头共享承诺）", () => {
    expectAdditiveGlow(createSparkMaterial())
  })

  it("uniforms 只有 uTime（运动全在顶点内解析求得）", () => {
    const m = createSparkMaterial()
    expect(m.uniforms.uTime.value).toBe(0)
    expect(m.uniforms.uBandHalf).toBeUndefined()
    expect(Object.keys(m.uniforms)).toEqual(["uTime"])
  })

  it("CPU 只写出生/回收：重力在顶点内解析积分（-0.5·g·t²）", () => {
    const vs = createSparkMaterial().vertexShader
    expect(vs).toContain("wp.y -= 0.5 * aParam.x * age * age")
  })

  it("双态粒子：aKind 区分广告牌火星与方向光带", () => {
    const vs = createSparkMaterial().vertexShader
    expect(vs).toContain("attribute float aKind")
    expect(vs).toContain("aKind > 0.5")
    expect(vs).toContain("attribute vec3 aDir")
  })
})

describe("createShardMaterial：振核碎裂发光四面体", () => {
  it("加色混合 / 不写深度 / 双面（文件头共享承诺）", () => {
    expectAdditiveGlow(createShardMaterial())
  })

  it("uniforms 只有 uTime", () => {
    const m = createShardMaterial()
    expect(m.uniforms.uTime.value).toBe(0)
    expect(Object.keys(m.uniforms)).toEqual(["uTime"])
  })

  it("抛物线飞行 + 沿自身轴旋转（aSpin·t）", () => {
    const vs = createShardMaterial().vertexShader
    expect(vs).toContain("wp.y -= 0.5 * aParam.x * age * age")
    expect(vs).toContain("aSpin * age")
    expect(vs).toContain("attribute vec4 aQuat")
    expect(vs).toContain("attribute vec3 aAxis")
  })

  it("面朝亮度 vFace 参与片元着色", () => {
    const m = createShardMaterial()
    expect(m.vertexShader).toContain("vFace = 0.3 + 0.7 * abs(")
    expect(m.fragmentShader).toContain("vFace")
  })
})