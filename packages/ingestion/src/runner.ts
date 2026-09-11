import type {
  CallOptions,
  ListingInput,
  ListingSource,
  NormalizeContext,
  RawListing,
  SavedSearch,
} from "@imovel/core";
import type Bottleneck from "bottleneck";
import type { CircuitBreaker } from "./breaker";

export type IngestRunStatus = "succeeded" | "failed" | "budget_stopped";
export type IngestOutcome = "new" | "changed" | "unchanged";

export interface RunIngestionInput {
  source: ListingSource;
  query: SavedSearch;
  ctx: NormalizeContext;
  /** Per-source token bucket, e.g. `createRateLimiter(rpm)`. Wraps every `search`/`detail` call. */
  limiter?: Bottleneck;
  /** Per-source circuit breaker. Wraps every `search`/`detail` call inside the limiter. */
  breaker?: CircuitBreaker;
  /** Resume from a prior run's `next_cursor`. Default: start from the first page. */
  cursor?: string | null;
  maxPages?: number;
  maxCredits?: number;
  /** Called once per successfully normalised item; the return value drives `items_new/changed/unchanged`. */
  onItem: (input: ListingInput, raw: RawListing) => Promise<IngestOutcome>;
  onProgress?: (info: { page: number; items_seen: number; credits_used: number }) => void;
  /** Fetch full detail when the source supports it and the item's summary has no description. Default false. */
  fetchDetail?: boolean;
  opts?: CallOptions;
}

export interface RunIngestionResult {
  status: IngestRunStatus;
  page: number;
  next_cursor: string | null;
  items_seen: number;
  items_new: number;
  items_changed: number;
  items_skipped: number;
  credits_used: number;
  error: string | null;
}

/**
 * Per-call credit cost that a `detail()` call cannot report through its `RawListing` return type
 * (unlike `search()`, whose `SearchPage.credits_used` is part of the core interface). Adapters
 * that charge per detail call (Parse.bot, Piloterr) attach it as this convention field; the runner
 * reads it and folds it into the run total. Absent on adapters that don't charge per call.
 */
function detailCreditsOf(raw: RawListing): number {
  const v = (raw as Record<string, unknown>).__credits_used;
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

function hasDescription(raw: RawListing): boolean {
  const r = raw as Record<string, unknown>;
  const d = r.description_original ?? r.description;
  return typeof d === "string" && d.trim().length > 0;
}

function refFrom(raw: RawListing): { source_id: string; url?: string | null } {
  const r = raw as Record<string, unknown>;
  const id = r.source_id ?? r.id ?? r.slug ?? r.propertyCode ?? "";
  const url = r.url ?? r.source_url ?? null;
  return { source_id: String(id), url: typeof url === "string" ? url : null };
}

async function callThrough<T>(fn: () => Promise<T>, limiter?: Bottleneck, breaker?: CircuitBreaker): Promise<T> {
  const run = () => (breaker ? breaker.exec(fn) : fn());
  return limiter ? limiter.schedule(run) : run();
}

function budgetStopped(
  status: "budget_stopped",
  cursor: string | null,
  counters: Omit<RunIngestionResult, "status" | "next_cursor" | "error">,
): RunIngestionResult {
  return { status, next_cursor: cursor, error: null, ...counters };
}

/**
 * Pages `source` from `cursor` (or the first page), normalising each item and handing it to
 * `onItem`. Stops early at `maxPages` or `maxCredits` (`budget_stopped`, cursor preserved so the
 * next run resumes exactly there). A failure fetching a page (`source.search`/`detail`) fails the
 * run with `next_cursor` still pointing at that unfetched page. A failure normalising or handling
 * one item (most commonly the `ValidationError` `normalize()` throws on a bad payload) is counted
 * in `items_skipped`; the run continues with the rest of the page.
 */
export async function runIngestion(input: RunIngestionInput): Promise<RunIngestionResult> {
  const { source, query, ctx, limiter, breaker, maxPages, maxCredits, onItem, onProgress, opts } = input;
  const fetchDetail = input.fetchDetail ?? false;
  const caps = source.capabilities();

  let cursor: string | null = input.cursor ?? null;
  let page = 0;
  let items_seen = 0;
  let items_new = 0;
  let items_changed = 0;
  let items_skipped = 0;
  let credits_used = 0;

  const counters = () => ({ page, items_seen, items_new, items_changed, items_skipped, credits_used });

  for (;;) {
    if (maxPages !== undefined && page >= maxPages) return budgetStopped("budget_stopped", cursor, counters());
    if (maxCredits !== undefined && credits_used >= maxCredits) return budgetStopped("budget_stopped", cursor, counters());

    const cursorBeforeFetch = cursor;
    let result;
    try {
      result = await callThrough(() => source.search(query, cursor, opts), limiter, breaker);
    } catch (error) {
      return {
        status: "failed",
        next_cursor: cursorBeforeFetch,
        error: error instanceof Error ? error.message : String(error),
        ...counters(),
      };
    }

    page += 1;
    credits_used += result.credits_used ?? 0;

    for (const raw of result.items) {
      items_seen += 1;
      try {
        let effectiveRaw = raw;
        if (fetchDetail && caps.detail && !hasDescription(raw)) {
          const detail = await callThrough(() => source.detail(refFrom(raw), opts), limiter, breaker);
          credits_used += detailCreditsOf(detail);
          effectiveRaw = { ...raw, ...detail };
        }
        const normalized = source.normalize(effectiveRaw, ctx);
        const outcome = await onItem(normalized, effectiveRaw);
        if (outcome === "new") items_new += 1;
        else if (outcome === "changed") items_changed += 1;
      } catch {
        items_skipped += 1;
      }
    }

    onProgress?.({ page, items_seen, credits_used });

    cursor = result.next;
    if (cursor === null) return { status: "succeeded", next_cursor: null, error: null, ...counters() };
    if (maxCredits !== undefined && credits_used >= maxCredits) return budgetStopped("budget_stopped", cursor, counters());
  }
}
