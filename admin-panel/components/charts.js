import { useEffect, useRef, useState } from 'react';
import { MONTH_LABELS } from '../lib/format';

function useWidth() {
  const ref = useRef(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (!ref.current) return undefined;
    const el = ref.current;
    setWidth(el.clientWidth);
    const ro = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

/** Round the axis max up to a "nice" value and return 5 ticks (0..max). */
export function niceTicks(maxValue, count = 4) {
  const max = Math.max(1, maxValue);
  const raw = max / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) || raw;
  return Array.from({ length: count + 1 }, (_, i) => i * step);
}

function Tooltip({ x, y, children, width }) {
  const left = Math.min(Math.max(x, 50), width - 50);
  return (
    <div
      className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-md border border-white/10 bg-[#121926] px-2.5 py-1.5 text-[12px] text-white shadow-lg"
      style={{ left, top: y - 8 }}
    >
      {children}
    </div>
  );
}

/**
 * Monthly bar chart (Finances › Revenue performance). The highlighted bar is
 * the current month; others are muted teal.
 */
export function BarChart({ values, labels = MONTH_LABELS, highlight, formatTick, formatValue, height = 220 }) {
  const [ref, width] = useWidth();
  const [hover, setHover] = useState(null);
  const left = 48;
  const bottom = 26;
  const top = 8;
  const ticks = niceTicks(Math.max(...values, 0));
  const max = ticks[ticks.length - 1];
  const plotW = Math.max(0, width - left);
  const plotH = height - bottom - top;
  const slot = plotW / values.length;
  const barW = Math.min(44, slot * 0.76);
  return (
    <div ref={ref} className="relative w-full" style={{ height }}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label="Bar chart">
          {ticks.map((t) => {
            const y = top + plotH - (t / max) * plotH;
            return (
              <g key={t}>
                <line x1={left} x2={width} y1={y} y2={y} stroke="rgba(255,255,255,0.1)" />
                <text x={0} y={y + 4} fill="#c7d2dd" fontSize="10">{formatTick ? formatTick(t) : t}</text>
              </g>
            );
          })}
          {values.map((v, i) => {
            const h = max ? (v / max) * plotH : 0;
            const x = left + i * slot + (slot - barW) / 2;
            const y = top + plotH - h;
            const active = i === highlight;
            return (
              <g key={labels[i]} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
                <rect x={left + i * slot} y={top} width={slot} height={plotH} fill="transparent" />
                <rect x={x} y={y} width={barW} height={Math.max(h, v > 0 ? 2 : 0)} rx="2" fill={active ? '#12dce5' : '#237a7e'} opacity={hover === null || hover === i ? 1 : 0.7} />
                <text x={left + i * slot + slot / 2} y={height - 6} fill="#c7d2dd" fontSize="10" textAnchor="middle">{labels[i]}</text>
              </g>
            );
          })}
        </svg>
      )}
      {hover !== null && width > 0 && (
        <Tooltip width={width} x={left + hover * slot + slot / 2} y={top + plotH - (max ? (values[hover] / max) * plotH : 0)}>
          {labels[hover]} · {formatValue ? formatValue(values[hover]) : values[hover]}
        </Tooltip>
      )}
    </div>
  );
}

function smoothPath(points) {
  if (points.length < 2) return points.length ? `M${points[0][0]},${points[0][1]}` : '';
  let d = `M${points[0][0]},${points[0][1]}`;
  for (let i = 0; i < points.length - 1; i += 1) {
    const [x0, y0] = points[i - 1] || points[i];
    const [x1, y1] = points[i];
    const [x2, y2] = points[i + 1];
    const [x3, y3] = points[i + 2] || points[i + 1];
    const c1x = x1 + (x2 - x0) / 6;
    const c1y = y1 + (y2 - y0) / 6;
    const c2x = x2 - (x3 - x1) / 6;
    const c2y = y2 - (y3 - y1) / 6;
    d += ` C${c1x},${c1y} ${c2x},${c2y} ${x2},${y2}`;
  }
  return d;
}

/**
 * Smoothed line chart with optional area fill and an end-point badge
 * (Billing › Subscription Performance, Insights › User Engagement).
 */
export function LineChart({ values, labels, area = false, endBadge = false, formatTick, formatValue, height = 200, tickSize = 14, lastIndex }) {
  const [ref, width] = useWidth();
  const [hover, setHover] = useState(null);
  const left = 48;
  const bottom = 30;
  const top = 12;
  const right = 6;
  const shown = typeof lastIndex === 'number' ? values.slice(0, lastIndex + 1) : values;
  const ticks = niceTicks(Math.max(...values, 0));
  const max = ticks[ticks.length - 1];
  const plotW = Math.max(0, width - left - right);
  const plotH = height - bottom - top;
  const step = labels.length > 1 ? plotW / (labels.length - 1) : plotW;
  const pts = shown.map((v, i) => [left + i * step, top + plotH - (max ? (v / max) * plotH : 0)]);
  const line = smoothPath(pts);
  const last = pts[pts.length - 1];
  const gradId = `area-${labels.length}-${area ? 'a' : 'l'}`;
  return (
    <div ref={ref} className="relative w-full" style={{ height }} onMouseLeave={() => setHover(null)}>
      {width > 0 && (
        <svg
          width={width}
          height={height}
          role="img"
          aria-label="Line chart"
          onMouseMove={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const idx = Math.round((e.clientX - rect.left - left) / step);
            setHover(idx >= 0 && idx < shown.length ? idx : null);
          }}
        >
          <defs>
            <linearGradient id={gradId} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="#12dce5" stopOpacity="0.28" />
              <stop offset="100%" stopColor="#12dce5" stopOpacity="0" />
            </linearGradient>
          </defs>
          {ticks.map((t) => {
            const y = top + plotH - (t / max) * plotH;
            return (
              <g key={t}>
                <line x1={left} x2={width - right} y1={y} y2={y} stroke="rgba(255,255,255,0.12)" />
                <text x={0} y={y + 4} fill="#c7d2dd" fontSize={tickSize - 2}>{formatTick ? formatTick(t) : t}</text>
              </g>
            );
          })}
          {labels.map((l, i) => (
            <text key={l} x={left + i * step} y={height - 6} fill="#c7d2dd" fontSize={tickSize - 1} textAnchor={i === 0 ? 'start' : i === labels.length - 1 ? 'end' : 'middle'}>{l}</text>
          ))}
          {area && pts.length > 1 && (
            <path d={`${line} L${last[0]},${top + plotH} L${pts[0][0]},${top + plotH} Z`} fill={`url(#${gradId})`} />
          )}
          {pts.length > 1 && <path d={line} fill="none" stroke="#12dce5" strokeWidth="2" strokeLinecap="round" />}
          {endBadge && last && <circle cx={last[0]} cy={last[1]} r="3.5" fill="#12dce5" />}
          {hover !== null && pts[hover] && (
            <>
              <line x1={pts[hover][0]} x2={pts[hover][0]} y1={top} y2={top + plotH} stroke="rgba(18,220,229,0.35)" strokeDasharray="3 3" />
              <circle cx={pts[hover][0]} cy={pts[hover][1]} r="4" fill="#12dce5" stroke="#0a0d15" strokeWidth="2" />
            </>
          )}
        </svg>
      )}
      {endBadge && last && width > 0 && hover === null && (
        <span
          className="pointer-events-none absolute -translate-x-full -translate-y-full rounded bg-[#10303a] px-2 py-0.5 text-[11px] font-medium text-figma-accent"
          style={{ left: Math.max(last[0] - 4, 60), top: last[1] - 8 }}
        >
          {formatValue ? formatValue(shown[shown.length - 1]) : shown[shown.length - 1]}
        </span>
      )}
      {hover !== null && pts[hover] && width > 0 && (
        <Tooltip width={width} x={pts[hover][0]} y={pts[hover][1]}>
          {labels[hover]} · {formatValue ? formatValue(shown[hover]) : shown[hover]}
        </Tooltip>
      )}
    </div>
  );
}

/** Horizontal progress bar row (Top Subscribed Plans, Most Used AI Agent). */
export function BarRow({ label, value, pct, color = '#12dce5', thick }) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <span className="truncate text-[15px] text-white">{label}</span>
        <span className="shrink-0 text-[13px] text-figma-text-soft">{value}</span>
      </div>
      <div className={`mt-2 w-full rounded-full bg-[#1d263b] ${thick ? 'h-3.5 rounded-sm' : 'h-1.5'}`}>
        <div className={`h-full ${thick ? 'rounded-sm' : 'rounded-full'}`} style={{ width: `${Math.min(100, Math.max(0, pct))}%`, background: color }} />
      </div>
    </div>
  );
}
