import { describe, expect, it } from "vitest";
import {
  collectSection,
  isScannable,
  readGeneratedTypeNames,
  renderStaleNeverCastsReport,
  scanStaleNeverCasts,
  type GeneratedTypeNames,
} from "../staleNeverCasts";

/** Miniatura wygenerowanych typów - to samo wcięcie, które emituje generator. */
const TYPES = [
  "export type Database = {",
  "  public: {",
  "    Tables: {",
  "      web_vitals: {",
  "        Row: { id: string }",
  "      }",
  "      popup_events: {",
  "        Row: { id: string }",
  "      }",
  "    }",
  "    Views: {",
  "      crm_funnel_daily: {",
  "        Row: { day: string }",
  "      }",
  "    }",
  "    Functions: {",
  "      search_chat_contacts: {",
  "        Args: { p_query?: string }",
  "      }",
  "      chat_check_upload_quota: { Args: never; Returns: undefined }",
  "    }",
  "  }",
  "}",
].join("\n");

const known = readGeneratedTypeNames(TYPES);

describe("readGeneratedTypeNames", () => {
  it("zbiera relacje z Tables i Views do jednego zbioru", () => {
    expect(known.tables).toEqual(new Set(["web_vitals", "popup_events", "crm_funnel_daily"]));
  });

  it("zbiera funkcje niezależnie od tego, czy wpis jest jedno- czy wielolinijkowy", () => {
    expect(known.functions).toEqual(new Set(["search_chat_contacts", "chat_check_upload_quota"]));
  });

  it("zatrzymuje się na klamrze zamykającej sekcję (nie zjada następnej)", () => {
    expect(collectSection(TYPES, "Tables").has("search_chat_contacts")).toBe(false);
  });

  it("zwraca pusty zbiór dla sekcji, której nie ma", () => {
    expect(collectSection(TYPES, "CompositeTypes")).toEqual(new Set());
  });
});

describe("isScannable", () => {
  it("obejmuje pliki .ts i .tsx w src/", () => {
    expect(isScannable("src/lib/chat/useConversations.ts")).toBe(true);
    expect(isScannable("src/components/chat/NewChatSearch.tsx")).toBe(true);
  });

  it("pomija testy - `{children as never}` w mocku to nie dług typów bazy", () => {
    expect(isScannable("src/lib/ci/__tests__/staleNeverCasts.test.ts")).toBe(false);
    expect(isScannable("src/lib/chat/attachments.test.ts")).toBe(false);
  });

  it("pomija sam plik z wygenerowanymi typami i moduł tej bramki", () => {
    expect(isScannable("src/integrations/supabase/types.ts")).toBe(false);
    expect(isScannable("src/lib/ci/staleNeverCasts.ts")).toBe(false);
  });

  it("pomija pliki, które nie są TypeScriptem", () => {
    expect(isScannable("src/styles/app.css")).toBe(false);
  });
});

describe("scanStaleNeverCasts", () => {
  it("zgłasza cast na relację, która JEST w wygenerowanych typach", () => {
    const hits = scanStaleNeverCasts(
      [
        {
          file: "src/routes/api/public/vitals.ts",
          source: 'await supabaseAdmin.from("web_vitals" as never).insert(row);',
        },
      ],
      known,
    );
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ kind: "table", name: "web_vitals", line: 1 });
  });

  it("zgłasza cast na RPC, które JEST w wygenerowanych typach", () => {
    const hits = scanStaleNeverCasts(
      [{ file: "src/lib/chat/x.ts", source: 'supabase.rpc("search_chat_contacts" as never, a);' }],
      known,
    );
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ kind: "rpc", name: "search_chat_contacts" });
  });

  it("MILCZY na cascie w oknie przed regeneracją (nazwy nie ma w typach)", () => {
    const hits = scanStaleNeverCasts(
      [{ file: "src/lib/x.ts", source: 'supabase.from("brand_new_table" as never).select("*");' }],
      known,
    );
    expect(hits).toEqual([]);
  });

  it("milczy na cascie PAYLOADU - to osobna granica jsonb, nie dług typów", () => {
    const hits = scanStaleNeverCasts(
      [{ file: "src/lib/x.ts", source: '.upsert({ key: "header", value: merged as never });' }],
      known,
    );
    expect(hits).toEqual([]);
  });

  it("milczy na cascie poza klientem Supabase (router, CSS)", () => {
    const hits = scanStaleNeverCasts(
      [{ file: "src/lib/x.ts", source: "void router.navigate({ href } as never);" }],
      known,
    );
    expect(hits).toEqual([]);
  });

  it("podaje numer linii, nie tylko plik", () => {
    const hits = scanStaleNeverCasts(
      [
        {
          file: "src/routes/admin.popups.tsx",
          source: ["const a = 1;", "const b = 2;", '.from("popup_events" as never)'].join("\n"),
        },
      ],
      known,
    );
    expect(hits[0]?.line).toBe(3);
  });

  it("sortuje trafienia po pliku i linii - log jest stabilny między przebiegami", () => {
    const hits = scanStaleNeverCasts(
      [
        { file: "src/b.ts", source: '.from("web_vitals" as never)' },
        { file: "src/a.ts", source: '\n.from("popup_events" as never)' },
      ],
      known,
    );
    expect(hits.map((h) => `${h.file}:${h.line}`)).toEqual(["src/a.ts:2", "src/b.ts:1"]);
  });
});

describe("renderStaleNeverCastsReport", () => {
  const empty: GeneratedTypeNames = { tables: new Set(), functions: new Set() };

  it("zielony log podaje zasięg skanu", () => {
    const report = renderStaleNeverCastsReport([], 12, empty);
    expect(report).toContain("✓");
    expect(report).toContain("12 plików");
  });

  it("czerwony log podaje plik, linię i nazwę - da się z niego naprawić bez szukania", () => {
    const report = renderStaleNeverCastsReport(
      [
        {
          file: "src/routes/api/public/vitals.ts",
          line: 61,
          kind: "table",
          name: "web_vitals",
          snippet: 'from("web_vitals" as never)',
        },
      ],
      12,
      empty,
    );
    expect(report).toContain("✗");
    expect(report).toContain("src/routes/api/public/vitals.ts:61");
    expect(report).toContain("web_vitals");
  });
});
