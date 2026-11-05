import { useCallback, useEffect, useState } from 'react';
import request from '../../utils/request';

/** Each widget can fail or retry without discarding the other widgets' data. */
export function useDashboardResource<T>(url: string) {
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<{
    data: T | null;
    loading: boolean;
    error: boolean;
    updatedAt: Date | null;
  }>({ data: null, loading: true, error: false, updatedAt: null });

  useEffect(() => {
    let active = true;
    const load = async () => {
      setState((previous) => ({ ...previous, loading: true, error: false }));
      try {
        const response = await request.get<unknown, { data: T }>(url);
        if (active) setState({ data: response.data, loading: false, error: false, updatedAt: new Date() });
      } catch {
        // The request interceptor reports the cause; the widget keeps a retry entry.
        if (active) setState((previous) => ({ ...previous, loading: false, error: true }));
      }
    };
    void load();
    return () => { active = false; };
  }, [url, revision]);

  const reload = useCallback(() => setRevision((previous) => previous + 1), []);
  return { ...state, reload };
}
