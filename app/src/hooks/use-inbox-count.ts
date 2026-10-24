import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import { api, getSession } from '@/lib/api';

/** Cantidad de movimientos detectados pendientes de aprobar (0 sin sesión o sin conexión). */
export function useInboxCount() {
  const [count, setCount] = useState(0);
  useFocusEffect(
    useCallback(() => {
      let alive = true;
      (async () => {
        if (!(await getSession()).token) return;
        try {
          const r = await api<{ pending: number }>('/inbox/count', { timeoutMs: 10_000 });
          if (alive) setCount(r.pending);
        } catch {
          // sin conexión: se mantiene el último valor
        }
      })();
      return () => {
        alive = false;
      };
    }, []),
  );
  return count;
}
