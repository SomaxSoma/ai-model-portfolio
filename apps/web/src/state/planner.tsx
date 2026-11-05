import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

/**
 * In-progress UI state: the comparison set, the workload form draft, and the
 * last recommendation opened. Everything a user commits (workloads,
 * recommendations, portfolios) lives on the server. The comparison set and
 * draft are also kept in this browser (localStorage) so a refresh doesn't
 * lose them; the comparison set is mirrored in the /compare URL for sharing.
 */
export interface WorkloadDraft {
  name: string;
  inputTokens: string;
  outputTokens: string;
  requestsPerMonth: string;
  budget: string;
  requiredCapabilities: string[];
  /** Ranking priorities in percent (normalised on the server). */
  weights: { quality: number; cost: number; latency: number; reliability: number };
}

export const DEFAULT_DRAFT: WorkloadDraft = {
  name: 'Customer support assistant',
  inputTokens: '1500',
  outputTokens: '400',
  requestsPerMonth: '50000',
  budget: '300',
  requiredCapabilities: [],
  weights: { quality: 60, cost: 40, latency: 0, reliability: 0 },
};

export const MAX_COMPARE = 4;

const STORAGE_KEY = 'pf.planner';

/** Valid model ids, unique, at most MAX_COMPARE — from storage or a shared URL. */
export function cleanCompareIds(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [];
  const ids = raw.map(Number).filter((n) => Number.isInteger(n) && n > 0);
  return [...new Set(ids)].slice(0, MAX_COMPARE);
}

function readStored(): { compare: number[]; draft: WorkloadDraft } {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as { compare?: unknown; draft?: Partial<WorkloadDraft> } | null;
    const d = parsed?.draft;
    const draft: WorkloadDraft =
      d && typeof d === 'object'
        ? {
            ...DEFAULT_DRAFT,
            ...Object.fromEntries(Object.entries(d).filter(([k, v]) => k in DEFAULT_DRAFT && (typeof v === typeof DEFAULT_DRAFT[k as keyof WorkloadDraft]))),
            weights: { ...DEFAULT_DRAFT.weights, ...(d.weights && typeof d.weights === 'object' ? d.weights : {}) },
            requiredCapabilities: Array.isArray(d.requiredCapabilities) ? d.requiredCapabilities.filter((c): c is string => typeof c === 'string') : [],
          }
        : DEFAULT_DRAFT;
    return { compare: cleanCompareIds(parsed?.compare), draft };
  } catch {
    return { compare: [], draft: DEFAULT_DRAFT };
  }
}

interface Planner {
  compare: number[];
  toggleCompare: (id: number) => void;
  setCompare: (ids: number[]) => void;
  clearCompare: () => void;
  draft: WorkloadDraft;
  setDraft: (d: WorkloadDraft) => void;
  lastRecommendationId: number | null;
  setLastRecommendationId: (id: number | null) => void;
}

const PlannerContext = createContext<Planner | null>(null);

export function PlannerProvider({ children }: { children: ReactNode }) {
  const [initial] = useState(readStored);
  const [compare, setCompareState] = useState<number[]>(initial.compare);
  const [draft, setDraft] = useState<WorkloadDraft>(initial.draft);
  const [lastRecommendationId, setLastRecommendationId] = useState<number | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ compare, draft }));
    } catch {
      // storage unavailable (private mode): state lasts for this tab only
    }
  }, [compare, draft]);

  const toggleCompare = useCallback((id: number) => {
    setCompareState((c) => (c.includes(id) ? c.filter((x) => x !== id) : c.length >= MAX_COMPARE ? c : [...c, id]));
  }, []);
  const setCompare = useCallback((ids: number[]) => setCompareState(cleanCompareIds(ids)), []);
  const clearCompare = useCallback(() => setCompareState([]), []);

  const value = useMemo(
    () => ({ compare, toggleCompare, setCompare, clearCompare, draft, setDraft, lastRecommendationId, setLastRecommendationId }),
    [compare, toggleCompare, setCompare, clearCompare, draft, lastRecommendationId],
  );
  return <PlannerContext.Provider value={value}>{children}</PlannerContext.Provider>;
}

export function usePlanner(): Planner {
  const p = useContext(PlannerContext);
  if (!p) throw new Error('usePlanner outside PlannerProvider');
  return p;
}
