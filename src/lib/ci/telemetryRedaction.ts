/**
 * Bramka: każda publiczna ścieżka ZAPISU telemetrii redaguje to, co zapisuje.
 *
 * PRZYCZYNA ŹRÓDŁOWA, której pilnuje: `/api/public/track` importował przez
 * miesiące POŁOWĘ zestawu redaktorów - `redactUrl` na `path` i `referrer`, nic
 * na `entity_id` i `meta`. Do `entity_id` wpada fraza z wyszukiwarki
 * wewnętrznej, wpisana z klawiatury, w wierszu obok niewygasającego `anon_id`.
 * Częściowy import wygląda dokładnie jak pełny: `tsc`, eslint i review
 * przechodzą po nim bez drgnienia. Rozjazd czterech bliźniaczych endpointów na
 * tej samej trasie publicznej mógł zobaczyć tylko ktoś, kto czyta je WSZYSTKIE
 * naraz wobec jednego rejestru - a nikt tego nie robił.
 *
 * Skaner jest znakowy (`stripTsComments`), więc ZAKOMENTOWANY redaktor NIE
 * spełnia kontraktu - inaczej bramkę dałoby się uciszyć dokładnie tym, czego ma
 * pilnować. Rejestr jest ręczny jak `EDITOR_AUTOSAVE_SURFACES`: nowy endpoint
 * ingestu dopisuje się tu DECYZJĄ, nie zgadywaniem po nazwie pliku.
 *
 * Czego bramka ŚWIADOMIE nie robi: nie dowodzi, że redagowana jest każda
 * zapisywana kolumna. To wymagałoby analizy przepływu i wciągnęłoby w sieć
 * `event_name`, który ZOSTAJE SUROWY - jest kluczem grupowania każdego raportu,
 * a `redactPii` zlewa ciągi od 40 znaków w „[redacted]".
 *
 * Moduł jest CZYSTY (bez I/O) - pliki wczytuje test bramki.
 */
import { stripTsComments } from "../../../scripts/lib/stripComments";

export type Redactor = "redactPii" | "redactUrl" | "redactMeta";

/** Kolumna zapisywana przez endpoint + redaktor, przez który MUSI przejść. */
export interface TelemetryColumn {
  readonly column: string;
  readonly redactor: Redactor;
  /** Po co akurat ta kolumna - trafia do czerwonego logu, nie do dokumentacji. */
  readonly why: string;
}

export interface TelemetrySink {
  /** Ścieżka względem korzenia repo - trafia do komunikatu bramki. */
  readonly file: string;
  /** Nazwa dla ludzi, żeby czerwony log dało się czytać. */
  readonly label: string;
  readonly columns: readonly TelemetryColumn[];
}

export interface TelemetrySinkSource extends TelemetrySink {
  readonly source: string;
}

/**
 * REJESTR publicznych ścieżek ingestu. Wszystkie piszą klientem service_role
 * (z pominięciem RLS) z trasy bez sesji i bez podpisu, więc treść, która do
 * nich dociera, pochodzi od dowolnego klienta świata.
 */
export const PUBLIC_TELEMETRY_SINKS: readonly TelemetrySink[] = [
  {
    file: "src/routes/api/public/track.ts",
    label: "ingest zdarzeń analitycznych",
    columns: [
      {
        column: "entity_id",
        redactor: "redactPii",
        why: "fraza z wyszukiwarki wewnętrznej - jedyne pole wypełniane z klawiatury odwiedzającego",
      },
      {
        column: "meta",
        redactor: "redactMeta",
        why: "kontekst zdarzenia: href stopki, notatki, cokolwiek wsadzi tam klient",
      },
      { column: "path", redactor: "redactUrl", why: "query string bywa nośnikiem tokenu" },
      { column: "referrer", redactor: "redactUrl", why: "referrer niesie cudzy query string" },
    ],
  },
  {
    file: "src/routes/api/public/client-errors.ts",
    label: "ingest błędów klienta",
    columns: [
      {
        column: "message",
        redactor: "redactPii",
        why: "komunikat walidacji cytuje wpisany adres e-mail",
      },
      { column: "stack", redactor: "redactPii", why: "ślad stosu niesie adresy i tokeny z URL-i" },
      { column: "path", redactor: "redactUrl", why: "query string bywa nośnikiem tokenu" },
      { column: "meta", redactor: "redactMeta", why: "kontekst granicy błędu jest strukturą" },
    ],
  },
  {
    file: "src/routes/api/public/vitals.ts",
    label: "ingest Web Vitals",
    columns: [
      { column: "path", redactor: "redactUrl", why: "adres próbki RUM z pełnym query stringiem" },
    ],
  },
  {
    file: "src/routes/api/public/ad-event.ts",
    label: "ingest zdarzeń reklamowych",
    columns: [{ column: "path", redactor: "redactUrl", why: "adres odsłony kreacji" }],
  },
  {
    file: "src/routes/api/public/experiment-event.ts",
    label: "ingest zdarzeń testów A/B",
    columns: [
      {
        column: "path",
        redactor: "redactUrl",
        why: "schemat przyjmuje z.string().max(2000) od dowolnego klienta",
      },
    ],
  },
] as const;

export interface RedactionViolation {
  file: string;
  label: string;
  column: string;
  redactor: Redactor;
  why: string;
  /** Redaktor JEST w pliku, ale wyłącznie w komentarzu - najczystszy objaw. */
  commentedOutOnly: boolean;
}

/**
 * Wzorzec wpięcia redaktora w kolumnę.
 *
 * Alternatywa `[:=]` jest NOŚNA: track.ts i vitals.ts piszą pole wprost
 * w literale wiersza (`path: redactUrl(`), a client-errors.ts wiąże najpierw
 * zmienną lokalną (`const path = redactUrl(`, `meta = redactMeta(`). Jeden
 * wzorzec musi pokryć oba kształty - inaczej bramka świeci na zielono na
 * połowie endpointów z niewłaściwego powodu.
 */
export function redactorWiringPattern(column: string, redactor: Redactor): RegExp {
  return new RegExp(`\\b${column}\\s*[:=]\\s*${redactor}\\s*\\(`);
}

/** Wpięcie w ŻYWYM kodzie - komentarz się nie liczy. */
export function isColumnRedacted(source: string, column: string, redactor: Redactor): boolean {
  return redactorWiringPattern(column, redactor).test(stripTsComments(source));
}

export function scanTelemetryRedaction(
  files: readonly TelemetrySinkSource[],
): RedactionViolation[] {
  const violations: RedactionViolation[] = [];
  for (const { file, label, columns, source } of files) {
    for (const { column, redactor, why } of columns) {
      if (isColumnRedacted(source, column, redactor)) continue;
      violations.push({
        file,
        label,
        column,
        redactor,
        why,
        commentedOutOnly: redactorWiringPattern(column, redactor).test(source),
      });
    }
  }
  return violations.sort(
    (a, b) => a.file.localeCompare(b.file) || a.column.localeCompare(b.column),
  );
}

const REDACT_MODULE = "src/lib/observability/redact.ts";

export function renderTelemetryRedactionReport(
  violations: readonly RedactionViolation[],
  scannedColumns: number,
  scannedSinks: number,
): string {
  if (violations.length === 0) {
    return `✓ Bramka redakcji telemetrii OK (${scannedColumns} kolumn w ${scannedSinks} ścieżkach ingestu).`;
  }
  const lines = violations.map((v) => {
    const remedy = v.commentedOutOnly
      ? `${v.redactor}(…) jest TYLKO w komentarzu - wywołaj go naprawdę`
      : `owiń wartość w ${v.redactor}(…) z ${REDACT_MODULE}`;
    return `  ✗ ${v.file}:${v.column} (${v.label}) - ${v.why}; ${remedy}`;
  });
  return [`✗ Redakcja telemetrii złamana w ${violations.length} miejscach:`, ...lines].join("\n");
}
