import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { token, usePageVisible, usePrefersReducedMotion } from './motion';

const COUNT = 130;
const LINK_DISTANCE = 1.9;
const MAX_LINKS = 900;

/** A soft round sprite for points (PointsMaterial draws squares by default). */
function dotTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.6)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function Network({ animate }: { animate: boolean }) {
  const group = useRef<THREE.Group>(null);
  const { viewport, invalidate } = useThree();
  const w = Math.max(viewport.width, 12) * 0.6;
  const h = Math.max(viewport.height, 8) * 0.6;

  const scene = useMemo(() => {
    const positions = new Float32Array(COUNT * 3);
    const velocities = new Float32Array(COUNT * 3);
    for (let i = 0; i < COUNT; i++) {
      positions[i * 3] = (Math.random() * 2 - 1) * w;
      positions[i * 3 + 1] = (Math.random() * 2 - 1) * h;
      positions[i * 3 + 2] = (Math.random() * 2 - 1) * 2.5;
      velocities[i * 3] = (Math.random() - 0.5) * 0.12;
      velocities[i * 3 + 1] = (Math.random() - 0.5) * 0.12;
      velocities[i * 3 + 2] = (Math.random() - 0.5) * 0.04;
    }
    const pointGeo = new THREE.BufferGeometry();
    pointGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX_LINKS * 6), 3));
    lineGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(MAX_LINKS * 6), 3));
    return {
      positions,
      velocities,
      pointGeo,
      lineGeo,
      cyan: new THREE.Color(token('--cyan', '#38d6f5')),
      violet: new THREE.Color(token('--violet', '#8b7cf6')),
      sprite: dotTexture(),
    };
    // Built once; the field keeps its shape on resize.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const link = () => {
    const { positions, lineGeo, cyan, violet } = scene;
    const lp = lineGeo.attributes.position!.array as Float32Array;
    const lc = lineGeo.attributes.color!.array as Float32Array;
    const mix = new THREE.Color();
    let n = 0;
    for (let i = 0; i < COUNT && n < MAX_LINKS; i++) {
      for (let j = i + 1; j < COUNT && n < MAX_LINKS; j++) {
        const dx = positions[i * 3]! - positions[j * 3]!;
        const dy = positions[i * 3 + 1]! - positions[j * 3 + 1]!;
        const dz = positions[i * 3 + 2]! - positions[j * 3 + 2]!;
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (d > LINK_DISTANCE) continue;
        // Additive blending: darker vertex colour = fainter line, so links fade with distance.
        const fade = (1 - d / LINK_DISTANCE) * 0.55;
        mix.copy(violet).lerp(cyan, Math.min(1, Math.max(0, (positions[i * 3]! / w + 1) / 2))).multiplyScalar(fade);
        lp.set([positions[i * 3]!, positions[i * 3 + 1]!, positions[i * 3 + 2]!, positions[j * 3]!, positions[j * 3 + 1]!, positions[j * 3 + 2]!], n * 6);
        lc.set([mix.r, mix.g, mix.b, mix.r, mix.g, mix.b], n * 6);
        n++;
      }
    }
    lineGeo.setDrawRange(0, n * 2);
    lineGeo.attributes.position!.needsUpdate = true;
    lineGeo.attributes.color!.needsUpdate = true;
  };

  useEffect(() => {
    link();
    invalidate();
    return () => {
      scene.pointGeo.dispose();
      scene.lineGeo.dispose();
      scene.sprite.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useFrame((state, delta) => {
    if (!animate) return;
    const { positions, velocities, pointGeo } = scene;
    const dt = Math.min(delta, 0.05);
    for (let i = 0; i < COUNT; i++) {
      for (let k = 0; k < 3; k++) {
        const idx = i * 3 + k;
        const bound = k === 0 ? w : k === 1 ? h : 2.5;
        let p = positions[idx]! + velocities[idx]! * dt * 3;
        if (p > bound) p = -bound;
        if (p < -bound) p = bound;
        positions[idx] = p;
      }
    }
    pointGeo.attributes.position!.needsUpdate = true;
    link();
    if (group.current) {
      // Gentle parallax toward the pointer.
      group.current.rotation.y += (state.pointer.x * 0.12 - group.current.rotation.y) * 0.03;
      group.current.rotation.x += (-state.pointer.y * 0.08 - group.current.rotation.x) * 0.03;
    }
  });

  return (
    <group ref={group}>
      <points geometry={scene.pointGeo}>
        <pointsMaterial map={scene.sprite} color={scene.cyan} size={0.09} sizeAttenuation transparent opacity={0.85} depthWrite={false} blending={THREE.AdditiveBlending} />
      </points>
      <lineSegments geometry={scene.lineGeo}>
        <lineBasicMaterial vertexColors transparent opacity={0.9} depthWrite={false} blending={THREE.AdditiveBlending} />
      </lineSegments>
    </group>
  );
}

/** Full-viewport drifting network behind the app. Decorative only. */
export default function Constellation() {
  const reduced = usePrefersReducedMotion();
  const visible = usePageVisible();
  const animate = !reduced && visible;
  return (
    <Canvas
      aria-hidden="true"
      dpr={[1, 1.5]}
      camera={{ position: [0, 0, 9], fov: 55 }}
      frameloop={animate ? 'always' : 'demand'}
      gl={{ antialias: true, alpha: true, powerPreference: 'low-power' }}
      style={{ pointerEvents: 'none' }}
    >
      <Network animate={animate} />
    </Canvas>
  );
}
