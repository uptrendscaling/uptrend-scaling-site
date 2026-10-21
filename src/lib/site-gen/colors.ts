// Tiny color helpers for the site templates. Pure, no imports.

function parse(hex: string): [number, number, number] {
  const h = /^#[0-9a-f]{6}$/i.test(hex) ? hex.slice(1) : "2457ff";
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

function toHex(rgb: [number, number, number]): string {
  return (
    "#" +
    rgb
      .map((n) =>
        Math.max(0, Math.min(255, Math.round(n)))
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")
  );
}

// 0 returns `a`, 1 returns `b`.
export function mix(a: string, b: string, amount: number): string {
  const [ar, ag, ab] = parse(a);
  const [br, bg, bb] = parse(b);
  return toHex([
    ar + (br - ar) * amount,
    ag + (bg - ag) * amount,
    ab + (bb - ab) * amount,
  ]);
}

function channel(v: number): number {
  const s = v / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

export function luminance(hex: string): number {
  const [r, g, b] = parse(hex);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

// Text color that reads on top of `hex`.
export function onColor(hex: string): string {
  return luminance(hex) > 0.4 ? "#14110f" : "#ffffff";
}

// Contrast ratio between two colors (1 to 21).
export function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

// Moves `hex` toward white or black until it reads on `bg` (at least 4.5:1).
export function readableOn(hex: string, bg: string): string {
  if (contrast(hex, bg) >= 4.5) return hex;
  const target = luminance(bg) < 0.4 ? "#ffffff" : "#000000";
  for (let i = 1; i <= 10; i++) {
    const next = mix(hex, target, i / 10);
    if (contrast(next, bg) >= 4.5) return next;
  }
  return target;
}
