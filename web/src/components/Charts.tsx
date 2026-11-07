import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { monthLabel, formatPoints } from "@/lib/format";

/** Colores de marca R3: Night y Yellow (la barra amarilla lleva contorno Night para contraste sobre blanco). */
export const SERIES = { s1: "#0b1420", s2: "#f6c51b" };

export interface SeriesDef { key: string; label: string; color: string }

/** Barras mensuales (una o dos series, mismo eje y misma unidad). Incluye tooltip y leyenda cuando hay más de una serie. */
export function MonthlyBars({ data, series, height = 240, format = formatPoints }: { data: Record<string, number | string>[]; series: SeriesDef[]; height?: number; format?: (v: number) => string }) {
  return (
    <div>
      {series.length > 1 && (
        <div className="mb-3 flex flex-wrap gap-4 text-xs font-semibold text-ink-2">
          {series.map((s) => <span key={s.key} className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-sm ring-1 ring-ink/70" style={{ background: s.color }} />{s.label}</span>)}
        </div>
      )}
      <div style={{ height }} role="img" aria-label={`Gráfico mensual: ${series.map((s) => s.label).join(", ")}`}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} barGap={2} barCategoryGap="28%" margin={{ top: 4, right: 4, bottom: 0, left: -8 }}>
            <CartesianGrid vertical={false} stroke="#ece9e2" />
            <XAxis dataKey="month" tickFormatter={monthLabel} tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "#7a817c" }} interval="preserveStartEnd" />
            <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "#7a817c" }} width={52} tickFormatter={(v: number) => (v >= 1000 ? `${Math.round(v / 100) / 10}k` : String(v))} />
            <Tooltip
              cursor={{ fill: "rgb(15 20 18 / 0.04)" }}
              content={({ active, payload, label }) =>
                active && payload?.length ? (
                  <div className="rounded-xl border border-line bg-surface px-3 py-2 text-xs shadow-lg">
                    <p className="mb-1 font-bold capitalize">{monthLabel(String(label))}</p>
                    {payload.map((p) => (
                      <p key={String(p.dataKey)} className="flex items-center gap-1.5 text-ink-2">
                        <span className="size-2 rounded-sm" style={{ background: p.color }} />{p.name}: <b className="tabular text-ink">{format(Number(p.value))}</b>
                      </p>
                    ))}
                  </div>
                ) : null
              }
            />
            {series.map((s) => <Bar key={s.key} dataKey={s.key} name={s.label} fill={s.color} stroke={s.color === SERIES.s2 ? "#0b1420" : undefined} strokeWidth={s.color === SERIES.s2 ? 1 : 0} radius={[4, 4, 0, 0]} maxBarSize={28} />)}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/** Ranking horizontal simple (HTML), legible en móvil y accesible sin depender del color. */
export function RankBars({ items, format }: { items: { id: string; label: string; value: number }[]; format: (v: number) => string }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <ol className="space-y-3">
      {items.map((i, idx) => (
        <li key={i.id} className="text-sm">
          <div className="mb-1 flex items-baseline justify-between gap-3">
            <span className="truncate font-semibold"><span className="tabular mr-2 text-muted">{idx + 1}.</span>{i.label}</span>
            <span className="tabular shrink-0 font-bold">{format(i.value)}</span>
          </div>
          <div className="h-2 rounded-full bg-paper"><div className="h-full rounded-full bg-[var(--color-series-1)]" style={{ width: `${(i.value / max) * 100}%` }} /></div>
        </li>
      ))}
    </ol>
  );
}
