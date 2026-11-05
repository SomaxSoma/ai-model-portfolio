import { Canvas, useFrame } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { gradientAt, usePageVisible, usePrefersReducedMotion } from './motion';

const COLS = 96;
const ROWS = 34;
const SPACING = 0.24;

/** A soft round sprite so points render as dots, not squares. */
function dotTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.55, 'rgba(255,255,255,0.9)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 32, 32);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function Field({ animate }: { animate: boolean }) {
  const { geometry, base, sprite } = useMemo(() => {
    const count = COLS * ROWS;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const base = new Float32Array(count * 2);
    const c = new THREE.Color();
    for (let r = 0; r < ROWS; r++) {
      for (let q = 0; q < COLS; q++) {
        const i = r * COLS + q;
        const x = (q - (COLS - 1) / 2) * SPACING;
        const z = (r - (ROWS - 1) / 2) * SPACING;
        base[i * 2] = x;
        base[i * 2 + 1] = z;
        positions.set([x, 0, z], i * 3);
        // The only colours: a left-to-right violet → cyan gradient.
        c.set(gradientAt(q / (COLS - 1)));
        colors.set([c.r, c.g, c.b], i * 3);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    return { geometry, base, sprite: dotTexture() };
  }, []);

  useEffect(
    () => () => {
      geometry.dispose();
      sprite.dispose();
    },
    [geometry, sprite],
  );

  const shape = (t: number) => {
    const pos = geometry.attributes.position!.array as Float32Array;
    for (let i = 0; i < COLS * ROWS; i++) {
      const x = base[i * 2]!;
      const z = base[i * 2 + 1]!;
      pos[i * 3 + 1] = Math.sin(x * 0.42 + t * 0.6) * 0.38 + Math.cos(z * 0.55 + x * 0.12 + t * 0.45) * 0.26;
    }
    geometry.attributes.position!.needsUpdate = true;
  };

  useMemo(() => shape(0), []); // eslint-disable-line react-hooks/exhaustive-deps
  useFrame(({ clock }) => {
    if (animate) shape(clock.elapsedTime);
  });

  return (
    <points geometry={geometry} rotation={[0.08, 0, 0]}>
      <pointsMaterial map={sprite} vertexColors size={0.055} sizeAttenuation transparent opacity={0.85} depthWrite={false} alphaTest={0.02} />
    </points>
  );
}

/**
 * A quiet, structured backdrop: a grid of dots that undulates like a surface.
 * Decorative only (aria-hidden); still frame for reduced motion; paused when
 * the tab is hidden.
 */
export default function DotWave() {
  const reduced = usePrefersReducedMotion();
  const visible = usePageVisible();
  const animate = !reduced && visible;
  return (
    <Canvas aria-hidden="true" dpr={[1, 1.5]} camera={{ position: [0, 2.4, 6.2], fov: 50 }} frameloop={animate ? 'always' : 'demand'} gl={{ antialias: true, alpha: true, powerPreference: 'low-power' }} style={{ pointerEvents: 'none' }} onCreated={({ camera }) => camera.lookAt(0, -0.4, 0)}>
      <Field animate={animate} />
    </Canvas>
  );
}
