import { Contact, requestPermissionsAsync } from 'expo-contacts';
import { Alert, Linking } from 'react-native';

/** Abre el selector de contactos del celular. Devuelve nombre y teléfono, o null si se cancela. */
export async function pickContact(): Promise<{ name: string; phone: string | null } | null> {
  const perm = await requestPermissionsAsync();
  if (!perm.granted) {
    Alert.alert('Permiso necesario', 'Activa el permiso de contactos para elegir a la persona.');
    return null;
  }
  const c = await Contact.presentPicker();
  if (!c) return null;
  const [name, phones] = await Promise.all([c.getFullName(), c.getPhones()]);
  return { name: name.trim(), phone: phones.find((p) => p.number)?.number ?? null };
}

/** Número para wa.me: solo dígitos y con indicativo de Colombia si es un celular de 10 dígitos. */
export function waNumber(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 10 && digits.startsWith('3')) return '57' + digits;
  return digits;
}

export async function openWhatsApp(phone: string, text: string) {
  const url = `https://wa.me/${waNumber(phone)}?text=${encodeURIComponent(text)}`;
  try {
    await Linking.openURL(url);
  } catch {
    Alert.alert('No se pudo abrir WhatsApp');
  }
}

