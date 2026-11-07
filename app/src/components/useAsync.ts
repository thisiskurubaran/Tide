import { DependencyList, useCallback, useEffect, useRef, useState } from 'react';

// Loads data for a screen: the value, an error message, and reload for pull
// to refresh. A newer load wins over a slower older one.
export function useAsync<T>(load: () => Promise<T>, deps: DependencyList) {
  const [value, setValue] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const run = useRef(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const reload = useCallback(async () => {
    const id = ++run.current;
    setLoading(true);
    setError(null);
    try {
      const v = await load();
      if (id === run.current) setValue(v);
    } catch (e) {
      if (id === run.current) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (id === run.current) setLoading(false);
    }
  }, deps);
  useEffect(() => {
    reload();
  }, [reload]);
  return { value, error, loading, reload, setValue };
}
