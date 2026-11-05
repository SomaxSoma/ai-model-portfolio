import { Float } from '@react-three/drei';
import { Canvas, useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import type * as THREE from 'three';
import { token, usePageVisible, usePrefersReducedMotion } from './motion';

export interface OrbRing {
  key: string | number;
  share: number;
  color: string;
}

function Ring({ ring, index, animate }: { ring: OrbRing; index: number; animate: boolean }) {
  const ref = useRef<THREE.Mesh>(null);
  const radius = 1.05 + index * 0.36;
  const arc = Math.max(0.04, ring.share / 100) * Math.PI * 2;
  const tube = 0.035 + (ring.share / 100) * 0.11;
  useFrame((_, delta) => {
    if (animate && ref.current) ref.current.rotation.z += delta * (0.25 + index * 0.12) * (index % 2 ? -1 : 1);
  });
  return (
    <group rotation={[0.45 + index * 0.32, index * 0.55 - 0.3, 0]}>
      {/* full faint track */}
      <mesh>
        <torusGeometry args={[radius, 0.006, 8, 160]} />
        <meshBasicMaterial color={ring.color} transparent opacity={0.32} />
      </mesh>
      {/* the share itself: arc length is proportional to its percentage */}
      <mesh ref={ref}>
        <torusGeometry args={[radius, tube, 16, 160, arc]} />
        <meshStandardMaterial color={ring.color} emissive={ring.color} emissiveIntensity={1.1} roughness={0.35} />
      </mesh>
    </group>
  );
}

/** The portfolio as an orb: one orbit per model, arc length = share of the workload. */
export default function AllocationOrb({ rings, tone }: { rings: OrbRing[]; tone: 'positive' | 'negative' }) {
  const reduced = usePrefersReducedMotion();
  const visible = usePageVisible();
  const animate = !reduced && visible;
  const core = useMemo(() => token(tone === 'positive' ? '--violet' : '--negative', '#8b7cf6'), [tone]);
  return (
    <Canvas aria-hidden="true" dpr={[1, 1.75]} camera={{ position: [0, 0, 6.2], fov: 45 }} frameloop={animate ? 'always' : 'demand'} gl={{ antialias: true, alpha: true }}>
      <ambientLight intensity={0.4} />
      <pointLight position={[3, 3, 4]} intensity={40} color={core} />
      <Float speed={animate ? 1.2 : 0} rotationIntensity={0.3} floatIntensity={0.5}>
        <mesh>
          <sphereGeometry args={[0.62, 48, 48]} />
          <meshStandardMaterial color={core} emissive={core} emissiveIntensity={0.9} roughness={0.25} metalness={0.4} />
        </mesh>
        <mesh scale={1.35}>
          <icosahedronGeometry args={[0.62, 1]} />
          <meshBasicMaterial color={core} wireframe transparent opacity={0.25} />
        </mesh>
        {rings.map((r, i) => (
          <Ring key={r.key} ring={r} index={i} animate={animate} />
        ))}
      </Float>
    </Canvas>
  );
}
