// Data-bound sections use a bounded server-only Suspense gate. Loader-prefetched
// data renders immediately; queries that missed the loader deadline stream real
// HTML without delaying the shell. This includes the first fold: emitting a
// pending widget there while its data completes in the query stream makes the
// hydrated client disagree with the HTML and rebuild the section.
import { Suspense, type ReactElement, type ReactNode } from "react";
import { useQueryClient, type QueryClient, type QueryKey } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { SectionNode } from "@/lib/builder/types";
import { GUEST_ACCESS_CONTEXT } from "./accessControl";
import type { SectionRenderContext } from "./renderVisibility";
import type { Lang } from "@/lib/builder/postListQuery";
import {
  pendingSectionQueries,
  prefetchBuilderSectionQuery,
  sectionQueryOptionsList,
} from "@/lib/builder/prefetch";
import {
  estimateSectionHeight,
  SECTION_STREAM_MIN_HEIGHT,
} from "@/lib/builder/sectionHeightEstimate";
import { RenderErrorBoundary } from "@/components/error/RenderErrorBoundary";

/**
 * True while the server streams HTML, false in the browser. Vite replaces
 * `import.meta.env.SSR` with a literal at build time, so the server-only gate
 * - and its render-phase prefetch - is eliminated from the client bundle.
 */
const IS_SSR: boolean = import.meta.env.SSR;
const DEFAULT_RENDER_CONTEXT: SectionRenderContext = {
  device: "desktop",
  accessContext: GUEST_ACCESS_CONTEXT,
};

/**
 * Hard cap for a single below-the-fold section's render-phase prefetch. This is
 * intentionally shorter than the global query watchdog: the section stream is a
 * progressive enhancement, while the document itself must never wait on a dead
 * render-phase promise before router dehydration can even start.
 */
export const SERVER_SECTION_STREAM_BUDGET_MS = 2_000;

type SectionGateRecord = {
  exhausted: boolean;
  deadlineAt: number;
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
    timer = setTimeout(
      () => {
        record.exhausted = true;
        void queryClient.cancelQueries({
          predicate: (query) => pendingKeySet.has(safeKey(query.queryKey)),
        });
        removeDeadSectionQueries(queryClient, pendingKeys);
        resolve();
      },
      Math.max(0, record.deadlineAt - Date.now()),
    );
  });

  return Promise.race([work, budget]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
    // The next render may discover dependent data (slider authors). It gets
    // the remaining section budget, never another full two seconds.
    record.promise = undefined;
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
  renderContext = DEFAULT_RENDER_CONTEXT,
  children,
}: {
  section: SectionNode;
  lang: Lang;
  renderContext?: SectionRenderContext;
  children: ReactNode;
}): ReactElement {
  const queryClient = useQueryClient();
  const pending = pendingSectionQueries(queryClient, section, lang, renderContext);
  if (pending.length > 0) {
    const pendingKeys = pending.map((options) => options.queryKey);
    const key = `${lang}:${section.id}`;
    const records = recordsFor(queryClient);
    const record = records.get(key) ?? {
      exhausted: false,
      deadlineAt: Date.now() + SERVER_SECTION_STREAM_BUDGET_MS,
    };
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
 *
 * Domyślne `SECTION_STREAM_MIN_HEIGHT` zostaje wyłącznie jako dno dla wołających
 * bez sekcji - `StreamingSection` liczy wysokość z jej konfiguracji
 * (`estimateSectionHeight`), bo stałe 280 px wobec sekcji 400-900 px zamieniało
 * każde dostrumieniowanie w przesunięcie układu.
 */
export function SectionStreamSkeleton({
  minHeight = SECTION_STREAM_MIN_HEIGHT,
}: {
  minHeight?: number;
}): ReactElement {
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
  renderContext?: SectionRenderContext;
  /** Master switch - when false, behaves exactly like the pre-streaming renderer. */
  enabled: boolean;
  /** The already-error-boundaried section content. */
  children: ReactNode;
}

/** Static sections need no data gate. Warm data sections never suspend. */
export function shouldStreamSection(
  section: SectionNode,
  lang: Lang,
  enabled: boolean,
  renderContext: SectionRenderContext = DEFAULT_RENDER_CONTEXT,
): boolean {
  return enabled && sectionQueryOptionsList(section, lang, renderContext).length > 0;
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
  enabled,
  renderContext = DEFAULT_RENDER_CONTEXT,
  children,
}: StreamingSectionProps): ReactElement {
  // The loader's first-fold prefetch is bounded, so "above the fold" does not
  // guarantee that its data is ready. Always put data-bound sections behind
  // the same server gate. Warm sections still render into the initial shell;
  // a cold hero streams real HTML instead of committing an empty widget while
  // the query stream later hydrates the client with a different result.
  if (!shouldStreamSection(section, lang, enabled, renderContext)) {
    return <>{children}</>;
  }

  return (
    <RenderErrorBoundary label={`stream-section:${section.id}`} fallback={null}>
      <Suspense fallback={<SectionStreamSkeleton minHeight={estimateSectionHeight(section)} />}>
        {IS_SSR ? (
          <ServerSectionGate section={section} lang={lang} renderContext={renderContext}>
            {children}
          </ServerSectionGate>
        ) : (
          children
        )}
      </Suspense>
    </RenderErrorBoundary>
  );
}
