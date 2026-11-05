import { useEffect, useState } from 'react';

/** Honour the OS "reduce motion" setting: 3D scenes render one still frame instead of looping. */
export function usePrefersReducedMotion(): boolean {
  const query = '(prefers-reduced-motion: reduce)';
  const [reduced, setReduced] = useState(() => typeof window !== 'undefined' && !!window.matchMedia?.(query).matches);
  useEffect(() => {
    const mq = window.matchMedia?.(query);
    if (!mq) return;
    const on = () => setReduced(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return reduced;
}

/** Pause rendering while the tab is hidden. */
export function usePageVisible(): boolean {
  const [visible, setVisible] = useState(() => typeof document === 'undefined' || document.visibilityState !== 'hidden');
  useEffect(() => {
    const on = () => setVisible(document.visibilityState !== 'hidden');
    document.addEventListener('visibilitychange', on);
    return () => document.removeEventListener('visibilitychange', on);
  }, []);
  return visible;
}

let webgl: boolean | null = null;
export function webglAvailable(): boolean {
  if (webgl !== null) return webgl;
  try {
    const c = document.createElement('canvas');
    webgl = !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    webgl = false;
  }
  return webgl;
}

/** Read a design token (CSS custom property) so 3D colours follow the theme instead of being hard-coded. */
export function token(name: string, fallback = '#ffffff'): string {
  if (typeof document === 'undefined') return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

// ---------------------------------------------------------------------------
// The two-colour system in code: every chart and scene colour is a position
// on the --hue-a → --hue-b gradient, blended in OKLab (perceptually even, no
// muddy midpoint), the same space the CSS uses with color-mix(in oklab, …).
// ---------------------------------------------------------------------------
type Lab = [number, number, number];

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.trim().replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h.slice(0, 6);
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const toLinear = (c: number) => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
const fromLinear = (v: number) => {
  const c = v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;
  return Math.round(Math.min(1, Math.max(0, c)) * 255);
};
function rgbToOklab([r8, g8, b8]: [number, number, number]): Lab {
  const [r, g, b] = [toLinear(r8), toLinear(g8), toLinear(b8)];
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}
function oklabToHex([L, A, B]: Lab): string {
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  const rgb = [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
  return '#' + rgb.map((v) => fromLinear(v).toString(16).padStart(2, '0')).join('');
}

/** The two brand hues as hex, read from the tokens. */
export function hues(): { a: string; b: string } {
  return { a: token('--hue-a', '#8b7cf6'), b: token('--hue-b', '#38d6f5') };
}

/** A colour at position t (0 = hue a, 1 = hue b) on the brand gradient. */
export function gradientAt(t: number): string {
  const { a, b } = hues();
  const p = Math.min(1, Math.max(0, Number.isFinite(t) ? t : 0));
  const la = rgbToOklab(hexToRgb(a));
  const lb = rgbToOklab(hexToRgb(b));
  return oklabToHex([la[0] + (lb[0] - la[0]) * p, la[1] + (lb[1] - la[1]) * p, la[2] + (lb[2] - la[2]) * p]);
}

/** n evenly spaced colours along the gradient (n = 1 → the midpoint). */
export function gradientSteps(n: number): string[] {
  if (n <= 1) return [gradientAt(0.5)];
  return Array.from({ length: n }, (_, i) => gradientAt(i / (n - 1)));
}
