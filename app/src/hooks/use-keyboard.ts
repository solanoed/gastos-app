import { useEffect, useState, type ComponentRef } from 'react';
import { Dimensions, Keyboard, Platform, type View } from 'react-native';

/**
 * Cuánto tapa el teclado la parte de abajo de una vista.
 * Con edge-to-edge (Android) `KeyboardAvoidingView` no ajusta bien, así que medimos la vista
 * contra el borde superior del teclado y se usa el resultado como `paddingBottom`.
 * Devuelve un callback ref (`attach`) para pasarlo como `ref` de la vista.
 */
export function useKeyboardOverlap() {
  const [view, attach] = useState<ComponentRef<typeof View> | null>(null);
  const [overlap, setOverlap] = useState(0);

  useEffect(() => {
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const show = Keyboard.addListener(showEvt, (e) => {
      const screenH = Dimensions.get('screen').height;
      // screenY puede venir en 0 en algunos Android; en ese caso se calcula desde la altura.
      const keyboardTop = e.endCoordinates.screenY > 0 ? e.endCoordinates.screenY : screenH - e.endCoordinates.height;
      if (!view) return setOverlap(e.endCoordinates.height);
      view.measureInWindow((_x, y, _w, h) => setOverlap(Math.max(0, y + h - keyboardTop)));
    });
    const hide = Keyboard.addListener(hideEvt, () => setOverlap(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, [view]);

  return { attach, overlap };
}
