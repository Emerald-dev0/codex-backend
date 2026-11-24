import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Load data for a screen: { data, error, loading, reload }. Keeps the
 * previous data while reloading so filters don't flash skeletons.
 */
export default function useAsync(fn, deps = [], { enabled = true } = {}) {
  const [state, setState] = useState({ data: null, error: null, loading: enabled });
  const seq = useRef(0);
  const run = useCallback(async () => {
    const id = ++seq.current;
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const data = await fn();
      if (id === seq.current) setState({ data, error: null, loading: false });
      return data;
    } catch (error) {
      if (id === seq.current) setState((s) => ({ ...s, error, loading: false }));
      return null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => { if (enabled) run(); }, [run, enabled]);
  return { ...state, reload: run, setData: (data) => setState((s) => ({ ...s, data: typeof data === 'function' ? data(s.data) : data })) };
}

/** Debounce a changing value (search inputs). */
export function useDebounced(value, delay = 300) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return v;
}
