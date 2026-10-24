import { useFocusEffect } from 'expo-router';
import type { SQLiteDatabase } from 'expo-sqlite';
import { useSQLiteContext } from 'expo-sqlite';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';

import { scheduleSync } from '@/lib/sync';

/** Contador global: cualquier escritura llama `bump()` y las pantallas visibles recargan. */
const VersionContext = createContext<{ version: number; bump: () => void }>({ version: 0, bump: () => {} });

export function DataVersionProvider({ children }: { children: ReactNode }) {
  const db = useSQLiteContext();
  const [version, setVersion] = useState(0);
  const bump = useCallback(() => {
    setVersion((v) => v + 1);
    // Cada cambio programa una subida al servidor (si hay sesión).
    scheduleSync(db);
  }, [db]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') scheduleSync(db, 500);
    });
    scheduleSync(db, 1500);
    return () => sub.remove();
  }, [db]);

  return <VersionContext.Provider value={{ version, bump }}>{children}</VersionContext.Provider>;
}

export function useBump() {
  return useContext(VersionContext).bump;
}

/**
 * Carga datos de SQLite al enfocar la pantalla, cuando cambian `deps` o cuando otra pantalla escribe.
 */
export function useData<T>(loader: (db: SQLiteDatabase) => Promise<T>, deps: unknown[] = []) {
  const db = useSQLiteContext();
  const { version } = useContext(VersionContext);
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  // Los `deps` se serializan para que la lista de dependencias sea fija.
  const depsKey = JSON.stringify(deps);

  const load = useCallback(() => {
    let alive = true;
    loader(db)
      .then((d) => alive && (setData(d), setError(null)))
      .catch((e: Error) => alive && setError(e));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, version, depsKey]);

  // Se re-ejecuta al enfocar y cada vez que `load` cambia estando enfocada.
  useFocusEffect(load);

  return { data, error, reload: load };
}
