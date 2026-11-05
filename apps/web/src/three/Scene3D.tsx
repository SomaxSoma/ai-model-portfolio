import { Component, Suspense, type ReactNode } from 'react';
import { webglAvailable } from './motion';

class Boundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

/**
 * Wraps a lazy 3D scene. No WebGL, a crash, or a slow chunk all fall back to
 * a static visual, so no page depends on the GPU.
 */
export function Scene3D({ children, fallback, className }: { children: ReactNode; fallback?: ReactNode; className?: string }) {
  const still = fallback ?? <div className="pf-scene-fallback" aria-hidden="true" />;
  if (!webglAvailable()) return <div className={className}>{still}</div>;
  return (
    <div className={className}>
      <Boundary fallback={still}>
        <Suspense fallback={still}>{children}</Suspense>
      </Boundary>
    </div>
  );
}
