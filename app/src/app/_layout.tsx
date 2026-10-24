import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { SQLiteProvider } from 'expo-sqlite';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { useColorScheme } from 'react-native';

import { AuthGate } from '@/components/auth-gate';
import { LockGate } from '@/components/lock-gate';
import { Colors } from '@/constants/theme';
import { migrate } from '@/db/schema';
import { DataVersionProvider } from '@/hooks/use-data';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const scheme = useColorScheme();
  const c = Colors[scheme === 'dark' ? 'dark' : 'light'];
  const base = scheme === 'dark' ? DarkTheme : DefaultTheme;
  const navTheme = {
    ...base,
    colors: {
      ...base.colors,
      background: c.background,
      card: c.card,
      text: c.text,
      border: c.border,
      primary: c.primary,
    },
  };

  return (
    <ThemeProvider value={navTheme}>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <SQLiteProvider databaseName="cuentas.db" onInit={migrate}>
        <HideSplash />
        <DataVersionProvider>
          <AuthGate>
            <LockGate>
              <Stack
                screenOptions={{
                  headerShadowVisible: false,
                  headerTitleStyle: { fontWeight: '700' },
                }}>
                <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
                <Stack.Screen name="categorias" options={{ title: 'Categorías' }} />
                <Stack.Screen name="calculadora" options={{ title: 'Calculadora' }} />
                <Stack.Screen name="persona/[id]" options={{ title: 'Persona' }} />
                <Stack.Screen name="ajustes" options={{ title: 'Ajustes' }} />
                <Stack.Screen name="bandeja" options={{ title: 'Por aprobar' }} />
                <Stack.Screen name="tarjeta/[id]" options={{ title: 'Tarjeta' }} />
                <Stack.Screen name="movimiento/[id]" options={{ title: 'Movimiento' }} />
              </Stack>
            </LockGate>
          </AuthGate>
        </DataVersionProvider>
      </SQLiteProvider>
    </ThemeProvider>
  );
}

/** Se monta cuando la base ya migró (SQLiteProvider espera a onInit). */
function HideSplash() {
  useEffect(() => {
    SplashScreen.hideAsync();
  }, []);
  return null;
}
