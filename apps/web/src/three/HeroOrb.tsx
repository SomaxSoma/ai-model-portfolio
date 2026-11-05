import { Float, MeshDistortMaterial, Sparkles } from '@react-three/drei';
import { Canvas, useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import type * as THREE from 'three';
import { token, usePageVisible, usePrefersReducedMotion } from './motion';

function Orb({ animate }: { animate: boolean }) {
  const rings = useRef<THREE.Group>(null);
  const colors = useMemo(() => ({ violet: token('--violet', '#8b7cf6'), cyan: token('--cyan', '#38d6f5'), green: token('--positive', '#34d399') }), []);
  useFrame((_, delta) => {
    if (!animate || !rings.current) return;
    rings.current.rotation.z += delta * 0.15;
    rings.current.rotation.x += delta * 0.05;
  });
  return (
    <>
      <ambientLight intensity={0.35} />
      <pointLight position={[4, 4, 4]} intensity={60} color={colors.violet} />
      <pointLight position={[-4, -2, 3]} intensity={45} color={colors.cyan} />
      <Float speed={animate ? 1.4 : 0} rotationIntensity={0.5} floatIntensity={0.8}>
        <mesh>
          <icosahedronGeometry args={[1.45, 48]} />
          <MeshDistortMaterial color={colors.violet} emissive={colors.violet} emissiveIntensity={0.25} roughness={0.15} metalness={0.7} distort={0.32} speed={animate ? 1.5 : 0} />
        </mesh>
        <mesh scale={1.02}>
          <icosahedronGeometry args={[1.5, 2]} />
          <meshBasicMaterial color={colors.cyan} wireframe transparent opacity={0.12} />
        </mesh>
      </Float>
      <group ref={rings} rotation={[1.1, 0.2, 0]}>
        {[2.2, 2.6, 3.05].map((r, i) => (
          <mesh key={r} rotation={[0, 0, i * 0.7]}>
            <torusGeometry args={[r, 0.008 + i * 0.003, 12, 220, Math.PI * (1.2 + i * 0.35)]} />
            <meshBasicMaterial color={i === 1 ? colors.cyan : i === 2 ? colors.green : colors.violet} transparent opacity={0.65} />
          </mesh>
        ))}
      </group>
      <Sparkles count={70} scale={7} size={2.2} speed={animate ? 0.35 : 0} color={colors.cyan} opacity={0.7} />
    </>
  );
}

/** Login hero: a distorted, glowing core orbited by allocation-like rings. */
export default function HeroOrb() {
  const reduced = usePrefersReducedMotion();
  const visible = usePageVisible();
  const animate = !reduced && visible;
  return (
    <Canvas aria-hidden="true" dpr={[1, 1.75]} camera={{ position: [0, 0, 7], fov: 45 }} frameloop={animate ? 'always' : 'demand'} gl={{ antialias: true, alpha: true }}>
      <Orb animate={animate} />
    </Canvas>
  );
}
