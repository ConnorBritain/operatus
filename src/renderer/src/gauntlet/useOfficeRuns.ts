import { useEffect, useState } from 'react';
import { connectOfficeRuns, type OfficeRun } from './officeProjection';

export function useOfficeRuns() {
  const [state, setState] = useState<{ rows: OfficeRun[]; loading: boolean; error: string | null }>(
    { rows: [], loading: true, error: null });
  useEffect(() => connectOfficeRuns(window.cth, setState), []);
  return state;
}
