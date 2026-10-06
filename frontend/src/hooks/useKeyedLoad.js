import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';

// Loads fetcher(params) whenever params change, and keeps what it loaded
// keyed by them: `loading` is true while what it holds is for other params,
// so the page never shows one filter's rows under another. reload() asks
// again with the same params. Empty values are left out of the request.
export function useKeyedLoad(fetcher, params) {
  const request = JSON.stringify(params);
  const [result, setResult] = useState({ key: null, data: null });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let cancelled = false;
    const p = JSON.parse(request);
    Object.keys(p).forEach((k) => { if (p[k] === '' || p[k] == null) delete p[k]; });
    fetcher(p)
      .then((d) => { if (!cancelled) setResult({ key: request, data: d }); })
      .catch((err) => {
        if (cancelled) return;
        toast.error(err.response?.data?.message || 'Failed to load');
        setResult({ key: request, data: null });
      });
    return () => { cancelled = true; };
  }, [fetcher, request, tick]);
  const loading = result.key !== request;
  return {
    data: loading ? null : result.data, last: result.data, loading, reload: () => setTick((t) => t + 1),
  };
}
