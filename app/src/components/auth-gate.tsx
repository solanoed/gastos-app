import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useState, type ReactNode } from 'react';
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from 'react-native';

import { getSetting, setSetting } from '@/db/repo';
import { useTheme } from '@/hooks/use-theme';
import { DEFAULT_SERVER, getSession, login } from '@/lib/api';
import { localMovementCount, restoreFromServer, serverHasData, syncNow } from '@/lib/sync';

import { authenticate, biometricAvailable, markAuthenticated } from './lock-gate';
import { Button, Field, Icon, Input, Txt } from './ui';

/**
 * Pide usuario y contraseña la primera vez. Después la sesión queda guardada en el celular
 * y la huella (LockGate) protege la entrada. Se puede seguir sin cuenta (solo local).
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const db = useSQLiteContext();
  const [state, setState] = useState<'checking' | 'login' | 'open'>('checking');

  useEffect(() => {
    (async () => {
      const [s, skipped] = await Promise.all([getSession(), getSetting(db, 'auth_skipped')]);
      setState(s.token || skipped === '1' ? 'open' : 'login');
    })();
  }, [db]);

  if (state === 'checking') return null;
  if (state === 'login') {
    return (
      <LoginScreen
        onDone={() => setState('open')}
        onSkip={async () => {
          await setSetting(db, 'auth_skipped', '1');
          setState('open');
        }}
      />
    );
  }
  return <>{children}</>;
}

export function LoginScreen({ onDone, onSkip }: { onDone: () => void; onSkip?: () => void }) {
  const db = useSQLiteContext();
  const t = useTheme();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [server, setServer] = useState(DEFAULT_SERVER);
  const [showServer, setShowServer] = useState(false);
  const [loading, setLoading] = useState(false);

  async function afterLogin() {
    // 1) Ofrecer la huella.
    if ((await getSetting(db, 'lock_enabled')) !== '1' && (await biometricAvailable())) {
      await new Promise<void>((resolve) =>
        Alert.alert('¿Entrar con tu huella?', 'La próxima vez podrás abrir la app con la huella en vez de la contraseña.', [
          { text: 'Ahora no', style: 'cancel', onPress: () => resolve() },
          {
            text: 'Activar',
            onPress: async () => {
              if (await authenticate('Confirma tu huella')) await setSetting(db, 'lock_enabled', '1');
              resolve();
            },
          },
        ]),
      );
    }
    // 2) Si el celular está vacío y el servidor tiene datos, ofrecer restaurar.
    const [local, remote] = await Promise.all([localMovementCount(db), serverHasData().catch(() => null)]);
    if (remote?.has && remote.movements > 0 && local === 0) {
      await new Promise<void>((resolve) =>
        Alert.alert('Tienes datos guardados', `El servidor tiene ${remote.movements} movimientos. ¿Quieres traerlos a este celular?`, [
          { text: 'No', style: 'cancel', onPress: () => resolve() },
          {
            text: 'Restaurar',
            onPress: async () => {
              try {
                await restoreFromServer(db);
              } catch (e) {
                Alert.alert('No se pudo restaurar', (e as Error).message);
              }
              resolve();
            },
          },
        ]),
      );
    } else {
      syncNow(db).catch(() => {});
    }
    await setSetting(db, 'auth_skipped', null);
    markAuthenticated();
    onDone();
  }

  async function submit() {
    if (!username.trim() || !password) return Alert.alert('Faltan datos', 'Escribe tu usuario y contraseña.');
    setLoading(true);
    try {
      await login(username.trim(), password, server.trim().replace(/\/+$/, ''));
      await afterLogin();
    } catch (e) {
      Alert.alert('No se pudo entrar', (e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: t.background }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: 24, gap: 16 }} keyboardShouldPersistTaps="handled">
        <View style={{ alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <Icon name="wallet" size={64} color={t.primary} />
          <Txt variant="title">Mis Cuentas</Txt>
          <Txt muted center>
            Inicia sesión para guardar tus datos en tu servidor y usar la IA.
          </Txt>
        </View>
        <Field label="Usuario">
          <Input value={username} onChangeText={setUsername} autoCapitalize="none" autoCorrect={false} placeholder="usuario" />
        </Field>
        <Field label="Contraseña">
          <Input value={password} onChangeText={setPassword} secureTextEntry placeholder="••••••••" onSubmitEditing={submit} returnKeyType="go" />
        </Field>
        {showServer ? (
          <Field label="Servidor">
            <Input value={server} onChangeText={setServer} autoCapitalize="none" autoCorrect={false} keyboardType="url" />
          </Field>
        ) : null}
        <Button title="Entrar" icon="login" onPress={submit} loading={loading} />
        <Pressable onPress={() => setShowServer((v) => !v)}>
          <Txt variant="small" muted center>
            {showServer ? 'Ocultar servidor' : 'Cambiar servidor'}
          </Txt>
        </Pressable>
        {onSkip ? (
          <Pressable onPress={onSkip}>
            <Txt variant="small" bold color={t.primary} center>
              Usar sin cuenta por ahora
            </Txt>
          </Pressable>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
