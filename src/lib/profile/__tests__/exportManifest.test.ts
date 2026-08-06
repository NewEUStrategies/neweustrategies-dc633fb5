// Bramka zakresu eksportu RODO.
//
// Dwie rzeczy naraz:
//   1. testy jednostkowe czystego rejestru (grupy, unikalność, manifest, diff),
//   2. BRAMKA ANTY-REGRESYJNA: zbiór sekcji zbudowanych w server fn musi być
//      IDENTYCZNY z rejestrem. To ta asercja pilnuje findingu, przez który
//      eksport podpisywał się jako komplet, a pomijał cały czat, cały moduł
//      zapytań do ekspertów i komplet rozszerzeń profilu. Sekcja dopisana w
//      `export.functions.ts` bez wpisu w rejestrze (albo odwrotnie) wywala test.
//
// Bramka czyta ŹRÓDŁO server fn zamiast ją wykonywać: budowanie zapytań jest
// mocno typowane na klienta Supabase (bez `as any`, bez luźnych stringów), a
// wstrzyknięcie atrapy wymagałoby rozszczelnienia tych typów - czyli oddania
// dokładnie tej własności, której bramka ma pilnować.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  EXPORT_EXCLUSIONS,
  EXPORT_SECTION_GROUPS,
  EXPORT_SECTION_GROUP_OF,
  EXPORT_SECTION_IDS,
  PERSONAL_DATA_EXPORT_FORMAT,
  buildExportManifest,
  diffExportManifest,
  exportManifestMatches,
} from "../exportManifest";

const SERVER_FN = join(process.cwd(), "src/lib/profile/export.functions.ts");

/** Klucze najwyższego poziomu literału `sections` w server fn (wcięcie 6 spacji). */
function sectionKeysFromServerFn(): string[] {
  const source = readFileSync(SERVER_FN, "utf8");
  const start = source.indexOf("const sections: Record<string, PromiseLike<SectionResult>> = {");
  expect(start, "literał `sections` musi istnieć w export.functions.ts").toBeGreaterThan(-1);
  const end = source.indexOf("\n    };", start);
  expect(end, "literał `sections` musi być domknięty").toBeGreaterThan(start);
  const block = source.slice(start, end);
  return [...block.matchAll(/^ {6}([a-z][a-z0-9_]*):/gm)].map((m) => m[1]);
}

describe("rejestr sekcji", () => {
  it("nie ma duplikatów identyfikatorów", () => {
    expect(new Set(EXPORT_SECTION_IDS).size).toBe(EXPORT_SECTION_IDS.length);
  });

  it("płaska lista jest sumą grup, w kolejności grup", () => {
    expect([...EXPORT_SECTION_IDS]).toEqual(Object.values(EXPORT_SECTION_GROUPS).flat());
  });

  it("każda sekcja ma przypisaną grupę", () => {
    for (const id of EXPORT_SECTION_IDS) {
      expect(EXPORT_SECTION_GROUP_OF[id]).toBeTruthy();
      expect(EXPORT_SECTION_GROUPS[EXPORT_SECTION_GROUP_OF[id]]).toContain(id);
    }
  });

  it("żadna grupa nie jest pusta", () => {
    for (const [group, ids] of Object.entries(EXPORT_SECTION_GROUPS)) {
      expect(ids.length, `grupa ${group}`).toBeGreaterThan(0);
    }
  });
});

describe("kompletność zakresu (finding 2026-08-06)", () => {
  // Dokładnie te obszary eksport pomijał, deklarując komplet. Lista jest
  // wypisana wprost, żeby ewentualne przyszłe „uproszczenie" rejestru nie
  // zabrało ich po cichu razem z resztą.
  const PREVIOUSLY_MISSING = [
    // czat
    "chat_conversations",
    "chat_participation",
    "chat_messages_sent",
    "chat_nicknames_set",
    "chat_blocks",
    // zapytania do ekspertów
    "expert_requests_sent",
    "expert_requests_received",
    // rozszerzenia profilu
    "author_profile",
    "profile_experiences",
    "profile_education",
    "profile_skills",
    "profile_awards",
    "profile_hobbies",
    "profile_cv_files",
    "media_mentions",
    // reputacja zawodowa i wyświetlenia profilu
    "recommendations_received",
    "recommendations_written",
    "skill_endorsements_given",
    "skill_endorsements_received",
    "profile_viewers",
    "profile_view_stats",
    "network_introductions",
  ] as const;

  it.each(PREVIOUSLY_MISSING)("zakres obejmuje sekcję %s", (id) => {
    expect(EXPORT_SECTION_IDS).toContain(id);
  });

  it("format nosi wersję v2 - zmiana zakresu jest zmianą kontraktu", () => {
    expect(PERSONAL_DATA_EXPORT_FORMAT).toBe("nes.personal-data-export.v2");
  });
});

describe("bramka: rejestr ⇄ server fn", () => {
  it("server fn buduje DOKŁADNIE zadeklarowane sekcje", () => {
    const built = sectionKeysFromServerFn();
    const diff = diffExportManifest(built);
    expect(diff.missing, "zadeklarowane, a nieobecne w export.functions.ts").toEqual([]);
    expect(diff.undeclared, "zbudowane, a niezadeklarowane w rejestrze").toEqual([]);
    expect(exportManifestMatches(built)).toBe(true);
  });

  it('server fn nie robi zrzutu schematu przez `select("*")` poza wierszem preferencji', () => {
    const source = readFileSync(SERVER_FN, "utf8");
    const wildcards = [...source.matchAll(/\.select\("\*"\)/g)];
    // notification_preferences to JEDEN wiersz per user o kontrolowanym kształcie
    // (katalog w src/lib/notifications/preferences.ts) - tam gwiazdka jest
    // celowa, żeby nowa preferencja nie wypadła z eksportu.
    expect(wildcards).toHaveLength(1);
  });
});

describe("wyłączenia", () => {
  it("mają unikalne identyfikatory i uzasadnienie w obu językach", () => {
    expect(new Set(EXPORT_EXCLUSIONS.map((e) => e.id)).size).toBe(EXPORT_EXCLUSIONS.length);
    for (const exclusion of EXPORT_EXCLUSIONS) {
      expect(exclusion.reason_pl.length, exclusion.id).toBeGreaterThan(40);
      expect(exclusion.reason_en.length, exclusion.id).toBeGreaterThan(40);
      expect(exclusion.reason_pl).not.toBe(exclusion.reason_en);
    }
  });

  it("nazywa wyłączenie cudzych wiadomości - inaczej pusty czat wygląda na komplet", () => {
    const ids = EXPORT_EXCLUSIONS.map((e) => e.id);
    expect(ids).toContain("messages_authored_by_others");
    expect(ids).toContain("attachment_binaries");
  });

  it("nie używa myślnika typograficznego w treści dla użytkownika", () => {
    for (const exclusion of EXPORT_EXCLUSIONS) {
      expect(exclusion.reason_pl).not.toContain("—");
      expect(exclusion.reason_en).not.toContain("—");
    }
  });
});

describe("buildExportManifest", () => {
  it("przepisuje pełny zakres, grupy i wyłączenia", () => {
    const manifest = buildExportManifest([]);
    expect(manifest.format).toBe(PERSONAL_DATA_EXPORT_FORMAT);
    expect(manifest.sections).toEqual(EXPORT_SECTION_IDS);
    expect(manifest.excluded).toEqual(EXPORT_EXCLUSIONS);
    expect(manifest.failed).toEqual([]);
  });

  it("wymienia sekcje, które w tym przebiegu poległy", () => {
    const manifest = buildExportManifest(["chat_messages_sent", "orders"]);
    expect(manifest.failed).toEqual(["chat_messages_sent", "orders"]);
  });

  it("ignoruje klucze spoza rejestru (błąd nie może wymyślić nowej sekcji)", () => {
    expect(buildExportManifest(["nie_ma_takiej"]).failed).toEqual([]);
  });

  it("zachowuje kolejność rejestru niezależnie od kolejności błędów", () => {
    const manifest = buildExportManifest(["orders", "profile"]);
    expect(manifest.failed).toEqual(["profile", "orders"]);
  });
});

describe("diffExportManifest", () => {
  it("wskazuje brak i nadmiar osobno", () => {
    const diff = diffExportManifest([...EXPORT_SECTION_IDS.slice(1), "cos_nowego"]);
    expect(diff.missing).toEqual([EXPORT_SECTION_IDS[0]]);
    expect(diff.undeclared).toEqual(["cos_nowego"]);
    expect(exportManifestMatches([...EXPORT_SECTION_IDS.slice(1)])).toBe(false);
  });

  it("uznaje zgodność niezależnie od kolejności", () => {
    expect(exportManifestMatches([...EXPORT_SECTION_IDS].reverse())).toBe(true);
  });
});
