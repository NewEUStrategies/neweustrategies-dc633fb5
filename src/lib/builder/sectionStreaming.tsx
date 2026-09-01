// Suspense-streaming of below-the-fold builder sections.
//
// Why: edge-cached content routes warm the WHOLE builder document server-side
// (see prefetch.prefetchCachedRouteQueries). For cache HITS that is ideal - the
// CDN replays a fully server-rendered body. But a cache MISS (cold render) pays
// for every section's data before the first byte ships, so TTFB grows with the
// document length.
//
// This module keeps the above-the-fold sections eager (rendered into the
// initial SSR shell with their data) and wraps each below-the-fold,
// data-bound section in a `<Suspense>` boundary backed by a server-only gate.
// React's streaming renderer flushes the shell immediately and then streams
// each below-the-fold section's resolved HTML as its data settles - so TTFB
// tracks the above-the-fold cost only, never the whole document, while the
// rendered output (and therefore the cached body and what crawlers see) stays
// byte-for-byte complete.
//
// Client behaviour is deliberately unchanged: the gate exists only on the
// server (tree-shaken out of the client bundle via `import.meta.env.SSR`), so
// the browser hydrates the streamed HTML directly - widgets read the
// streamed/dehydrated query cache (no refetch flash), and `useSectionPreload`
// keeps its scroll-driven, lazy prefetch for client-side navigations and any
// budget-fallback tail.
import { Suspense, type ReactElement, type ReactNode } from "react";
import { useQueryClient, type QueryClient, type QueryKey } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { SectionNode } from "@/lib/builder/types";
import type { Lang } from "@/lib/builder/postListQuery";
import {
  pendingSectionQueries,
  prefetchBuilderSectionQuery,
  sectionQueryOptionsList,
} from "@/lib/builder/prefetch";
import { RenderErrorBoundary } from "@/components/error/RenderErrorBoundary";

/**
 * True while the server streams HTML, false in the browser. Vite replaces
 * `import.meta.env.SSR` with a literal at build time, so the server-only gate
 * - and its render-phase prefetch - is eliminated from the client bundle.
 */
const IS_SSR: boolean = import.meta.env.SSR;

/**
 * Hard cap for a single below-the-fold section's render-phase prefetch. This is
 * intentionally shorter than the global query watchdog: the section stream is a
 * progressive enhancement, while the document itself must never wait on a dead
 * render-phase promise before router dehydration can even start.
 */
export const SERVER_SECTION_STREAM_BUDGET_MS = 2_000;

type SectionGateRecord = {
  exhausted: boolean;
  promise?: Promise<void>;
};

const sectionGateRecords = new WeakMap<QueryClient, Map<string, SectionGateRecord>>();

function safeKey(key: QueryKey): string {
  try {
    return JSON.stringify(key);
  } catch {
    return String(key);
  }
}

function sectionGateKey(
  section: SectionNode,
  lang: Lang,
  pendingKeys: readonly QueryKey[],
): string {
  return `${lang}:${section.id}:${pendingKeys.map(safeKey).join("|")}`;
}

function recordsFor(queryClient: QueryClient): Map<string, SectionGateRecord> {
  const existing = sectionGateRecords.get(queryClient);
  if (existing) return existing;
  const created = new Map<string, SectionGateRecord>();
  sectionGateRecords.set(queryClient, created);
  return created;
}

function removeDeadSectionQueries(queryClient: QueryClient, keys: readonly QueryKey[]): void {
  for (const queryKey of keys) {
    const state = queryClient.getQueryState(queryKey);
    if (!state) continue;
    if (state.status === "pending" && state.data === undefined) {
      queryClient.removeQueries({ queryKey, exact: true });
    }
  }
}

function createBoundedSectionPrefetch(
  queryClient: QueryClient,
  record: SectionGateRecord,
  pending: ReturnType<typeof pendingSectionQueries>,
): Promise<void> {
  const pendingKeys = pending.map((options) => options.queryKey);
  const pendingKeySet = new Set(pendingKeys.map(safeKey));
  let timer: ReturnType<typeof setTimeout> | undefined;

  const work = Promise.allSettled(
    pending.map((options) => prefetchBuilderSectionQuery(queryClient, options)),
  ).then(() => undefined);

  const budget = new Promise<void>((resolve) => {
    timer = setTimeout(() => {
      record.exhausted = true;
      void queryClient.cancelQueries({
        predicate: (query) => pendingKeySet.has(safeKey(query.queryKey)),
      });
      removeDeadSectionQueries(queryClient, pendingKeys);
      resolve();
    }, SERVER_SECTION_STREAM_BUDGET_MS);
  });

  return Promise.race([work, budget]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}

/**
 * Server-only data gate. Suspends the enclosing `<Suspense>` boundary until
 * every not-yet-loaded query the section's widgets read has SETTLED, then
 * renders the real section so React can stream its resolved HTML.
 *
 * It deliberately does NOT use `useSuspenseQueries`: that throws on a rejected
 * query, which would escalate a single failed widget query into a section-wide
 * error boundary. `prefetchQuery` resolves on success AND error and never
 * rejects, so streaming changes only WHEN a section paints - never WHAT it
 * paints. Each widget keeps its own empty/error/skeleton fallback.
 */
export function ServerSectionGate({
  section,
  lang,
  children,
}: {
  section: SectionNode;
  lang: Lang;
  children: ReactNode;
}): ReactElement {
  const queryClient = useQueryClient();
  const pending = pendingSectionQueries(queryClient, section, lang);
  if (pending.length > 0) {
    const pendingKeys = pending.map((options) => options.queryKey);
    const key = sectionGateKey(section, lang, pendingKeys);
    const records = recordsFor(queryClient);
    const record = records.get(key) ?? { exhausted: false };
    records.set(key, record);

    if (record.exhausted) {
      removeDeadSectionQueries(queryClient, pendingKeys);
      return <>{children}</>;
    }

    if (!record.promise) {
      record.promise = createBoundedSectionPrefetch(queryClient, record, pending);
    }
    throw record.promise;
  }
  return <>{children}</>;
}

/**
 * Zero-data, low-CLS placeholder shown while a below-the-fold section streams.
 * On a cache HIT it is never seen (the CDN serves the resolved body); on a cold
 * render it appears only for the brief window between shell flush and the
 * section's data settling. `minHeight` reserves space to blunt layout shift.
 */
export function SectionStreamSkeleton({ minHeight = 280 }: { minHeight?: number }): ReactElement {
  const { t } = useTranslation();
  return (
    <div
      data-section-stream-skeleton
      aria-busy="true"
      aria-label={t("builder.sectionLoading")}
      className="w-full"
      style={{ minHeight }}
    >
      <div
        className="mx-auto flex max-w-[1200px] flex-col gap-4 px-4 py-10 lg:px-8"
        aria-hidden="true"
      >
        <div className="h-7 w-1/3 max-w-xs rounded-md skeleton-shimmer" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, index) => (
            <div key={index} className="flex flex-col gap-2">
              <div className="aspect-[4/3] w-full rounded-md skeleton-shimmer" />
              <div className="h-4 w-3/4 rounded skeleton-shimmer" />
              <div className="h-3 w-1/2 rounded skeleton-shimmer" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

interface StreamingSectionProps {
  section: SectionNode;
  lang: Lang;
  /** Zero-based position of this section in the document. */
  index: number;
  /** Leading sections rendered eagerly into the SSR shell (above the fold). */
  aboveFoldCount: number;
  /** Master switch - when false, behaves exactly like the pre-streaming renderer. */
  enabled: boolean;
  /** The already-error-boundaried section content. */
  children: ReactNode;
}

/**
 * Whether a section is Suspense-streamed (server gate) rather than rendered
 * eagerly into the SSR shell. A section streams only when all three hold:
 *  - streaming is enabled,
 *  - it sits at or below the eager above-the-fold window (`index >= aboveFoldCount`), and
 *  - it has at least one data-bound query to await.
 *
 * So `aboveFoldCount` is the eager-render budget, and every streaming caller
 * keeps it NON-ZERO: `$.tsx` (posts + all public pages) and, since 2026-09-01,
 * the homepage both prefetch their leading `ABOVE_FOLD_SECTION_COUNT` sections
 * in the loader and render exactly that window eagerly, so the hero's data is
 * in the shell. No caller passes `0`.
 *
 * (Do 2026-09-01 stało tu zdanie, że „strona główna przekazuje `0`, żeby
 * strumieniować każdą sekcję z danymi" - nieprawda w obie strony: strona główna
 * nie strumieniowała wtedy w ogóle, a dziś używa domyślnego okna 3 sekcji.
 * Zapisane, żeby nieprawdziwy komentarz nie wrócił po cichu.)
 *
 * Static sections (no queries) stay eager regardless, so the hero shell is
 * never delayed.
 *
 * Pure + side-effect free so the eager/stream decision is unit-testable without
 * rendering or an SSR environment.
 */
export function shouldStreamSection(
  section: SectionNode,
  lang: Lang,
  index: number,
  aboveFoldCount: number,
  enabled: boolean,
): boolean {
  if (!enabled || index < aboveFoldCount) return false;
  return sectionQueryOptionsList(section, lang).length > 0;
}

/**
 * Render a builder section, choosing eager vs Suspense-streamed via
 * {@link shouldStreamSection}. The `<Suspense>` boundary is rendered on both
 * server and client so hydration aligns; only the server mounts the suspending
 * gate (the client tree-shakes it out via `import.meta.env.SSR`).
 */
export function StreamingSection({
  section,
  lang,
  index,
  aboveFoldCount,
  enabled,
  children,
}: StreamingSectionProps): ReactElement {
  if (!shouldStreamSection(section, lang, index, aboveFoldCount, enabled)) {
    return <>{children}</>;
  }

  return (
    <RenderErrorBoundary label={`stream-section:${section.id}`} fallback={null}>
      <Suspense fallback={<SectionStreamSkeleton />}>
        {IS_SSR ? (
          <ServerSectionGate section={section} lang={lang}>
            {children}
          </ServerSectionGate>
        ) : (
          children
        )}
      </Suspense>
    </RenderErrorBoundary>
  );
}
