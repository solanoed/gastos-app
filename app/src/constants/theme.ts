export const Colors = {
  light: {
    text: '#0F172A',
    textSecondary: '#64748B',
    background: '#F4F6F8',
    card: '#FFFFFF',
    backgroundElement: '#EEF1F4',
    backgroundSelected: '#DDE3EA',
    border: '#E2E8F0',
    primary: '#0E9F6E',
    primaryText: '#FFFFFF',
    primarySoft: '#DDF5EC',
    danger: '#DC2626',
    dangerSoft: '#FDE7E7',
    warning: '#D97706',
    warningSoft: '#FEF3C7',
    info: '#2563EB',
    infoSoft: '#E0EBFF',
    bubbleUser: '#0E9F6E',
    bubbleUserText: '#FFFFFF',
    bubbleBot: '#FFFFFF',
  },
  dark: {
    text: '#F1F5F9',
    textSecondary: '#94A3B8',
    background: '#0B1015',
    card: '#151C24',
    backgroundElement: '#1E2731',
    backgroundSelected: '#2A3541',
    border: '#243040',
    primary: '#34D399',
    primaryText: '#05231A',
    primarySoft: '#12352A',
    danger: '#F87171',
    dangerSoft: '#3A1A1A',
    warning: '#FBBF24',
    warningSoft: '#3A2E10',
    info: '#60A5FA',
    infoSoft: '#172A46',
    bubbleUser: '#1F6F55',
    bubbleUserText: '#F1F5F9',
    bubbleBot: '#151C24',
  },
} as const;

export type ThemeColors = { [K in keyof typeof Colors.light]: string };

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

export const Radius = { sm: 8, md: 14, lg: 20, pill: 999 } as const;

/** Paleta para categorías y tarjetas. */
export const PALETTE = [
  '#475569', '#F97316', '#16A34A', '#E11D48', '#D97706', '#CA8A04', '#0284C7', '#0891B2',
  '#7C3AED', '#DB2777', '#9333EA', '#0D9488', '#65A30D', '#2563EB', '#B45309', '#64748B',
];

/** Íconos sugeridos (MaterialCommunityIcons) al crear una categoría; el buscador permite cualquier otro. */
export const CATEGORY_ICONS = [
  'car', 'taxi', 'moped', 'motorbike', 'bus', 'bicycle', 'airplane', 'gas-station', 'parking', 'train',
  'cart', 'basket', 'shopping', 'store', 'silverware-fork-knife', 'hamburger', 'pizza', 'food-drumstick', 'coffee', 'beer',
  'glass-cocktail', 'ice-cream', 'cake-variant', 'fruit-cherries', 'fire', 'lightbulb-on', 'water', 'air-conditioner', 'wifi', 'cellphone',
  'television', 'home', 'home-city', 'sofa', 'washing-machine', 'broom', 'tools', 'hammer-wrench', 'flower', 'paw',
  'dog', 'cat', 'baby-carriage', 'human-male-female-child', 'account-group', 'heart', 'gift', 'party-popper', 'cake', 'church',
  'medical-bag', 'pill', 'hospital-box', 'tooth', 'glasses', 'dumbbell', 'run', 'soccer', 'basketball', 'yoga',
  'school', 'book-open-variant', 'pencil', 'laptop', 'briefcase', 'movie-open', 'music', 'gamepad-variant', 'ticket', 'spotify',
  'netflix', 'youtube', 'tshirt-crew', 'shoe-sneaker', 'hanger', 'lipstick', 'content-cut', 'ring', 'watch', 'bag-personal',
  'cash', 'cash-plus', 'bank', 'piggy-bank', 'credit-card', 'hand-coin', 'chart-line', 'receipt', 'shield-check', 'file-document',
  'beach', 'tent', 'map-marker', 'earth', 'camera', 'palette', 'guitar-acoustic', 'smoking', 'dots-horizontal', 'tag',
];
