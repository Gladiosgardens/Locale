import makeQr from 'qrcode-generator';
import { useMemo } from 'react';
import { View } from 'react-native';
import { colors } from '@/theme';

// Draws a QR code with plain Views (no native module): each row is split into
// runs of dark modules, so a code is a few hundred small boxes at most.
export function QrCode({ value, size }: { value: string; size: number }) {
  const { rows, count } = useMemo(() => {
    const qr = makeQr(0, 'M');
    qr.addData(value);
    qr.make();
    const n = qr.getModuleCount();
    const out: { start: number; length: number }[][] = [];
    for (let r = 0; r < n; r++) {
      const runs: { start: number; length: number }[] = [];
      let c = 0;
      while (c < n) {
        if (!qr.isDark(r, c)) {
          c++;
          continue;
        }
        const start = c;
        while (c < n && qr.isDark(r, c)) c++;
        runs.push({ start, length: c - start });
      }
      out.push(runs);
    }
    return { rows: out, count: n };
  }, [value]);

  // Quiet zone of 2 modules around the code, as scanners expect.
  const cell = size / (count + 4);
  return (
    <View
      style={{ width: size, height: size, backgroundColor: colors.paper }}
      accessibilityRole="image"
      accessibilityLabel="QR code for your profile"
    >
      {rows.map((runs, r) =>
        runs.map((run) => (
          <View
            key={`${r}-${run.start}`}
            style={{
              position: 'absolute',
              top: (r + 2) * cell,
              left: (run.start + 2) * cell,
              width: run.length * cell + 0.5,
              height: cell + 0.5,
              backgroundColor: colors.ink,
            }}
          />
        )),
      )}
    </View>
  );
}
