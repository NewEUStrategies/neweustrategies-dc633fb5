// Test bramki redakcji telemetrii. Konwencja repo: inwariant CI ma test, bo
// inaczej skaner nie ma jak umrzeć na czerwono, gdy przestanie cokolwiek widzieć
// - a pusta bramka brzmi identycznie jak zielona. Druga połowa pliku uruchamia
// bramkę na PRAWDZIWYCH źródłach, bo to ona jest właściwym zabezpieczeniem.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  PUBLIC_TELEMETRY_SINKS,
  isColumnRedacted,
  redactorWiringPattern,
  renderTelemetryRedactionReport,
  scanTelemetryRedaction,
  type TelemetrySinkSource,
} from "@/lib/ci/telemetryRedaction";

/** Syntetyczny ujście o jednej wymaganej kolumnie. */
const sink = (source: string): TelemetrySinkSource[] => [
  {
    file: "src/routes/api/public/x.ts",
    label: "ingest testowy",
    columns: [{ column: "entity_id", redactor: "redactPii", why: "fraza z klawiatury" }],
    source,
  },
];

describe("isColumnRedacted - liczy się ŻYWE wywołanie, nie wzmianka", () => {
  it("widzi wpis wprost w polu wiersza (kształt z track.ts)", () => {
    expect(
      isColumnRedacted(
        "entity_id: redactPii(truncate(e.entity_id, 120)),",
        "entity_id",
        "redactPii",
      ),
    ).toBe(true);
  });

  it("widzi wiązanie zmiennej lokalnej (kształt z client-errors.ts)", () => {
    expect(
      isColumnRedacted("const path = redactUrl(clip(body.url, 512));", "path", "redactUrl"),
    ).toBe(true);
  });

  it("widzi przypisanie do wcześniej zadeklarowanej zmiennej", () => {
    expect(isColumnRedacted("meta = redactMeta(body.meta);", "meta", "redactMeta")).toBe(true);
  });

  it("NIE zalicza wywołania schowanego w komentarzu liniowym", () => {
    expect(isColumnRedacted("// entity_id: redactPii(x),", "entity_id", "redactPii")).toBe(false);
  });

  it("NIE zalicza wywołania schowanego w komentarzu blokowym", () => {
    expect(isColumnRedacted("/*\n entity_id: redactPii(x),\n*/", "entity_id", "redactPii")).toBe(
      false,
    );
  });

  it("NIE zalicza samego importu - pół zestawu redaktorów wygląda jak cały", () => {
    expect(
      isColumnRedacted(
        'import { redactPii } from "@/lib/observability/redact";',
        "entity_id",
        "redactPii",
      ),
    ).toBe(false);
  });

  it("NIE zalicza ZŁEGO redaktora - `redactUrl` na `entity_id` to regres, nie spójność", () => {
    // ZMIERZONE: redactUrl("cee") === "/cee", a redactUrl("polityka spójności")
    // === "/polityka%20sp%C3%B3jno%C5%9Bci". Ujednolicenie „jak w path" zamieni
    // klucz grupowania raportu na napis, którego nikt nie wpisał.
    expect(isColumnRedacted("entity_id: redactUrl(x),", "entity_id", "redactPii")).toBe(false);
  });

  it("wzorzec toleruje odstępy wokół dwukropka i nawiasu", () => {
    expect(redactorWiringPattern("meta", "redactMeta").test("meta :  redactMeta (m)")).toBe(true);
  });
});

describe("scanTelemetryRedaction", () => {
  it("brak wywołania to dokładnie jedno naruszenie", () => {
    expect(scanTelemetryRedaction(sink("entity_id: truncate(e.entity_id, 120),"))).toEqual([
      {
        file: "src/routes/api/public/x.ts",
        label: "ingest testowy",
        column: "entity_id",
        redactor: "redactPii",
        why: "fraza z klawiatury",
        commentedOutOnly: false,
      },
    ]);
  });

  it("wywołanie WYŁĄCZNIE w komentarzu jest osobno oznaczone", () => {
    const hits = scanTelemetryRedaction(sink("// entity_id: redactPii(x),\nconst a = 1;"));
    expect(hits[0]?.commentedOutOnly).toBe(true);
  });

  it("kompletne ujście milczy", () => {
    expect(scanTelemetryRedaction(sink("entity_id: redactPii(truncate(x, 120)),"))).toEqual([]);
  });

  it("sortuje po pliku i kolumnie - log jest stabilny między przebiegami", () => {
    const bare = "const rows = [];";
    const hits = scanTelemetryRedaction([
      {
        file: "src/b.ts",
        label: "b",
        columns: [{ column: "path", redactor: "redactUrl", why: "adres" }],
        source: bare,
      },
      {
        file: "src/a.ts",
        label: "a",
        columns: [
          { column: "meta", redactor: "redactMeta", why: "kontekst" },
          { column: "entity_id", redactor: "redactPii", why: "fraza" },
        ],
        source: bare,
      },
    ]);
    expect(hits.map((v) => `${v.file}:${v.column}`)).toEqual([
      "src/a.ts:entity_id",
      "src/a.ts:meta",
      "src/b.ts:path",
    ]);
  });
});

describe("renderTelemetryRedactionReport", () => {
  it("zielony log podaje zasięg skanu", () => {
    const report = renderTelemetryRedactionReport([], 11, 5);
    expect(report).toContain("✓");
    expect(report).toContain("11 kolumn");
    expect(report).toContain("5 ścieżkach");
  });

  it("czerwony log podaje plik z kolumną, powód i miejsce naprawy", () => {
    const report = renderTelemetryRedactionReport(
      scanTelemetryRedaction(sink("entity_id: truncate(e.entity_id, 120),")),
      1,
      1,
    );
    expect(report).toContain("x.ts:entity_id");
    expect(report).toContain("fraza z klawiatury");
    expect(report).toContain("src/lib/observability/redact.ts");
  });

  it("czerwony log odróżnia redaktor żyjący tylko w komentarzu", () => {
    const report = renderTelemetryRedactionReport(
      scanTelemetryRedaction(sink("// entity_id: redactPii(x),")),
      1,
      1,
    );
    expect(report).toContain("TYLKO w komentarzu");
  });
});

describe("bramka na PRAWDZIWYCH źródłach", () => {
  const sources: TelemetrySinkSource[] = PUBLIC_TELEMETRY_SINKS.map((s) => ({
    ...s,
    source: readFileSync(resolve(process.cwd(), s.file), "utf8"),
  }));
  const columns = sources.reduce((n, s) => n + s.columns.length, 0);

  it("rejestr wskazuje na istniejące pliki (bramka nie skanuje pustki)", () => {
    sources.forEach((s) => expect(s.source.length).toBeGreaterThan(0));
  });

  it("KANAREK ZASIĘGU: rejestr nie może się wyzerować po cichu", () => {
    // Pusty rejestr daje zielony przebieg identyczny z poprawnym - to najgorszy
    // tryb awarii bramki, więc podłoga jest przypięta liczbowo.
    expect(PUBLIC_TELEMETRY_SINKS.length).toBeGreaterThanOrEqual(5);
    expect(columns).toBeGreaterThanOrEqual(11);
  });

  it("każda publiczna ścieżka ingestu redaguje KAŻDĄ zarejestrowaną kolumnę", () => {
    const violations = scanTelemetryRedaction(sources);
    expect(renderTelemetryRedactionReport(violations, columns, sources.length)).toContain("✓");
    expect(violations).toEqual([]);
  });
});
