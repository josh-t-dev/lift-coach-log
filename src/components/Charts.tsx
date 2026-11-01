import { useState, type ReactNode } from 'react';
import type { Point } from '../lib/analytics';

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const pow = 10 ** Math.floor(Math.log10(v));
  const n = v / pow;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
  return step * pow;
}

const fmtDefault = (n: number) => (Number.isInteger(n) ? n.toLocaleString() : n.toLocaleString(undefined, { maximumFractionDigits: 1 }));

/** Shell with a title, optional controls, and a chart/table toggle. */
export function ChartCard({
  title,
  subtitle,
  controls,
  table,
  children,
}: {
  title: string;
  subtitle?: string;
  controls?: ReactNode;
  table: { head: [string, string]; rows: [string, string][] };
  children: ReactNode;
}) {
  const [asTable, setAsTable] = useState(false);
  return (
    <section className="card chart-card" aria-label={title}>
      <div className="row spread" style={{ alignItems: 'flex-start' }}>
        <div className="grow">
          <h3 style={{ margin: 0 }}>{title}</h3>
          {subtitle && <div className="small muted">{subtitle}</div>}
        </div>
        <button className="btn small ghost" onClick={() => setAsTable(!asTable)} aria-pressed={asTable}>
          {asTable ? 'Chart' : 'Table'}
        </button>
      </div>
      {controls && <div className="chart-controls">{controls}</div>}
      {asTable ? (
        <table className="data-table">
          <thead>
            <tr><th>{table.head[0]}</th><th>{table.head[1]}</th></tr>
          </thead>
          <tbody>
            {table.rows.map(([a, b], i) => <tr key={i}><td>{a}</td><td>{b}</td></tr>)}
          </tbody>
        </table>
      ) : (
        children
      )}
    </section>
  );
}

/** Vertical bar chart, one series, optional target line. */
export function ColumnChart({
  data,
  target,
  targetLabel = 'Target',
  format = fmtDefault,
  unit = '',
  height = 150,
  empty = 'Nothing logged yet.',
}: {
  data: Point[];
  target?: number;
  targetLabel?: string;
  format?: (n: number) => string;
  unit?: string;
  height?: number;
  empty?: string;
}) {
  const [active, setActive] = useState<number | null>(null);
  if (!data.length || data.every((d) => d.value === 0) && !target) {
    return <p className="small muted chart-empty">{empty}</p>;
  }
  const max = niceMax(Math.max(...data.map((d) => d.value), target ?? 0) * 1.08);
  const ticks = [0, max / 2, max];
  const labelEvery = Math.max(1, Math.ceil(data.length / 6));
  const lastIdx = data.length - 1;
  const u = unit ? ` ${unit}` : '';

  return (
    <div className="colchart" onPointerLeave={() => setActive(null)}>
      <div className="colchart-y" style={{ height }} aria-hidden>
        {ticks.map((t) => (
          <span key={t} style={{ bottom: `${(t / max) * 100}%` }}>{format(t)}</span>
        ))}
      </div>
      <div className="colchart-main">
        <div className="colchart-plot" style={{ height }}>
          {ticks.map((t) => <i key={t} className="grid" style={{ bottom: `${(t / max) * 100}%` }} />)}
          {target != null && target > 0 && (
            <div className="target" style={{ bottom: `${(target / max) * 100}%` }}>
              <span>{targetLabel} {format(target)}</span>
            </div>
          )}
          {data.map((d, i) => {
            const h = (d.value / max) * 100;
            return (
              <button
                key={d.key}
                className={`cc-col ${active === i ? 'on' : ''}`}
                onPointerEnter={() => setActive(i)}
                onFocus={() => setActive(i)}
                onBlur={() => setActive(null)}
                onClick={() => setActive(active === i ? null : i)}
                aria-label={`${d.label}: ${format(d.value)}${u}`}
              >
                <span className="bar-fill" style={{ height: `${h}%` }} />
                {i === lastIdx && active === null && d.value > 0 && (
                  <span className="cap" style={{ bottom: `${h}%` }}>{format(d.value)}</span>
                )}
                {active === i && (
                  <span className={`tip ${i > data.length / 2 ? 'left' : ''}`} style={{ bottom: `${Math.min(h, 80)}%` }} role="tooltip">
                    <b>{format(d.value)}{u}</b>
                    <span>{d.label}</span>
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <div className="colchart-x" aria-hidden>
          {data.map((d, i) => (
            <span key={d.key}>{(lastIdx - i) % labelEvery === 0 ? d.label : ''}</span>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Horizontal bars for categories (e.g. muscles), each with its own target tick. */
export function BarList({ rows, format = fmtDefault }: { rows: { label: string; value: number; target?: number }[]; format?: (n: number) => string }) {
  const max = niceMax(Math.max(1, ...rows.map((r) => Math.max(r.value, r.target ?? 0))) * 1.05);
  return (
    <div className="bars">
      {rows.map((r) => (
        <div className="bars-row" key={r.label} title={`${r.label}: ${format(r.value)}${r.target ? ` of ${r.target} target` : ''}`}>
          <span className="cap-label">{r.label}</span>
          <div className="bar">
            <i style={{ width: `${(r.value / max) * 100}%` }} />
            {r.target ? <b style={{ left: `${(r.target / max) * 100}%` }} /> : null}
          </div>
          <span className="muted val">
            {format(r.value)}
            {r.target ? <span className="small">/{r.target}</span> : null}
          </span>
        </div>
      ))}
    </div>
  );
}
