/**
 * Dependency-free in-process metrics registry with Prometheus text exposition. Enough for the
 * worker's `/metrics` endpoint and for tests; swap for the OTel metrics SDK later if needed.
 */

export type Labels = Record<string, string | number | boolean>;

export interface Counter {
  inc(value?: number): void;
  get(): number;
}

export interface Gauge {
  set(value: number): void;
  inc(value?: number): void;
  dec(value?: number): void;
  get(): number;
}

export interface Histogram {
  observe(value: number): void;
}

export interface MetricDef {
  type: "counter" | "gauge" | "histogram";
  help: string;
  labels: readonly string[];
  buckets?: readonly number[];
}

export const DURATION_BUCKETS: readonly number[] = [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 20, 30, 60, 120, 300, 600];
export const SCORE_BUCKETS: readonly number[] = [50, 60, 70, 75, 80, 85, 90, 92, 95, 98, 100];
export const RATE_BUCKETS: readonly number[] = [0, 0.5, 1, 2, 3, 5, 8, 13, 20, 50];
export const DEFAULT_BUCKETS: readonly number[] = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

/** Pre-declared metric names. Unknown names are registered lazily with an empty help string. */
export const METRICS = {
  pipeline_step_duration_seconds: { type: "histogram", help: "Wall time per pipeline step", labels: ["step", "provider"], buckets: DURATION_BUCKETS },
  gate_decisions_total: { type: "counter", help: "Gate decisions", labels: ["decision"] },
  ptbr_flags_per_1k_words: { type: "histogram", help: "pt-BR lexicon hits per 1k words after the gate", labels: [], buckets: RATE_BUCKETS },
  judge_score: { type: "histogram", help: "Judge pt-PT score (0-100)", labels: [], buckets: SCORE_BUCKETS },
  tts_chars_total: { type: "counter", help: "Characters sent to TTS", labels: ["provider"] },
  tts_audio_seconds_total: { type: "counter", help: "Seconds of audio synthesised", labels: ["provider"] },
  provider_errors_total: { type: "counter", help: "Errors from upstream providers", labels: ["provider", "code"] },
  cost_usd_total: { type: "counter", help: "Estimated spend in USD", labels: ["provider", "step"] },
  jobs_total: { type: "counter", help: "Jobs by terminal or transitional status", labels: ["status"] },
  queue_depth: { type: "gauge", help: "Pending jobs per queue", labels: ["queue"] },
} as const satisfies Record<string, MetricDef>;

export type MetricName = keyof typeof METRICS;

export interface CounterSample {
  name: string;
  labels: Record<string, string>;
  value: number;
}

export interface HistogramSample {
  name: string;
  labels: Record<string, string>;
  count: number;
  sum: number;
  buckets: Array<{ le: number; count: number }>;
}

export interface Snapshot {
  counters: CounterSample[];
  gauges: CounterSample[];
  histograms: HistogramSample[];
}

export interface Registry {
  counter(name: MetricName | string, labels?: Labels): Counter;
  gauge(name: MetricName | string, labels?: Labels): Gauge;
  histogram(name: MetricName | string, labels?: Labels): Histogram;
  declare(name: string, def: MetricDef): void;
  snapshot(): Snapshot;
  renderPrometheus(): string;
  reset(): void;
}

interface Series {
  labels: Record<string, string>;
  value: number;
}

interface HistSeries {
  labels: Record<string, string>;
  buckets: number[];
  counts: number[];
  sum: number;
  count: number;
}

function normalizeLabels(labels: Labels | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!labels) return out;
  for (const key of Object.keys(labels).sort()) out[key] = String(labels[key]);
  return out;
}

function seriesKey(labels: Record<string, string>): string {
  return Object.entries(labels)
    .map(([k, v]) => `${k}=${v}`)
    .join(",");
}

function escapeLabel(v: string): string {
  return v.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}

function renderLabels(labels: Record<string, string>, extra?: Record<string, string>): string {
  const all = { ...labels, ...extra };
  const entries = Object.entries(all);
  if (!entries.length) return "";
  return `{${entries.map(([k, v]) => `${k}="${escapeLabel(v)}"`).join(",")}}`;
}

function formatNumber(n: number): string {
  if (n === Number.POSITIVE_INFINITY) return "+Inf";
  if (n === Number.NEGATIVE_INFINITY) return "-Inf";
  if (Number.isNaN(n)) return "NaN";
  return String(n);
}

export function createRegistry(): Registry {
  const defs = new Map<string, MetricDef>();
  for (const [name, def] of Object.entries(METRICS)) defs.set(name, def);
  const counters = new Map<string, Map<string, Series>>();
  const gauges = new Map<string, Map<string, Series>>();
  const histograms = new Map<string, Map<string, HistSeries>>();

  const defFor = (name: string, type: MetricDef["type"]): MetricDef => {
    let def = defs.get(name);
    if (!def) {
      def = { type, help: "", labels: [] };
      defs.set(name, def);
    } else if (def.type !== type) {
      throw new Error(`Metric ${name} is a ${def.type}, not a ${type}`);
    }
    return def;
  };

  const series = (store: Map<string, Map<string, Series>>, name: string, labels: Labels | undefined): Series => {
    let byLabels = store.get(name);
    if (!byLabels) {
      byLabels = new Map();
      store.set(name, byLabels);
    }
    const norm = normalizeLabels(labels);
    const key = seriesKey(norm);
    let s = byLabels.get(key);
    if (!s) {
      s = { labels: norm, value: 0 };
      byLabels.set(key, s);
    }
    return s;
  };

  const registry: Registry = {
    declare(name, def) {
      defs.set(name, def);
    },

    counter(name, labels) {
      defFor(name, "counter");
      const s = series(counters, name, labels);
      return {
        inc: (v = 1) => {
          if (v < 0) throw new Error(`Counter ${name} cannot decrease`);
          s.value += v;
        },
        get: () => s.value,
      };
    },

    gauge(name, labels) {
      defFor(name, "gauge");
      const s = series(gauges, name, labels);
      return {
        set: (v) => {
          s.value = v;
        },
        inc: (v = 1) => {
          s.value += v;
        },
        dec: (v = 1) => {
          s.value -= v;
        },
        get: () => s.value,
      };
    },

    histogram(name, labels) {
      const def = defFor(name, "histogram");
      let byLabels = histograms.get(name);
      if (!byLabels) {
        byLabels = new Map();
        histograms.set(name, byLabels);
      }
      const norm = normalizeLabels(labels);
      const key = seriesKey(norm);
      let h = byLabels.get(key);
      if (!h) {
        const buckets = [...(def.buckets ?? DEFAULT_BUCKETS)].sort((a, b) => a - b);
        h = { labels: norm, buckets, counts: buckets.map(() => 0), sum: 0, count: 0 };
        byLabels.set(key, h);
      }
      const hist = h;
      return {
        observe: (v) => {
          hist.sum += v;
          hist.count += 1;
          for (let i = 0; i < hist.buckets.length; i++) if (v <= hist.buckets[i]!) hist.counts[i]! += 1;
        },
      };
    },

    snapshot() {
      const toSamples = (store: Map<string, Map<string, Series>>): CounterSample[] =>
        [...store.entries()].flatMap(([name, byLabels]) =>
          [...byLabels.values()].map((s) => ({ name, labels: { ...s.labels }, value: s.value })),
        );
      const hists: HistogramSample[] = [...histograms.entries()].flatMap(([name, byLabels]) =>
        [...byLabels.values()].map((h) => ({
          name,
          labels: { ...h.labels },
          count: h.count,
          sum: h.sum,
          buckets: h.buckets.map((le, i) => ({ le, count: h.counts[i]! })),
        })),
      );
      return { counters: toSamples(counters), gauges: toSamples(gauges), histograms: hists };
    },

    renderPrometheus() {
      const lines: string[] = [];
      const header = (name: string, type: string) => {
        const help = defs.get(name)?.help ?? "";
        lines.push(`# HELP ${name} ${help}`, `# TYPE ${name} ${type}`);
      };
      for (const [name, byLabels] of [...counters.entries()].sort()) {
        header(name, "counter");
        for (const s of byLabels.values()) lines.push(`${name}${renderLabels(s.labels)} ${formatNumber(s.value)}`);
      }
      for (const [name, byLabels] of [...gauges.entries()].sort()) {
        header(name, "gauge");
        for (const s of byLabels.values()) lines.push(`${name}${renderLabels(s.labels)} ${formatNumber(s.value)}`);
      }
      for (const [name, byLabels] of [...histograms.entries()].sort()) {
        header(name, "histogram");
        for (const h of byLabels.values()) {
          for (let i = 0; i < h.buckets.length; i++) {
            lines.push(`${name}_bucket${renderLabels(h.labels, { le: formatNumber(h.buckets[i]!) })} ${h.counts[i]}`);
          }
          lines.push(`${name}_bucket${renderLabels(h.labels, { le: "+Inf" })} ${h.count}`);
          lines.push(`${name}_sum${renderLabels(h.labels)} ${formatNumber(h.sum)}`);
          lines.push(`${name}_count${renderLabels(h.labels)} ${h.count}`);
        }
      }
      return lines.join("\n") + (lines.length ? "\n" : "");
    },

    reset() {
      counters.clear();
      gauges.clear();
      histograms.clear();
    },
  };
  return registry;
}

/** Process-wide default registry. */
export const metrics: Registry = createRegistry();

export const counter = (name: MetricName | string, labels?: Labels): Counter => metrics.counter(name, labels);
export const gauge = (name: MetricName | string, labels?: Labels): Gauge => metrics.gauge(name, labels);
export const histogram = (name: MetricName | string, labels?: Labels): Histogram => metrics.histogram(name, labels);
export const snapshot = (): Snapshot => metrics.snapshot();
export const renderPrometheus = (): string => metrics.renderPrometheus();

/** Times an async function into `pipeline_step_duration_seconds{step,provider}`. */
export async function timeStep<T>(step: string, provider: string, fn: () => Promise<T>, registry: Registry = metrics): Promise<T> {
  const start = process.hrtime.bigint();
  try {
    return await fn();
  } finally {
    const seconds = Number(process.hrtime.bigint() - start) / 1e9;
    registry.histogram("pipeline_step_duration_seconds", { step, provider }).observe(seconds);
  }
}
