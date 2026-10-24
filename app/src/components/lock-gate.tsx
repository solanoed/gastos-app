import * as LocalAuthentication from 'expo-local-authentication';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { AppState, View } from 'react-native';

import { getSetting } from '@/db/repo';
import { useTheme } from '@/hooks/use-theme';

import { Button, Icon, Txt } from './ui';

/** Tiempo en segundo plano tras el cual se vuelve a pedir la huella. */
const RELOCK_MS = 60_000;

// Si el usuario acaba de iniciar sesión, no pedir la huella otra vez al entrar.
let freshlyAuthenticated = false;
export function markAuthenticated() {
  freshlyAuthenticated = true;
}

export async function biometricAvailable() {
  const [hw, enrolled] = await Promise.all([LocalAuthentication.hasHardwareAsync(), LocalAuthentication.isEnrolledAsync()]);
  return hw && enrolled;
}

export async function authenticate(prompt = 'Desbloquear Mis Cuentas') {
  const r = await LocalAuthentication.authenticateAsync({
    promptMessage: prompt,
    cancelLabel: 'Cancelar',
    disableDeviceFallback: false,
  });
  return r.success;
}

/** Bloquea la app con la huella del celular si el usuario lo activó en Ajustes. */
export function LockGate({ children }: { children: ReactNode }) {
  const db = useSQLiteContext();
  const t = useTheme();
  const [state, setState] = useState<'checking' | 'locked' | 'open'>('checking');
  const backgroundAt = useRef<number | null>(null);
  const enabledRef = useRef(false);

  const unlock = useCallback(async () => {
    if (await authenticate()) setState('open');
  }, []);

  useEffect(() => {
    (async () => {
      enabledRef.current = (await getSetting(db, 'lock_enabled')) === '1';
      if (enabledRef.current && !freshlyAuthenticated && (await biometricAvailable())) {
        setState('locked');
        unlock();
      } else {
        setState('open');
      }
    })();
  }, [db, unlock]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', async (s) => {
      if (s === 'background') {
        backgroundAt.current = Date.now();
        enabledRef.current = (await getSetting(db, 'lock_enabled')) === '1';
      } else if (s === 'active' && backgroundAt.current) {
        const away = Date.now() - backgroundAt.current;
        backgroundAt.current = null;
        if (enabledRef.current && away > RELOCK_MS) {
          setState('locked');
          unlock();
        }
      }
    });
    return () => sub.remove();
  }, [db, unlock]);

  if (state === 'open') return <>{children}</>;
  return (
    <View style={{ flex: 1, backgroundColor: t.background, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 32 }}>
      <Icon name="fingerprint" size={72} color={t.primary} />
      <Txt variant="title">Mis Cuentas</Txt>
      {state === 'locked' ? (
        <>
          <Txt muted center>
            Usa tu huella para entrar
          </Txt>
          <Button title="Desbloquear" icon="lock-open-variant" onPress={unlock} />
        </>
      ) : null}
    </View>
  );
}
