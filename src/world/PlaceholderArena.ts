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
  scene.fog = new THREE.FogExp2(0x0b0e16, 0.028)

  const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 400)
  camera.position.set(0, 2.2, 6)

  const hemi = new THREE.HemisphereLight(0x35406b, 0x1a1410, 0.7)
  scene.add(hemi)
  const key = new THREE.DirectionalLight(0xd8c37a, 1.5)
  key.position.set(12, 20, 8)
  key.castShadow = true
  key.shadow.mapSize.set(2048, 2048)
  key.shadow.camera.left = -40; key.shadow.camera.right = 40
  key.shadow.camera.top = 40; key.shadow.camera.bottom = -40
  scene.add(key)

  const groundMat = new THREE.MeshStandardMaterial({ color: 0x141821, roughness: 0.92, metalness: 0.1 })
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(240, 240), groundMat)
  ground.rotation.x = -Math.PI / 2
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

  const stone = new THREE.MeshStandardMaterial({ color: 0x1e2430, roughness: 0.8, metalness: 0.2 })
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2
    const r = 16 + (i % 3) * 9
    const h = 3 + (i % 5) * 2.6
    const m = new THREE.Mesh(new THREE.BoxGeometry(1.4 + (i % 4) * 0.5, h, 1.4), stone)
    m.position.set(Math.cos(a) * r, h / 2, Math.sin(a) * r)
    m.rotation.y = a + i
    m.castShadow = m.receiveShadow = true
    scene.add(m)
  }
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
