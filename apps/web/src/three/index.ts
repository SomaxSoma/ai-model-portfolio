import { lazy } from 'react';

// 3D scenes load on demand, so three.js never blocks the first paint of a data screen.
export const Constellation = lazy(() => import('./Constellation'));
export const HeroOrb = lazy(() => import('./HeroOrb'));
export const ModelGalaxy = lazy(() => import('./ModelGalaxy'));
export const AllocationOrb = lazy(() => import('./AllocationOrb'));
export { Scene3D } from './Scene3D';
export { seriesColor, token, usePrefersReducedMotion } from './motion';
export type { GalaxyPoint } from './ModelGalaxy';
export type { OrbRing } from './AllocationOrb';
