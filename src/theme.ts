// Locale design tokens.
//
// The interface stays black and white so people's photos carry the colour.
// One accent, ultramarine, marks what is shoppable: prices, tag dots and the
// active state. Bodoni (fashion-magazine masthead serif) is reserved for the
// wordmark, names and big headings; Instrument Sans does everything else.

export const colors = {
  paper: '#FFFFFF',
  ink: '#000000',
  graphite: '#3D3D3D',
  muted: '#8A8A8A',
  hairline: '#E6E6E6',
  wash: '#F4F4F2',
  ultramarine: '#2338C8',
  ultramarineWash: '#ECEEFB',
  danger: '#C2261D',
  onInk: '#FFFFFF',
  // Kept for screens that still import the old names.
  bg: '#FFFFFF',
  text: '#000000',
  border: '#E6E6E6',
  accent: '#000000',
  accentText: '#FFFFFF',
  chip: '#F4F4F2',
};

export const fonts = {
  display: 'BodoniModa_600SemiBold',
  displayItalic: 'BodoniModa_500Medium_Italic',
  displayBold: 'BodoniModa_700Bold',
  body: 'InstrumentSans_400Regular',
  medium: 'InstrumentSans_500Medium',
  semibold: 'InstrumentSans_600SemiBold',
  bold: 'InstrumentSans_700Bold',
};

// Type scale (roughly a 1.25 ratio). Bodoni sizes are optical: it needs size to shine.
export const type = {
  wordmark: { fontFamily: fonts.displayItalic, fontSize: 30, letterSpacing: -0.5, color: colors.ink },
  hero: { fontFamily: fonts.display, fontSize: 40, lineHeight: 44, letterSpacing: -0.8, color: colors.ink },
  title: { fontFamily: fonts.display, fontSize: 28, lineHeight: 32, letterSpacing: -0.4, color: colors.ink },
  heading: { fontFamily: fonts.semibold, fontSize: 17, lineHeight: 22, color: colors.ink },
  body: { fontFamily: fonts.body, fontSize: 15, lineHeight: 22, color: colors.ink },
  bodyMuted: { fontFamily: fonts.body, fontSize: 15, lineHeight: 22, color: colors.muted },
  small: { fontFamily: fonts.body, fontSize: 13, lineHeight: 18, color: colors.muted },
  label: { fontFamily: fonts.semibold, fontSize: 13, lineHeight: 16, color: colors.ink },
  price: { fontFamily: fonts.semibold, fontSize: 14, color: colors.ultramarine },
} as const;

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };
export const radius = { tag: 6, pill: 999, sheet: 20 };
