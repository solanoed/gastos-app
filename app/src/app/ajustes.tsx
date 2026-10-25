import Constants from 'expo-constants';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useState } from 'react';
import { Alert, AppState, Modal, Switch, View } from 'react-native';

import { LoginScreen } from '@/components/auth-gate';
import { authenticate, biometricAvailable } from '@/components/lock-gate';
import { Button, Card, Divider, Field, Icon, Input, Row, Screen, SectionTitle, Sheet, Txt } from '@/components/ui';
import { getSetting, setSetting } from '@/db/repo';
import { useBump } from '@/hooks/use-data';
import { useTheme } from '@/hooks/use-theme';
import { api, clearSession, getSession } from '@/lib/api';
import {
  bankNotificationsEnabled,
  bankNotificationsSupported,
  flushBankNotifications,
  openNotificationAccessSettings,
} from '@/lib/bank-notifications';
import { lastSyncInfo, restoreFromServer, syncNow } from '@/lib/sync';

export default function Ajustes() {
  const db = useSQLiteContext();
  const bump = useBump();
  const t = useTheme();
  const [lock, setLock] = useState(false);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [account, setAccount] = useState<{ username: string | null; server: string } | null>(null);
  const [sync, setSync] = useState<{ at: string | null; error: string | null }>({ at: null, error: null });
  const [busy, setBusy] = useState<'sync' | 'restore' | null>(null);
  const [loginOpen, setLoginOpen] = useState(false);
  const [pwOpen, setPwOpen] = useState(false);

  const refresh = useCallback(async () => {
    const s = await getSession();
    setAccount({ username: s.token ? s.username : null, server: s.server });
    setSync(await lastSyncInfo(db));
  }, [db]);

  useEffect(() => {
    (async () => {
      setLock((await getSetting(db, 'lock_enabled')) === '1');
      setAvailable(await biometricAvailable());
      await refresh();
    })();
  }, [db, refresh]);

  async function toggleLock(v: boolean) {
    if (v) {
      if (!available) {
        return Alert.alert('Huella no disponible', 'Registra una huella en los ajustes del celular primero.');
      }
      if (!(await authenticate('Confirma tu huella'))) return;
    }
    await setSetting(db, 'lock_enabled', v ? '1' : '0');
    setLock(v);
  }

  async function doSync() {
    setBusy('sync');
    try {
      await syncNow(db);
    } catch (e) {
      Alert.alert('No se pudo sincronizar', (e as Error).message);
    } finally {
      setBusy(null);
      refresh();
    }
  }

  function doRestore() {
    Alert.alert('Restaurar desde el servidor', 'Se reemplazan TODOS los datos de este celular por los del servidor. ¿Seguro?', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Restaurar',
        style: 'destructive',
        onPress: async () => {
          setBusy('restore');
          try {
            const r = await restoreFromServer(db);
            bump();
            Alert.alert('Listo', `Se restauraron ${r.movements} movimientos.${r.failedFiles ? ` ${r.failedFiles} fotos no se pudieron descargar.` : ''}`);
          } catch (e) {
            Alert.alert('No se pudo restaurar', (e as Error).message);
          } finally {
            setBusy(null);
            refresh();
          }
        },
      },
    ]);
  }

  function logout() {
    Alert.alert('Cerrar sesión', 'Tus datos se quedan en el celular. Dejarán de sincronizarse hasta que vuelvas a entrar.', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Cerrar sesión',
        style: 'destructive',
        onPress: async () => {
          await clearSession();
          await setSetting(db, 'auth_skipped', '1');
          refresh();
        },
      },
    ]);
  }

  return (
    <Screen>
      <SectionTitle title="Cuenta" />
      <Card>
        {account?.username ? (
          <>
            <Row>
              <Icon name="account-circle" size={36} color={t.primary} />
              <View style={{ flex: 1 }}>
                <Txt bold>{account.username}</Txt>
                <Txt variant="caption" muted numberOfLines={1}>
                  {account.server}
                </Txt>
              </View>
            </Row>
            <Divider />
            <Txt variant="small" muted>
              {sync.at ? `Última sincronización: ${new Date(sync.at).toLocaleString('es-CO')}` : 'Aún no se ha sincronizado'}
            </Txt>
            {sync.error ? (
              <Txt variant="small" color={t.danger}>
                Último error: {sync.error}
              </Txt>
            ) : null}
            <Row>
              <Button title="Sincronizar" icon="cloud-upload" variant="secondary" small onPress={doSync} loading={busy === 'sync'} style={{ flex: 1 }} />
              <Button title="Restaurar" icon="cloud-download" variant="secondary" small onPress={doRestore} loading={busy === 'restore'} style={{ flex: 1 }} />
            </Row>
            <Row>
              <Button title="Contraseña" icon="key" variant="ghost" small onPress={() => setPwOpen(true)} style={{ flex: 1 }} />
              <Button title="Cerrar sesión" icon="logout" variant="ghost" small onPress={logout} style={{ flex: 1 }} />
            </Row>
          </>
        ) : (
          <>
            <Txt muted>Estás usando la app sin cuenta: los datos solo están en este celular y la IA no está disponible.</Txt>
            <Button title="Iniciar sesión" icon="login" onPress={() => setLoginOpen(true)} />
          </>
        )}
      </Card>

      <SectionTitle title="Seguridad" />
      <Card>
        <Row between>
          <Row style={{ flex: 1 }}>
            <Icon name="fingerprint" color={t.primary} />
            <View style={{ flex: 1 }}>
              <Txt bold>Bloquear con huella</Txt>
              <Txt variant="caption" muted>
                Pide tu huella al abrir la app y al volver después de 1 minuto.
              </Txt>
            </View>
          </Row>
          <Switch value={lock} onValueChange={toggleLock} trackColor={{ true: t.primary }} />
        </Row>
        {available === false ? (
          <Txt variant="caption" color={t.warning}>
            Este dispositivo no tiene huella registrada.
          </Txt>
        ) : null}
      </Card>

      <SectionTitle title="Movimientos automáticos" />
      <BankNotificationsCard />

      <SectionTitle title="Próximamente" />
      <Card>
        <Soon icon="file-document-outline" title="Leer facturas desde la foto" text="Sacar el valor y la fecha de una foto." />
        <Divider />
        <Soon icon="microsoft-excel" title="Exportar a Excel" text="Descargar tus movimientos." />
      </Card>

      <Txt variant="caption" muted center>
        Mis Cuentas v{Constants.expoConfig?.version ?? '1.0.0'}
      </Txt>

      <Modal visible={loginOpen} animationType="slide" onRequestClose={() => setLoginOpen(false)}>
        <LoginScreen
          onDone={() => {
            setLoginOpen(false);
            bump();
            refresh();
          }}
        />
        <View style={{ position: 'absolute', top: 40, right: 16 }}>
          <Button title="Cerrar" variant="ghost" small onPress={() => setLoginOpen(false)} />
        </View>
      </Modal>
      {pwOpen ? <PasswordSheet onClose={() => setPwOpen(false)} /> : null}
    </Screen>
  );
}

function BankNotificationsCard() {
  const t = useTheme();
  const [enabled, setEnabled] = useState(bankNotificationsEnabled);

  // Al volver de los ajustes del celular, revisar si ya dio el permiso.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      const now = bankNotificationsEnabled();
      setEnabled(now);
      if (now) flushBankNotifications();
    });
    return () => sub.remove();
  }, []);

  return (
    <Card>
      <Row>
        <Icon name="cellphone-message" color={t.primary} />
        <View style={{ flex: 1 }}>
          <Txt bold>Notificaciones del banco</Txt>
          <Txt variant="caption" muted>
            Lee las notificaciones de Bancolombia, Nequi y Daviplata (y los SMS del banco) y deja los movimientos en Por aprobar. Las
            demás notificaciones se ignoran.
          </Txt>
        </View>
      </Row>
      {!bankNotificationsSupported ? (
        <Txt variant="caption" color={t.warning}>
          Disponible solo en el APK de Android.
        </Txt>
      ) : enabled ? (
        <Row>
          <Icon name="check-circle" size={18} color={t.primary} />
          <Txt variant="small" color={t.primary} style={{ flex: 1 }}>
            Activo
          </Txt>
          <Button title="Ajustes" variant="ghost" small onPress={openNotificationAccessSettings} />
        </Row>
      ) : (
        <>
          <Button title="Dar acceso a notificaciones" icon="bell-ring-outline" onPress={openNotificationAccessSettings} />
          <Txt variant="caption" muted>
            Busca &quot;Mis Cuentas&quot; y actívalo. Si sale bloqueado (&quot;ajuste restringido&quot;), ve a Ajustes del celular → Apps → Mis
            Cuentas → ⋮ → Permitir ajustes restringidos, y vuelve a intentarlo.
          </Txt>
        </>
      )}
    </Card>
  );
}

function PasswordSheet({ onClose }: { onClose: () => void }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [loading, setLoading] = useState(false);

  async function save() {
    if (next.length < 8) return Alert.alert('Muy corta', 'La nueva contraseña debe tener al menos 8 caracteres.');
    setLoading(true);
    try {
      await api('/auth/password', { method: 'POST', json: { current, next } });
      Alert.alert('Listo', 'Contraseña actualizada.');
      onClose();
    } catch (e) {
      Alert.alert('No se pudo cambiar', (e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Sheet visible onClose={onClose} title="Cambiar contraseña" footer={<Button title="Guardar" icon="check" onPress={save} loading={loading} />}>
      <Field label="Contraseña actual">
        <Input value={current} onChangeText={setCurrent} secureTextEntry />
      </Field>
      <Field label="Nueva contraseña" hint="Mínimo 8 caracteres">
        <Input value={next} onChangeText={setNext} secureTextEntry />
      </Field>
    </Sheet>
  );
}

function Soon({ icon, title, text }: { icon: string; title: string; text: string }) {
  const t = useTheme();
  return (
    <Row style={{ paddingVertical: 4 }}>
      <Icon name={icon} color={t.textSecondary} />
      <View style={{ flex: 1 }}>
        <Txt bold>{title}</Txt>
        <Txt variant="caption" muted>
          {text}
        </Txt>
      </View>
    </Row>
  );
}
