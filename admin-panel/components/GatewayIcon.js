/** Small brand tiles for payment gateways (no third-party logo assets in the repo). */
const STYLES = {
  paypal: { bg: '#0b1f3a', fg: '#2aa7ff', glyph: 'P' },
  paystack: { bg: '#0b2a30', fg: '#3bd6c6', glyph: '≡' },
  flutterwave: { bg: '#2a1a0b', fg: '#f5a623', glyph: '✳' },
  stripe: { bg: '#1c1640', fg: '#8f86ff', glyph: 'S' },
};

export default function GatewayIcon({ id, size = 32 }) {
  const s = STYLES[id] || { bg: '#1d263b', fg: '#c7d2dd', glyph: '•' };
  return (
    <span
      aria-hidden="true"
      className="inline-flex shrink-0 items-center justify-center rounded-md border border-white/10 font-bold italic"
      style={{ width: size, height: size, background: s.bg, color: s.fg, fontSize: Math.round(size * 0.5) }}
    >
      {s.glyph}
    </span>
  );
}
