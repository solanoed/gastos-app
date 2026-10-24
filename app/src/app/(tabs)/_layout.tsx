import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Tabs } from 'expo-router/js-tabs';
import type { ColorValue } from 'react-native';

import { useTheme } from '@/hooks/use-theme';

type IconName = keyof typeof MaterialCommunityIcons.glyphMap;

function tabIcon(name: IconName) {
  return function TabIcon({ color, size }: { color: ColorValue; size: number }) {
    return <MaterialCommunityIcons name={name} color={color as string} size={size} />;
  };
}

export default function TabsLayout() {
  const t = useTheme();
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: t.primary,
        tabBarInactiveTintColor: t.textSecondary,
        tabBarStyle: { backgroundColor: t.card, borderTopColor: t.border },
        headerStyle: { backgroundColor: t.background },
        headerShadowVisible: false,
        headerTitleStyle: { fontWeight: '700' },
        tabBarLabelStyle: { fontSize: 11 },
      }}>
      <Tabs.Screen name="index" options={{ title: 'Inicio', tabBarIcon: tabIcon('view-dashboard') }} />
      <Tabs.Screen name="chat" options={{ title: 'Chat', tabBarIcon: tabIcon('message-text') }} />
      <Tabs.Screen name="historial" options={{ title: 'Historial', tabBarIcon: tabIcon('format-list-bulleted') }} />
      <Tabs.Screen name="plan" options={{ title: 'Mi plan', tabBarIcon: tabIcon('calendar-month') }} />
      <Tabs.Screen name="personas" options={{ title: 'Personas', tabBarIcon: tabIcon('account-group') }} />
      <Tabs.Screen name="tarjetas" options={{ title: 'Tarjetas', tabBarIcon: tabIcon('credit-card-multiple') }} />
    </Tabs>
  );
}
