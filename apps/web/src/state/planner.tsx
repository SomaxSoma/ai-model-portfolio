import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

/**
 * In-progress UI state that is not worth persisting: the comparison set, the
 * workload form draft, and the last recommendation opened. Everything a user
 * commits (workloads, recommendations, portfolios) lives on the server.
 */
export interface WorkloadDraft {
  name: string;
  inputTokens: string;
  outputTokens: string;
  requestsPerMonth: string;
  budget: string;
  requiredCapabilities: string[];
}

export const DEFAULT_DRAFT: WorkloadDraft = {
  name: 'Customer support assistant',
  inputTokens: '1500',
  outputTokens: '400',
  requestsPerMonth: '50000',
  budget: '300',
  requiredCapabilities: [],
};

export const MAX_COMPARE = 4;

interface Planner {
  compare: number[];
  toggleCompare: (id: number) => void;
  clearCompare: () => void;
  draft: WorkloadDraft;
  setDraft: (d: WorkloadDraft) => void;
  lastRecommendationId: number | null;
  setLastRecommendationId: (id: number | null) => void;
}

const PlannerContext = createContext<Planner | null>(null);

export function PlannerProvider({ children }: { children: ReactNode }) {
  const [compare, setCompare] = useState<number[]>([]);
  const [draft, setDraft] = useState<WorkloadDraft>(DEFAULT_DRAFT);
  const [lastRecommendationId, setLastRecommendationId] = useState<number | null>(null);

  const toggleCompare = useCallback((id: number) => {
    setCompare((c) => (c.includes(id) ? c.filter((x) => x !== id) : c.length >= MAX_COMPARE ? c : [...c, id]));
  }, []);
  const clearCompare = useCallback(() => setCompare([]), []);

  const value = useMemo(
    () => ({ compare, toggleCompare, clearCompare, draft, setDraft, lastRecommendationId, setLastRecommendationId }),
    [compare, toggleCompare, clearCompare, draft, lastRecommendationId],
  );
  return <PlannerContext.Provider value={value}>{children}</PlannerContext.Provider>;
}

export function usePlanner(): Planner {
  const p = useContext(PlannerContext);
  if (!p) throw new Error('usePlanner outside PlannerProvider');
  return p;
}
