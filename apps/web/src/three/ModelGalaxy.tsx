import { OrbitControls } from '@react-three/drei';
import { Canvas, useFrame } from '@react-three/fiber';
import { useMemo, useRef, useState, type MutableRefObject } from 'react';
import * as THREE from 'three';
import { token, usePageVisible, usePrefersReducedMotion } from './motion';

export interface GalaxyPoint {
  id: number;
  name: string;
  provider: string;
  /** Monthly cost for the chosen volume, dollars. */
  cost: number;
  overall: number;
  latencyMs: number | null;
  eligible: boolean;
  /** Colour from the fixed categorical order, keyed by provider. */
  color: string;
}

type Vec3 = [number, number, number];
const SPAN = { x: 4.5, y: 2.4, z: 1.6 };
const AXES: { key: string; label: string; at: Vec3 }[] = [
  { key: 'x', label: 'cost →', at: [SPAN.x + 0.7, -SPAN.y, 0] },
  { key: 'y', label: '↑ quality', at: [-SPAN.x - 0.3, SPAN.y + 0.4, 0] },
  { key: 'z', label: 'latency ↘', at: [-SPAN.x, -SPAN.y, SPAN.z + 0.7] },
];

function normalise(values: number[], span: number): (v: number) => number {
  const min = Math.min(...values);
  const max = Math.max(...values);
  return (v) => (max === min ? 0 : ((v - min) / (max - min)) * 2 * span - span);
}

function Star({ p, position, hovered, onHover, onSelect }: { p: GalaxyPoint; position: Vec3; hovered: boolean; onHover: (id: number | null) => void; onSelect: (id: number) => void }) {
  const mesh = useRef<THREE.Mesh>(null);
  useFrame((_, delta) => {
    if (!mesh.current) return;
    const target = hovered ? 1.6 : 1;
    mesh.current.scale.setScalar(mesh.current.scale.x + (target - mesh.current.scale.x) * Math.min(1, delta * 10));
  });
  return (
    <group position={position}>
      <mesh
        ref={mesh}
        onPointerOver={(e) => {
          e.stopPropagation();
          onHover(p.id);
          document.body.style.cursor = 'pointer';
        }}
        onPointerOut={() => {
          onHover(null);
          document.body.style.cursor = '';
        }}
        onClick={(e) => {
          e.stopPropagation();
          onSelect(p.id);
        }}
      >
        <sphereGeometry args={[0.16, 32, 32]} />
        <meshStandardMaterial color={p.color} emissive={p.color} emissiveIntensity={p.eligible ? 1.4 : 0.25} roughness={0.3} transparent opacity={p.eligible ? 1 : 0.35} />
      </mesh>
      <mesh scale={hovered ? 2.6 : 2}>
        <sphereGeometry args={[0.16, 16, 16]} />
        <meshBasicMaterial color={p.color} transparent opacity={p.eligible ? 0.12 : 0.04} depthWrite={false} />
      </mesh>
      {/* drop line to the floor makes depth readable */}
      <mesh position={[0, -(position[1] + SPAN.y) / 2, 0]}>
        <boxGeometry args={[0.006, Math.max(0.001, position[1] + SPAN.y), 0.006]} />
        <meshBasicMaterial color={p.color} transparent opacity={0.25} />
      </mesh>
    </group>
  );
}

/**
 * Projects 3D anchors to screen space every rendered frame and moves plain DOM
 * labels there (no extra React roots, no re-renders).
 */
function LabelProjector({ anchors, els }: { anchors: Vec3[]; els: MutableRefObject<(HTMLElement | null)[]> }) {
  const v = useMemo(() => new THREE.Vector3(), []);
  useFrame(({ camera, size }) => {
    anchors.forEach((a, i) => {
      const el = els.current[i];
      if (!el) return;
      v.set(a[0], a[1], a[2]).project(camera);
      const x = ((v.x + 1) / 2) * size.width;
      const y = ((1 - v.y) / 2) * size.height;
      el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -50%)`;
      el.style.opacity = v.z < 1 ? '1' : '0';
    });
  });
  return null;
}

/**
 * Idle camera: a slow swing either side of the front view (cost across,
 * quality up, latency in depth), so labels rarely pile up edge-on. Stops for
 * good once the user drags.
 */
function CameraSwing({ enabled, interacted }: { enabled: boolean; interacted: MutableRefObject<boolean> }) {
  useFrame(({ camera, clock }) => {
    if (!enabled || interacted.current) return;
    const angle = Math.sin(clock.elapsedTime * 0.18) * 0.32;
    const r = 12.5;
    camera.position.set(Math.sin(angle) * r, 1.3, Math.cos(angle) * r);
    camera.lookAt(0, -0.3, 0);
  });
  return null;
}

/**
 * Model galaxy: every available model as a star in cost × quality × latency
 * space (cost on a log scale). Drag to orbit; click a star to open the model.
 * The same data is always available as a 2D chart and a table.
 */
export default function ModelGalaxy({ points, onSelect }: { points: GalaxyPoint[]; onSelect: (id: number) => void }) {
  const reduced = usePrefersReducedMotion();
  const visible = usePageVisible();
  const animate = !reduced && visible;
  const [hovered, setHovered] = useState<number | null>(null);
  const labelEls = useRef<(HTMLElement | null)[]>([]);
  const interacted = useRef(false);

  const placed = useMemo(() => {
    if (!points.length) return [];
    const logCost = (p: GalaxyPoint) => Math.log10(Math.max(p.cost, 0.0001));
    const x = normalise(points.map(logCost), SPAN.x);
    const y = normalise(points.map((p) => p.overall), SPAN.y);
    const lat = points.map((p) => p.latencyMs).filter((v): v is number => v !== null);
    const z = lat.length ? normalise(lat, SPAN.z) : () => 0;
    return points.map((p) => ({ p, position: [x(logCost(p)), y(p.overall), p.latencyMs === null ? 0 : z(p.latencyMs)] as Vec3 }));
  }, [points]);

  // Labels sit just above each star; axis captions follow.
  const anchors = useMemo<Vec3[]>(() => [...placed.map(({ position }) => [position[0], position[1] + 0.42, position[2]] as Vec3), ...AXES.map((a) => a.at)], [placed]);
  const line = token('--line-strong', '#3a4256');

  return (
    <div className="pf-galaxy__stage">
      <Canvas aria-hidden="true" dpr={[1, 1.75]} camera={{ position: [0, 1.3, 12.5], fov: 42 }} frameloop={animate ? 'always' : 'demand'} gl={{ antialias: true, alpha: true }}>
        <CameraSwing enabled={animate && hovered === null} interacted={interacted} />
        <ambientLight intensity={0.5} />
        <pointLight position={[6, 8, 6]} intensity={80} color={token('--cyan', '#38d6f5')} />
        <gridHelper args={[SPAN.x * 2.4, 12, line, line]} position={[0, -SPAN.y, 0]} />
        {placed.map(({ p, position }) => (
          <Star key={p.id} p={p} position={position} hovered={hovered === p.id} onHover={setHovered} onSelect={onSelect} />
        ))}
        <LabelProjector anchors={anchors} els={labelEls} />
        <OrbitControls target={[0, -0.3, 0]} enableZoom={false} enablePan={false} minPolarAngle={0.5} maxPolarAngle={1.6} onStart={() => (interacted.current = true)} />
      </Canvas>
      <div className="pf-galaxy__labels" aria-hidden="true">
        {placed.map(({ p }, i) => (
          <div key={p.id} ref={(el) => void (labelEls.current[i] = el)} className={`pf-galaxy__label${hovered === p.id ? ' pf-galaxy__label--hover' : ''}`}>
            <strong>{p.name}</strong>
            {hovered === p.id && (
              <span>
                {p.provider} · ${p.cost.toFixed(2)}/mo · score {p.overall}
                {p.latencyMs !== null ? ` · ${p.latencyMs} ms` : ''}
              </span>
            )}
          </div>
        ))}
        {AXES.map((a, i) => (
          <span key={a.key} ref={(el) => void (labelEls.current[placed.length + i] = el)} className="pf-galaxy__axis">
            {a.label}
          </span>
        ))}
      </div>
    </div>
  );
}
