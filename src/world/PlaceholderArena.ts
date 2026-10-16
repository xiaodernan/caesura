import * as THREE from 'three'
import { bus } from '@/core/EventBus'
import { RhythmClock } from '@/core/RhythmClock'

export interface Arena {
  renderer: THREE.WebGLRenderer
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  playerVisual: THREE.Group
  update: (alpha: number, realDelta: number) => void
  resize: () => void
}

export function createArena(canvas: HTMLCanvasElement, clock: RhythmClock): Arena {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' })
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5))
  renderer.setSize(innerWidth, innerHeight)
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFShadowMap
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.05

  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0x07080c)
  // KI-094 遗留⑤（2026-10-01）：雾的**密度**不归场景构造管——这一个数以前写死成 0.028，
  // 而文档里没有任何一个数长这个样子。密度唯一的读者是 `vfx/ColorGrade`（`weather.json` 那一行的
  // `fogDensity`），`main.ts` 里它就在下面几行接过去，首帧渲染之前雾已经是表里的数。
  // 这里只建雾的**形状**（指数雾：art-direction §8 与 ColorGrade 的类型收窄都认它）与颜色，
  // 密度留默认的 0.00025 —— 一个几乎看不见的占位，而不是一个看起来像读数的数。
  scene.fog = new THREE.FogExp2(0x0b0e16)

  const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 400)
  camera.position.set(0, 2.2, 6)

  // §37 第二腿：三层光不再在这里写死。hemi/key 的色与强度、以及局部 point，全部由
  // `world/SceneLights.ts` 从 `lighting.json` 那一行搬上来（`main.ts` 建好它之后立刻apply一次）。
  // 这里曾经写死 0x35406b/0x1a1410/0.7 与 0xd8c37a/1.5——那是雾语林的配色，而玩家出生在休垒，
  // 于是七区里有六区从来看见的不是自己的光（KI-094 同族：写死的值只对得上一个地方）。
  // shadow map 的尺寸与视锥跟着 key 光一起搬走了：它现在是 key 的属性，而 key 只有一个主人。

  // 这张大地面是「未认领空间的底」，不是世界地板：世界地板是 ChunkGreybox 的调色板
  // chunk 板（groundY-0.48）。它曾经待在 y=0——把整个世界的调色板地板压在身下，玩家脚下
  // 永远是这张没吃过任何色板的深蓝黑（用户实测「场景太黑了，啥都看不清」的第一根源）。
  // 降到 chunk 板之下：露出来的全黑底只在深渊/未流送区可见——那正是深渊该有的样子。
  const groundMat = new THREE.MeshStandardMaterial({ color: 0x141821, roughness: 0.92, metalness: 0.1 })
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(240, 240), groundMat)
  ground.rotation.x = -Math.PI / 2
  ground.position.y = -0.6
  ground.receiveShadow = true
  scene.add(ground)

  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(220, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: { uTime: { value: 0 }, uIntensity: { value: 1 } },
      vertexShader: `varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `
        varying vec3 vP; uniform float uTime; uniform float uIntensity;
        float hash(float n){ return fract(sin(n)*43758.5453); }
        void main(){
          vec3 d = normalize(vP);
          float h = d.y * 0.5 + 0.5;
          vec3 base = mix(vec3(0.02,0.025,0.05), vec3(0.05,0.07,0.14), h);
          float band = smoothstep(0.32, 0.55, h) * (1.0 - smoothstep(0.55, 0.92, h));
          float wave = 0.0;
          for (int i = 0; i < 4; i++) {
            float fi = float(i);
            wave += sin(d.x * (4.0 + fi * 3.0) + uTime * (0.05 + fi * 0.017) + hash(fi) * 9.0)
                  * cos(d.z * (3.0 + fi * 2.0) - uTime * 0.03);
          }
          wave = wave * 0.125;
          float rip = 0.5 + 0.5 * sin(d.x * 26.0 + wave * 8.0 + uTime * 0.2);
          rip = pow(rip, 6.0);
          vec3 aurora = mix(vec3(0.16, 0.42, 0.36), vec3(0.65, 0.52, 0.22), 0.5 + 0.5 * sin(d.z * 2.0 + uTime * 0.05));
          vec3 col = base + band * aurora * (0.22 + 0.5 * rip) * uIntensity;
          gl_FragColor = vec4(col, 1.0);
        }`
    })
  )
  scene.add(sky)

  // Phase 1 练习场的 14 根环形占位柱已拆：现在休垒的陈设由 regions.json 的交互物与
  // chunk 世界承载，这些深灰柱只剩两个作用——把玩家出生的视野挡成一根黑柱、把「这是
  // 一个真正的游戏世界」盖回灰盒练习场。没有测试引用它们（grep 实测 0 命中）。
  const bell = new THREE.Mesh(
    new THREE.CylinderGeometry(1.6, 2.4, 5, 20, 1, true),
    new THREE.MeshStandardMaterial({ color: 0x4b3a26, roughness: 0.45, metalness: 0.85, side: THREE.DoubleSide })
  )
  bell.position.set(-9, 4.2, -14)
  bell.castShadow = true
  scene.add(bell)

  const playerVisual = new THREE.Group()
  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.32, 1.1, 6, 12),
    new THREE.MeshStandardMaterial({ color: 0x3c4250, roughness: 0.6 })
  )
  body.position.y = 1.0
  body.castShadow = true
  playerVisual.add(body)
  const core = new THREE.Mesh(
    new THREE.SphereGeometry(0.09, 10, 10),
    new THREE.MeshBasicMaterial({ color: 0xf0cf6a })
  )
  core.position.set(0, 1.25, -0.33)
  playerVisual.add(core)
  playerVisual.position.set(0, 0, 0)
  scene.add(playerVisual)

  bus.emit('log', { level: 'info', msg: 'arena placeholder built' })

  return {
    renderer, scene, camera, playerVisual,
    update(_alpha, realDelta) {
      (sky.material as THREE.ShaderMaterial).uniforms.uTime.value += realDelta
      const b = clock.info()
      const pulse = b.isBarStart ? 1 : Math.max(0, 1 - clock.info().phase * 4)
      ;(sky.material as THREE.ShaderMaterial).uniforms.uIntensity.value = 0.85 + pulse * 0.3
    },
    resize() {
      camera.aspect = innerWidth / innerHeight
      camera.updateProjectionMatrix()
      renderer.setSize(innerWidth, innerHeight)
    }
  }
}
