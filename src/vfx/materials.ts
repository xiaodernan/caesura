import * as THREE from 'three'

/**
 * VFX 着色器材质（Phase 1 战斗原型）
 *
 * 全部遵循 docs/art-direction.md §1「凝固的声波」母题与 §7.1 敌我色相分离：
 * - 声纹环：双环（主波 + 回声波）+ 沿角度的干涉条纹（§1.2 模板，阈值 0.42/0.58）
 *   + 半径按伪波形起伏（声波轮廓），波纹来源永远是实例自身的声源锚点 aOrigin（§1.1）
 * - 加色混合、depthWrite=false；输出 linear 工作色空间（three 的 drawingBuffer 已启用 sRGB
 *   硬件编码），但不套 ACES tonemap，让加色发光按调色板 hex 原样读出——因此亮度参数
 *   已按「不衰减」前提压到 ≤1.35，避免 §7.2 的自发光面积比超标。
 */

/** 唯一合法取色（art-direction §2 区域色板 + §7.1 特效色相表） */
export const VFX_PALETTE = {
  /** 暖金：休垒炉火橙 × 钟坠院钟金 —— 玩家命中的声纹主色 */
  warmGold: 0xc9b458,
  /** 弹反白：全游戏唯一「金白爆点」，专属玩家正反馈 */
  parryWhite: 0xf5f3e6,
  /** 喧堕紫：失谐/敌意，仅敌方与死亡 */
  discordViolet: 0x9a4fd0,
  /** 琥珀余烬：火星、尘、格挡单向火舌（休垒 EMIT 变体） */
  ember: 0xffb86b,
  /** 冷银白：玩家攻击轨迹（§7.1 与敌意暖红保持 ≥90° 色相距离） */
  silver: 0xdde6ea,
} as const

/**
 * 声纹环几何：单位环（半径 1 处为环心线，半带宽 1 ⇒ RingGeometry(0.5,1.5)）。
 * shader 内用 length(position.xy) 重建径向坐标，故 uv 直接删掉省顶点内存。
 */
export function makeRingGeometry(): THREE.BufferGeometry {
  const geo = new THREE.RingGeometry(0.5, 1.5, 64, 8)
  geo.deleteAttribute('uv')
  return geo
}

const GLSL_QUAT = /* glsl */ `
vec3 qrotate(vec4 q, vec3 v) {
  return v + 2.0 * cross(q.xyz, cross(q.xyz, v) + q.w * v);
}
`

const GLSL_AXIS_ROT = /* glsl */ `
vec3 rotAxis(vec3 v, vec3 axis, float a) {
  float c = cos(a);
  float s = sin(a);
  return v * c + cross(axis, v) * s + axis * dot(axis, v) * (1.0 - c);
}
`

/**
 * 冲击环材质（声纹母题核心特效，共享给空中环与地面涟漪贴花）。
 * uBandHalf 为几何的半带宽（RingGeometry(0.5,1.5) => 1.0）。
 */
export function createRingMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uBandHalf: { value: 1 },
    },
    vertexShader: /* glsl */ `
      attribute vec3 aOrigin;
      attribute vec4 aQuat;
      attribute vec3 aColor;
      attribute float aBirth;
      attribute float aDur;
      attribute float aR0;
      attribute float aR1;
      attribute float aWidth;
      attribute vec4 aParam;   // x=双环分离 y=干涉强度 z=声波抖动 w=亮度

      uniform float uTime;
      uniform float uBandHalf;

      varying float vQ;
      varying float vAngle;
      varying float vProg;
      varying vec3 vColor;
      varying vec4 vParam;

      ${GLSL_QUAT}

      void main() {
        float age = uTime - aBirth;
        float alive = step(0.0, age) * step(age, aDur);
        float t = clamp(age / max(aDur, 1e-4), 0.0, 1.0);
        float ease = 1.0 - pow(1.0 - t, 2.2);

        float baseR = length(position.xy);
        vec2 dir2 = position.xy / max(baseR, 1e-5);
        float q = (baseR - 1.0) / max(uBandHalf, 1e-4);
        float ang = atan(dir2.y, dir2.x);

        // 声波轮廓：三段正弦叠加的伪波形，随扩散逐渐抹平
        float w = sin(ang * 3.0 + aParam.z * 11.0) * 0.5
                + sin(ang * 7.0 - aParam.z * 5.0) * 0.3
                + sin(ang * 13.0 + aParam.z * 2.0) * 0.2;
        float radius = mix(aR0, aR1, ease) + w * aParam.z * 0.18 * (1.0 - t) * aR1;

        vec3 local = vec3(dir2 * (radius + q * aWidth), 0.0) * alive;

        vQ = q;
        vAngle = ang;
        vProg = t;
        vColor = aColor;
        vParam = aParam;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(qrotate(aQuat, local) + aOrigin * alive, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      varying float vQ;
      varying float vAngle;
      varying float vProg;
      varying vec3 vColor;
      varying vec4 vParam;

      float lobe(float x, float c, float w) {
        float d = (x - c) / w;
        return exp(-d * d);
      }

      void main() {
        float single = lobe(vQ, 0.0, 0.34);
        // 双环：主波 + 回声波（同一条带内两道同心细环）
        float pair = lobe(vQ, -0.48, 0.2) + lobe(vQ, 0.48, 0.2);
        float prof = mix(single, pair, vParam.x);
        prof *= 1.0 - 0.45 * vProg;                       // 越扩越薄

        // 双源干涉条纹（art-direction §1.2 模板：wave() 相乘 + 0.42/0.58 阈值）
        float w1 = 0.5 + 0.5 * cos(vAngle * 24.0 + vProg * 22.0);
        float w2 = 0.5 + 0.5 * cos(vAngle * 37.0 - vProg * 13.0);
        float fringe = smoothstep(0.42, 0.58, w1 * w2);

        float fade = pow(1.0 - vProg, 1.7);
        float a = prof * fade * vParam.w;
        if (a < 0.004) discard;

        vec3 col = vColor * (0.62 + 0.85 * fringe * vParam.y);
        gl_FragColor = vec4(col, a);
      }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: true,
    side: THREE.DoubleSide,
  })
}

/**
 * 粒子材质：广告牌火星 / 沿方向拉长的短促光带（武器拖尾、格挡火舌）。
 * 运动在 vertex 内解析求得（aOrigin + aVel*t - 0.5*g*t²），CPU 只在出生/回收时写缓冲。
 */
export function createSparkMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    vertexShader: /* glsl */ `
      attribute vec3 aOrigin;
      attribute vec3 aVel;
      attribute vec3 aColor;
      attribute vec3 aDir;     // aKind=1 时光带的朝向
      attribute float aBirth;
      attribute float aDur;
      attribute float aKind;   // 0=广告牌火星 1=方向光带
      attribute vec2 aSize;    // x=长 y=宽
      attribute vec4 aParam;   // x=gravity y=drag z=亮度 w=光带拉伸

      uniform float uTime;

      varying vec2 vUv;
      varying vec3 vColor;
      varying float vAlpha;

      void main() {
        float age = uTime - aBirth;
        float alive = step(0.0, age) * step(age, aDur);
        float t = clamp(age / max(aDur, 1e-4), 0.0, 1.0);

        float damp = max(1.0 - aParam.y * age, 0.0);
        vec3 wp = aOrigin + aVel * age * damp;
        wp.y -= 0.5 * aParam.x * age * age;

        vec4 mv = modelViewMatrix * vec4(wp, 1.0);

        vec2 longAxis = vec2(1.0, 0.0);
        if (aKind > 0.5) {
          vec3 vd = (modelViewMatrix * vec4(aDir, 0.0)).xyz;
          vec2 s = vec2(vd.x, vd.y);
          longAxis = dot(s, s) > 1e-8 ? normalize(s) : vec2(1.0, 0.0);
        }
        vec2 shortAxis = vec2(-longAxis.y, longAxis.x);

        float len = aSize.x * mix(1.0, max(aParam.w, 1.0), aKind) * (0.55 + 0.45 * (1.0 - t));
        float wid = aSize.y * (1.0 - 0.6 * t);
        mv.xy += (longAxis * (position.x * len) + shortAxis * (position.y * wid)) * alive;

        vUv = uv;
        vColor = aColor;
        vAlpha = alive * (1.0 - t) * (1.0 - t) * aParam.z * (1.0 + 1.6 * exp(-t * 9.0));
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vColor;
      varying float vAlpha;

      void main() {
        vec2 d = vUv * 2.0 - 1.0;
        float glow = exp(-(d.x * d.x * 1.1 + d.y * d.y * 3.2));
        float a = glow * vAlpha;
        if (a < 0.004) discard;
        gl_FragColor = vec4(vColor, a);
      }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: true,
    side: THREE.DoubleSide,
  })
}

/** 发光四面体碎片（振核碎裂抛出）：沿自身轴旋转 + 抛物线飞行 */
export function createShardMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    vertexShader: /* glsl */ `
      attribute vec3 aOrigin;
      attribute vec3 aVel;
      attribute vec3 aColor;
      attribute vec4 aQuat;
      attribute vec3 aAxis;
      attribute float aBirth;
      attribute float aDur;
      attribute float aSpin;
      attribute float aSize;
      attribute vec2 aParam;   // x=gravity y=亮度

      uniform float uTime;

      varying vec3 vColor;
      varying float vFace;
      varying float vAlpha;

      ${GLSL_QUAT}
      ${GLSL_AXIS_ROT}

      void main() {
        float age = uTime - aBirth;
        float alive = step(0.0, age) * step(age, aDur);
        float t = clamp(age / max(aDur, 1e-4), 0.0, 1.0);

        vec3 ax = aAxis;
        float al = length(ax);
        ax = al > 1e-5 ? ax / al : vec3(0.0, 1.0, 0.0);

        float spin = aSpin * age + aOrigin.x * 3.1 + aOrigin.z * 1.7;
        vec3 local = qrotate(aQuat, rotAxis(position * aSize * (1.0 - 0.5 * t), ax, spin)) * alive;

        vec3 n = qrotate(aQuat, rotAxis(normal, ax, spin));
        vFace = 0.3 + 0.7 * abs(normalize(n).z);

        vec3 wp = aOrigin + aVel * age;
        wp.y -= 0.5 * aParam.x * age * age;

        vColor = aColor;
        vAlpha = alive * aParam.y * (1.0 - t) * (0.55 + 0.9 * exp(-t * 6.0));
        gl_Position = projectionMatrix * modelViewMatrix * vec4(local + wp * alive, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vColor;
      varying float vFace;
      varying float vAlpha;

      void main() {
        float a = vAlpha * (0.35 + 0.65 * vFace);
        if (a < 0.004) discard;
        gl_FragColor = vec4(vColor * (0.7 + 0.9 * vFace), a);
      }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: true,
    side: THREE.DoubleSide,
  })
}
