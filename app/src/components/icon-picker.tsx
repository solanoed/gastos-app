import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useMemo, useState } from 'react';
import { Alert, Pressable, View } from 'react-native';

import { CATEGORY_ICONS } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { persistImage } from '@/lib/files';
import { norm } from '@/lib/format';

import { Button, CUSTOM_ICON_PREFIX, Icon, Input, Row, Txt } from './ui';

const ALL_ICONS = Object.keys(MaterialCommunityIcons.glyphMap);

/** Los nombres de los íconos están en inglés: traducimos las búsquedas más comunes. */
const ES_TO_EN: Record<string, string> = {
  comida: 'food', restaurante: 'silverware', cafe: 'coffee', cerveza: 'beer', trago: 'glass-cocktail', vino: 'glass-wine',
  casa: 'home', hogar: 'home', arriendo: 'home-city', carro: 'car', moto: 'motorbike', bici: 'bicycle', bus: 'bus',
  avion: 'airplane', viaje: 'airplane', gasolina: 'gas-station', parqueadero: 'parking', taxi: 'taxi',
  plata: 'cash', dinero: 'cash', banco: 'bank', ahorro: 'piggy-bank', tarjeta: 'credit-card', regalo: 'gift',
  salud: 'medical', medico: 'doctor', farmacia: 'pill', hospital: 'hospital', dientes: 'tooth',
  ropa: 'tshirt', zapatos: 'shoe', pelo: 'content-cut', belleza: 'lipstick', gym: 'dumbbell', gimnasio: 'dumbbell',
  deporte: 'soccer', futbol: 'soccer', mascota: 'paw', perro: 'dog', gato: 'cat', bebe: 'baby',
  estudio: 'school', universidad: 'school', libro: 'book', curso: 'school', trabajo: 'briefcase',
  celular: 'cellphone', internet: 'wifi', luz: 'lightbulb', agua: 'water', gas: 'fire', tele: 'television',
  musica: 'music', cine: 'movie', juego: 'gamepad', fiesta: 'party-popper', amigos: 'account-group',
  familia: 'human-male-female-child', novia: 'heart', amor: 'heart', mercado: 'cart', compras: 'shopping',
  herramienta: 'tools', planta: 'flower', impuesto: 'bank', seguro: 'shield', deuda: 'hand-coin', prestamo: 'hand-coin',
  computador: 'laptop', iglesia: 'church', lavanderia: 'washing-machine', aseo: 'broom', domicilio: 'moped',
};

export function IconPicker({ value, color, onChange }: { value: string; color: string; onChange: (icon: string) => void }) {
  const t = useTheme();
  const [query, setQuery] = useState('');

  const results = useMemo(() => {
    const q = norm(query);
    if (!q) return CATEGORY_ICONS;
    const terms = [q, ...Object.entries(ES_TO_EN).filter(([es]) => es.startsWith(q)).map(([, en]) => en)];
    return ALL_ICONS.filter((name) => terms.some((term) => name.includes(term))).slice(0, 96);
  }, [query]);

  async function upload() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return Alert.alert('Permiso necesario', 'Activa el permiso de fotos.');
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: 'images', allowsEditing: true, aspect: [1, 1], quality: 1 });
    if (res.canceled) return;
    const uri = await persistImage(res.assets[0].uri, 'iconos');
    onChange(CUSTOM_ICON_PREFIX + uri);
  }

  return (
    <View style={{ gap: 8 }}>
      <Row>
        <Input value={query} onChangeText={setQuery} placeholder="Buscar: comida, carro, gym, perro…" autoCapitalize="none" style={{ flex: 1, paddingVertical: 10 }} />
        <Button title="Subir PNG" icon="upload" variant="secondary" small onPress={upload} />
      </Row>
      {value.startsWith(CUSTOM_ICON_PREFIX) ? (
        <Txt variant="caption" muted>
          Estás usando una imagen propia. Elige un ícono abajo para cambiarla.
        </Txt>
      ) : null}
      <Row style={{ flexWrap: 'wrap', gap: 4 }}>
        {results.map((ic) => (
          <Pressable key={ic} onPress={() => onChange(ic)} style={{ padding: 7, borderRadius: 10, backgroundColor: value === ic ? color + '33' : 'transparent' }}>
            <Icon name={ic} size={24} color={value === ic ? color : t.text} />
          </Pressable>
        ))}
      </Row>
      {results.length === 0 ? (
        <Txt variant="caption" muted>
          Sin resultados. Prueba en inglés (ej: “burger”) o sube tu propio PNG.
        </Txt>
      ) : null}
    </View>
  );
}
