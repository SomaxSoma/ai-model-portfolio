import { lazy } from 'react';

// The one 3D element loads on demand, so three.js never blocks the first paint of a data screen.
export const DotWave = lazy(() => import('./DotWave'));
export { Scene3D } from './Scene3D';
export { gradientAt, gradientSteps, hues, token, usePrefersReducedMotion } from './motion';
