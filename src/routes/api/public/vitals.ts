// Core Web Vitals (RUM) ingest endpoint. The client beacons metrics here via
// navigator.sendBeacon (see src/lib/webVitals.ts) when no external observability
// endpoint is configured. Fire-and-forget: every path returns 204 and ingest
// errors are swallowed, so a missing table / cold service role never surfaces to
// the beacon. Stored server-side via the admin client (RLS denies other roles).
//
// TWO WIRE SHAPES, both permanent. The current client batches and posts
// `{metrics:[...]}`; a page cached before that change posts a single
// `{name,value,...}` object and may keep doing so for as long as it stays open.
// `incomingMetrics` normalizes both to a list, so neither is ever dropped.
//
// KONTEKST NAWIGACJI (od 2026-09-20). Każda próbka może nieść pięć pól
// opisowych - `sinceNav`, `navigationType`, `deviceMemory`, `effectiveType`,
// `coldStart` - i to NIE jest zmiana obowiązkowa: strona zbuforowana przed nią
// nadal wysyła próbkę bez nich, a wtedy kolumny zostają `NULL`. Walidacja jest
// per pole i „miękka": pole poza zakresem albo poza listą dozwolonych staje
// się `null`, a próbka mimo to zostaje zapisana - kontekst jest dodatkiem do
// pomiaru, więc jego odrzucenie nie może kosztować samej metryki.
//
// WIERSZ JEST TYPOWANY WPROST `TablesInsert<"web_vitals">` (od 2026-09-21).
// Do czasu regeneracji `src/integrations/supabase/types.ts` stało tu przecięcie
// `TablesInsert<"web_vitals"> & { since_nav_ms?…, cold_start?… }` plus zmienna
// podstawiająca ładunek pod szerszy typ tuż przed `insert()`: migracja
// 20260920121000 wyprzedziła generator, który wymaga dostępu do projektu
// Supabase. Typy są przegenerowane i WSZYSTKIE PIĘĆ kolumn w nich jest, więc
// oba obejścia przestały cokolwiek dokładać - zostawione, wyłączałyby dalej
// kontrolę kształtu wiersza (`RejectExcessProperties` w supabase-js) na
// ścieżce zapisu dostępnej publicznie bez sesji. To ten sam dług, którego
// pilnują `check:db-row-casts` i `check:stale-never-casts`.
import { createFileRoute } from "@tanstack/react-router";
import { getRequest } from "@tanstack/react-start/server";
import { createRateLimiter, clientIpFromHeaders } from "@/lib/http/rateLimit";
import { resolveTenantIdForHost } from "@/lib/server/tenant.server";
import { currentTenantHost } from "@/lib/http/requestHost";
import { redactUrl } from "@/lib/observability/redact";
import type { TablesInsert } from "@/integrations/supabase/types";

const VALID_METRICS = new Set(["LCP", "CLS", "INP", "FCP", "TTFB", "FID"]);
// The client batches (src/lib/webVitals.ts): one request carries FCP+TTFB at
// init, then one request per flush boundary carries LCP+CLS+INP - so a page
// load costs 1-2 requests, not the ~6 the pre-batch client sent, and a real
// client needs ~1-4 req/min rather than ~6 per load. Burst 20 absorbs a
// 20-route click-spree; 0.2/s sustained (12 req/min) times MAX_METRICS caps a
// single spoofing source at ~96 rows/min, the same order as the 60 rows/min
// the old 60/1 bucket allowed - the budget is denominated in ROWS, because a
// request that used to insert 1 row can now insert 8.
const limiter = createRateLimiter({ capacity: 20, refillPerSec: 0.2 });
// The client can only ever produce 5 distinct metrics per boundary pair
// (FCP, TTFB, LCP, CLS, INP); 8 leaves headroom without widening the flood
// ceiling. Must stay >= the client's own MAX_METRICS.
const MAX_METRICS = 8;
// Worst case per sample on the wire is ~640 chars: a 512-char `url` plus
// name (15) + value (28) + rating (28) + id (24) + ts (18) + braces/commas (7).
// Kontekst nawigacji (`sinceNav` ~19, `navigationType` ~32, `deviceMemory` ~18,
// `effectiveType` ~26, `coldStart` ~19) dokłada do tego ~114 znaków, czyli
// ~754 na próbkę. Osiem takich plus opakowanie {"metrics":[...]} to ~6 050
// znaków - nadal Z ZAPASEM poniżej 8 000, więc ta granica NIE JEST rozluźniana
// razem z rozszerzeniem ładunku (byłby to cichy upust w budżecie pamięci
// workera przy okazji zmiany o czym innym).
const MAX_BODY = 8_000;

// ---------------------------------------------------------------------------
// KONTEKST NAWIGACJI (audyt CWV 2026-09-20, F40 / wiersz 0.3 „Fali 0").
//
// Pięć pól OPISOWYCH, żeby dało się odciąć populację zimnego pierwszego
// wejścia od miękkich nawigacji w tej samej odsłonie. ZERO identyfikatorów -
// szerzej w `src/lib/webVitals.ts` przy `VitalsNavigationContext`.
//
// DLACZEGO LISTA DOZWOLONYCH, A NIE `String(...)`. To jest publiczna,
// niepodpisana ścieżka zapisu: `navigation_type` bez listy przyjąłby dowolny
// napis, a wtedy kolumna przeznaczona na cztery wartości stałaby się polem
// tekstowym pod kontrolą kogokolwiek z curl-em, a `GROUP BY navigation_type`
// na panelu - listą tego, co ktoś wstrzyknął. To ta sama klasa decyzji co
// `VALID_METRICS` wyżej: enum waliduje się PRZYNALEŻNOŚCIĄ, nie długością.
const NAVIGATION_TYPES = new Set(["navigate", "reload", "back_forward", "prerender"]);
const EFFECTIVE_TYPES = new Set(["slow-2g", "2g", "3g", "4g"]);
/** Progi z klienta (kubełkowanie w dół do 1/2/4/8) - inne wartości odpadają. */
const DEVICE_MEMORY_BUCKETS = new Set([1, 2, 4, 8]);
/**
 * Górna granica `sinceNav`: doba. Pole liczy czas od startu nawigacji, więc
 * karta zostawiona na noc potrafi legalnie zgłosić kilkanaście godzin - ale
 * wartość spoza doby albo pochodzi z podrobionego beacona, albo z zegara,
 * któremu i tak nie można ufać. Odrzucamy ją do `null` (a nie całą próbkę):
 * sam pomiar LCP/CLS/INP pozostaje użyteczny bez kontekstu.
 */
const MAX_SINCE_NAV_MS = 24 * 60 * 60 * 1_000;

interface IncomingVital {
  name?: unknown;
  value?: unknown;
  rating?: unknown;
  url?: unknown;
  sinceNav?: unknown;
  navigationType?: unknown;
  deviceMemory?: unknown;
  effectiveType?: unknown;
  coldStart?: unknown;
}

/**
 * Ten sam wiersz BEZ kolumn kontekstu - ładunek awaryjnego ponowienia, gdy
 * migracja jeszcze nie dojechała. Składany jawnie, polem po polu, z tego
 * samego powodu co wiersz główny: `delete` na kopii albo `rest` ze spreadu
 * przepuściłyby każdą kolumnę, która w międzyczasie do niego trafi.
 */
function withoutNavigationContext(row: TablesInsert<"web_vitals">): TablesInsert<"web_vitals"> {
  const base: TablesInsert<"web_vitals"> = {
    metric: row.metric,
    value: row.value,
    rating: row.rating,
    path: row.path,
  };
  if (row.tenant_id !== undefined) base.tenant_id = row.tenant_id;
  return base;
}

/**
 * Normalize both wire shapes to a list. BACKWARD COMPATIBILITY IS NOT
 * OPTIONAL: a page cached before the batching change - or one still open in a
 * background tab - beacons a single `{name,value,rating,id,url,ts}` object on
 * pagehide, possibly for days. That object is treated as a batch of one. The
 * current client sends `{metrics:[...]}`; a bare top-level array is accepted
 * too so a future transport change cannot silently drop data.
 */
function incomingMetrics(parsed: unknown): IncomingVital[] {
  if (Array.isArray(parsed)) return parsed as IncomingVital[];
  if (!parsed || typeof parsed !== "object") return [];
  const wrapped = (parsed as { metrics?: unknown }).metrics;
  if (Array.isArray(wrapped)) return wrapped as IncomingVital[];
  return [parsed as IncomingVital];
}

/**
 * Wartość metryki, albo `null` gdy próbka jest bezużyteczna.
 *
 * DLACZEGO NIE `Number(v)`. Tak było i tak przechodziło CISCHĄ ŚMIECIÓWKĘ:
 * `Number(null)`, `Number("")`, `Number(false)` i `Number([])` to ZERO, czyli
 * skończona liczba - więc beacon z `value: null` zapisywał LCP równe 0 ms z
 * oceną „good". Kilkanaście takich wierszy realnie POPRAWIA p75 na panelu, bo
 * percentyl liczony jest po surowych wierszach (`aggregate.ts`). Zero jest
 * przy tym LEGALNĄ wartością CLS (strona bez przesunięć), więc nie da się go
 * odsiać progiem - trzeba odróżnić „zmierzone zero" od „brak pomiaru", a to
 * robi się na TYPIE, nie na wartości.
 *
 * Napis jest przyjmowany świadomie: `JSON.stringify` klienta zawsze da liczbę,
 * ale zewnętrzny kolektor (`VITE_OBSERVABILITY_ENDPOINT` wskazujący tunel)
 * bywa źródłem liczb w cudzysłowie. Pusty i biały napis - nie.
 *
 * Wartość ujemna jest odrzucana: żadna z sześciu metryk nie może być mniejsza
 * od zera, a jedna ujemna próbka ciągnie p75 w dół.
 */
function metricValue(raw: unknown): number | null {
  const n =
    typeof raw === "number"
      ? raw
      : typeof raw === "string" && raw.trim() !== ""
        ? Number(raw)
        : Number.NaN;
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * `sinceNav` w milisekundach albo `null`.
 *
 * Ta sama zasada co w `metricValue`: `Number(null)` i `Number("")` to ZERO,
 * więc bez kontroli TYPU beacon z `sinceNav: null` zapisałby „zgłoszone
 * w chwili startu nawigacji" - a to najmocniejszy możliwy sygnał zimnego
 * wejścia, czyli dokładnie ta wartość, którą warto podrobić, żeby przesunąć
 * statystyki. Zaokrąglamy do pełnych ms: kolumna jest całkowita, a ułamek
 * mikrosekundy i tak nie niesie informacji.
 */
function sinceNavMs(raw: unknown): number | null {
  const n =
    typeof raw === "number"
      ? raw
      : typeof raw === "string" && raw.trim() !== ""
        ? Number(raw)
        : Number.NaN;
  if (!Number.isFinite(n) || n < 0 || n > MAX_SINCE_NAV_MS) return null;
  return Math.round(n);
}

/** Wartość z listy dozwolonych albo `null` - bez obcinania, bez normalizacji. */
function enumValue(raw: unknown, allowed: ReadonlySet<string>): string | null {
  return typeof raw === "string" && allowed.has(raw) ? raw : null;
}

/** Próg pamięci urządzenia: dokładnie 1, 2, 4 albo 8; wszystko inne -> `null`. */
function deviceMemoryBucket(raw: unknown): number | null {
  const n = typeof raw === "number" ? raw : Number.NaN;
  return DEVICE_MEMORY_BUCKETS.has(n) ? n : null;
}

/**
 * `coldStart` jako boolean albo `null`.
 *
 * ZNACZENIE PO STRONIE KLIENTA: `true` niosą próbki PIERWSZEJ trasy dokumentu
 * otwartego na zimno. Klient gasi flagę przy pierwszej miękkiej nawigacji
 * (`markWebVitalsPage` w `src/lib/webVitals.ts`), więc druga i każda kolejna
 * trasa SPA tego samego dokumentu przychodzi z `false` - `WHERE cold_start`
 * odcina zimne pierwsze otwarcia, a nie całe odsłony.
 *
 * ŚCIŚLE `typeof === "boolean"`, bez `Boolean(raw)`: `Boolean("false")` to
 * `true`, a `Boolean(0)` to `false`, więc konwersja zamieniłaby każde śmieci
 * na jedną z dwóch prawdziwie wyglądających odpowiedzi. „Nie wiem" (null)
 * jest tu informacją, a nie brakiem informacji.
 */
function coldStartFlag(raw: unknown): boolean | null {
  return typeof raw === "boolean" ? raw : null;
}

function noContent(): Response {
  return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}

export const Route = createFileRoute("/api/public/vitals")({
  server: {
    handlers: {
      POST: async () => {
        try {
          const req = getRequest();
          if (!limiter.check(clientIpFromHeaders(req.headers), Date.now())) return noContent();
          // sendBeacon sends a JSON string (content-type text/plain), so read raw.
          const raw = await req.text();
          if (!raw || raw.length > MAX_BODY) return noContent();
          const parsed: unknown = JSON.parse(raw);
          const incoming = incomingMetrics(parsed).slice(0, MAX_METRICS);
          if (incoming.length === 0) return noContent();

          // TYPOWANY WIERSZ, BEZ `as never`. Stało tu rzutowanie z komentarzem
          // „tabela z migracji, której nie ma jeszcze w wygenerowanych typach" -
          // i to przestało być prawdą: `web_vitals` JEST w
          // `src/integrations/supabase/types.ts` (migracja 20260626210000,
          // zakres tenanta 20260708150000). Zostawianie rzutowania po
          // regeneracji typów to dokładnie ten dług, którego pilnują
          // `check:stale-never-casts` i `check:db-row-casts` - i który tutaj
          // wyłączał kontrolę kształtu wiersza na ścieżce zapisu dostępnej
          // publicznie bez sesji.
          const rows: TablesInsert<"web_vitals">[] = [];
          for (const sample of incoming) {
            const metric = String(sample?.name ?? "");
            const value = metricValue(sample?.value);
            // `continue`, not `return`: one malformed sample must not discard
            // the four good ones sharing its beacon. Validating per row is what
            // keeps batching from turning a partial payload into total loss.
            if (!VALID_METRICS.has(metric) || value === null) continue;
            // NIEZNANE POLA ODPADAJĄ Z KONSTRUKCJI. Wiersz jest SKŁADANY pole po
            // polu z jawnej listy - nie ma tu `...sample` ani pętli po kluczach,
            // więc cokolwiek dorzuci nadawca (`evil`, `tenant_id`, `id`,
            // `created_at`) nie ma jak dojechać do `insert`. To świadomie
            // wybrana biała lista: czarna musiałaby nadążać za każdą nową
            // kolumną tabeli, a ta ścieżka zapisu jest publiczna i niepodpisana.
            rows.push({
              metric,
              value,
              rating: typeof sample.rating === "string" ? sample.rating.slice(0, 32) : null,
              // Strip query strings (may carry tokens/emails) before persisting.
              path: redactUrl(typeof sample.url === "string" ? sample.url.slice(0, 512) : null),
              since_nav_ms: sinceNavMs(sample.sinceNav),
              navigation_type: enumValue(sample.navigationType, NAVIGATION_TYPES),
              device_memory: deviceMemoryBucket(sample.deviceMemory),
              effective_type: enumValue(sample.effectiveType, EFFECTIVE_TYPES),
              cold_start: coldStartFlag(sample.coldStart),
            });
          }
          // Validate BEFORE resolving the tenant: an all-junk batch must not
          // cost a directory lookup.
          if (rows.length === 0) return noContent();

          // Attribute the samples to the browsed host's tenant so per-tenant RUM
          // stays isolated. The service-role client sends no x-tenant-host, so
          // the column default (public_tenant_id() -> default tenant) can't infer
          // it; resolve it here - ONCE per batch, not once per sample.
          // Best-effort: on failure the rows still land under the default tenant
          // via the column default rather than being dropped.
          let resolved: string | null = null;
          try {
            resolved = await resolveTenantIdForHost(await currentTenantHost());
          } catch {
            // keep it null -> column default applies
          }
          const tenantId = resolved;
          // Adnotacja, a nie inferencja: bez niej typem jest UNIA dwóch tablic
          // (z `tenant_id` i bez), a `.map()` po unii tablic nie jest w TS
          // wywoływalne - awaryjne ponowienie niżej przestałoby się kompilować.
          const payload: TablesInsert<"web_vitals">[] = tenantId
            ? rows.map((row) => ({ ...row, tenant_id: tenantId }))
            : rows;

          // ONE multi-row insert for the whole batch (symmetric to
          // /api/public/track), replacing one round-trip per metric.
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          // Ładunek idzie do `insert()` WPROST - bez pośredniej zmiennej
          // podstawiającej go pod szerszy typ (uzasadnienie w nagłówku pliku).
          const { error } = await supabaseAdmin.from("web_vitals").insert(payload);
          // AWARYJNY ZAPIS BEZ KONTEKSTU - okno między wdrożeniem kodu
          // a migracją. `check:migration-ledger` jest bramką POWDROŻENIOWĄ,
          // więc kolejność „kod przed migracją" jest w tym repo realna, a
          // ingest połyka błędy (patrz `catch` niżej). Bez tej gałęzi jedna
          // brakująca kolumna kasowałaby CAŁY RUM w ciszy: każdy beacon
          // dostawałby 204, a w bazie nie lądowałby ani jeden wiersz - awaria
          // bez jednego nieudanego żądania, po której nikt nie pozna, że
          // panel wydajności zamarł. Ponawiamy WYŁĄCZNIE na „nie ma takiej
          // kolumny" (PostgREST `PGRST204`, Postgres `42703`), żeby zwykły
          // błąd sieci nie kosztował drugiego round-tripu.
          if (error && (error.code === "PGRST204" || error.code === "42703")) {
            await supabaseAdmin.from("web_vitals").insert(payload.map(withoutNavigationContext));
          }
        } catch {
          // Ingest is best-effort - never error the beacon.
        }
        return noContent();
      },
    },
  },
});
