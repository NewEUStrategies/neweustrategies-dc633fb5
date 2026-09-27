// Bramka PRZYCZYNY (nie skutku) dla wagi stron wydarzenia i chunku wejściowego:
// pliki jadące na ścieżce, którą płaci KAŻDY czytelnik, nie importują
// statycznie modułów potrzebnych garstce osób albo dopiero po kliknięciu.
//
// CO KONKRETNIE PSUJE SIĘ BEZ TYCH TESTÓW (zmierzone 2026-09-27, kronika
// `scripts/check-bundle-size.ts`, wpis XIX):
//   * pasek zakładek powłoki `/events/<slug>` importował słownik naboru
//     prelegentów (`i18n-event-cfp`, 10,7 KB gzip) i `useCfpMe` z parserami
//     całej powierzchni naboru - dla jednego napisu i jednej fazy. Każda
//     strona wydarzenia płaciła ~11 KB więcej;
//   * `validateSearch` tras `/scanner` i `/admin/events/<id>/sponsor-report`
//     należy do NIEDZIELONEJ części pliku trasy, więc import stamtąd wciąga
//     moduł do chunku WEJŚCIOWEGO: parser sesji skanera i słownik pomiaru
//     ekspozycji sponsorów jechały w bootcie każdej strony serwisu;
//   * wpis XX: `validateSearch` trasy `/admin/events/new` (klon edycji) brał
//     `parseCloneSearch` z reguł formularza klonu, a prefetch widgetu
//     prelegentów buildera brał parser ścieżek z reguł karty prelegenta - oba
//     moduły jechały całe w chunku wejściowym;
//     To samo w `/admin/events/list` (walidator adresu ciągnął argumenty RPC
//     listy i przez `isEventFormat` cały `eventTypes`) i w edytorze klubu
//     (`clubEditorTab` ciągnął wersję roboczą i payload zapisu);
//   * kroki płatności i zakupu pakietu (prośba o fakturę) ciągnęły parser
//     migawki dokumentu, a profil - generator PDF, choć oba są potrzebne
//     dopiero po kliknięciu „Pobierz".
// `check:bundle` widzi tylko SUMĘ (i to zaszumioną), a `check:entry-purity`
// tylko chunk wejściowy i listę ciężkich słowników. Nawrót którejkolwiek
// z tych krawędzi przeszedłby obie bramki po cichu.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/** Importy STATYCZNE wartości (bez `import type` i bez `import()`). */
function staticValueImports(source: string): string[] {
  const out: string[] = [];
  const re = /^import\s+(?!type\s)[^;]*?from\s+"([^"]+)";/gms;
  for (const match of source.matchAll(re)) out.push(match[1]);
  for (const match of source.matchAll(/^import\s+"([^"]+)";/gm)) out.push(match[1]);
  return out;
}

const CASES: ReadonlyArray<{ file: string; forbidden: readonly string[]; why: string }> = [
  {
    file: "src/components/events/public/organisms/EventTabsNav.tsx",
    forbidden: ["@/lib/i18n-event-cfp", "@/lib/events/useCfpMe", "@/lib/events/cfpPublicApi"],
    why: "pasek zakładek jest w chunku powłoki każdej strony wydarzenia",
  },
  {
    file: "src/components/events/cfp/molecules/EventCfpTabItem.tsx",
    forbidden: ["@/lib/i18n-event-cfp", "@/lib/events/useCfpMe", "@/lib/events/cfpPublicApi"],
    why: "pozycja paska potrzebuje jednego napisu (słownik frontu) i fazy (`useCfpShell`)",
  },
  {
    file: "src/components/events/cfp/molecules/EventMeCfpLinks.tsx",
    forbidden: ["@/lib/i18n-event-cfp", "@/lib/events/useCfpMe", "@/lib/events/cfpPublicApi"],
    why: "odnośniki zakładki „Moje” potrzebują czterech napisów i panelu z `useCfpShell`",
  },
  {
    file: "src/lib/events/useCfpShell.ts",
    forbidden: ["@/lib/events/cfpPublicApi", "@/lib/events/cfpSurface", "@/lib/i18n-event-cfp"],
    why: "fetcher panelu przychodzi `import()`-em, parsery naboru nie jadą w chrome'ie",
  },
  {
    file: "src/lib/events/cfpShellApi.ts",
    forbidden: ["@/lib/events/cfpSurface", "@/lib/events/cfpPublicApi"],
    why: "faza to jedno pole z RPC - bez parserów całej strony naboru",
  },
  {
    file: "src/routes/scanner.tsx",
    forbidden: ["@/lib/events/scannerSession", "@/lib/events/onsiteEnums"],
    why: "`validateSearch` jedzie w chunku wejściowym - tam wolno tylko `scannerToken`",
  },
  {
    file: "src/routes/admin.events_.$eventId.sponsor-report.tsx",
    forbidden: ["@/lib/events/sponsorExposure"],
    why: "`validateSearch` jedzie w chunku wejściowym - wzorzec uuid jest wpisany w trasę",
  },
  {
    file: "src/routes/admin.events_.new.tsx",
    forbidden: ["@/lib/events/eventCloneDraft"],
    why: "`validateSearch` jedzie w chunku wejściowym - `?from=` czyta `eventCloneSearch`",
  },
  {
    file: "src/lib/builder/speakersQuery.ts",
    forbidden: ["@/lib/events/speakerCard"],
    why: "prefetch buildera jest w chunku wejściowym - parser ścieżek jest w `speakerTracks`",
  },
  {
    file: "src/routes/admin.events.list.tsx",
    forbidden: ["@/lib/events/eventListParams", "@/lib/events/eventTypes"],
    why: "`validateSearch` jedzie w chunku wejściowym - adres listy czyta `eventListSearch`",
  },
  {
    file: "src/lib/events/eventListSearch.ts",
    forbidden: ["@/lib/events/eventTypes", "@/lib/events/eventListParams"],
    why: "walidator adresu z chunku wejściowego sprawdza format liściem `eventFormats`",
  },
  {
    file: "src/lib/events/myEventInvoicesApi.ts",
    forbidden: ["@/lib/events/eventInvoiceDocument"],
    why: "parser dokumentu jest potrzebny dopiero przy pobraniu PDF",
  },
  {
    file: "src/components/events/invoices/organisms/EventInvoicesProfileCard.tsx",
    forbidden: ["@/lib/events/eventInvoicePdfLabels", "@/lib/events/eventInvoicePdf"],
    why: "generator PDF ładuje się w chwili kliknięcia „Pobierz”",
  },
];

describe("lekka ścieżka stron wydarzenia i chunku wejściowego", () => {
  it.each(CASES)("$file", ({ file, forbidden, why }) => {
    const imports = staticValueImports(readFileSync(file, "utf8"));
    // Kontrola czułości: parser MUSI widzieć importy pliku, inaczej pusta
    // lista dawałaby zielone przejście niezależnie od treści.
    expect(imports.length, `${file}: parser nie znalazł żadnego importu`).toBeGreaterThan(0);
    for (const target of forbidden)
      expect(imports, `${file} -> ${target}: ${why}`).not.toContain(target);
  });

  it("trasa edytora klubu czyta `?tab=` z liścia, a nie z reguł edytora", () => {
    const source = readFileSync("src/routes/admin.community.clubs.$clubId.tsx", "utf8");
    expect(source).toMatch(
      /import \{[^}]*\bclubEditorTab\b[^}]*\} from "@\/lib\/clubs\/clubEditorTabs";/,
    );
    expect(source).not.toMatch(
      /import \{[^}]*\bclubEditorTab\b[^}]*\} from "@\/lib\/clubs\/adminClubEditor";/,
    );
  });

  it("parser rozróżnia import wartości, typu i dynamiczny", () => {
    const sample = [
      'import type { A } from "@/lib/typy";',
      'import { b, type C } from "@/lib/wartosci";',
      'import {\n  d,\n  e,\n} from "@/lib/wielowierszowy";',
      'import "@/lib/efekt";',
      'const f = () => import("@/lib/leniwy");',
    ].join("\n");
    expect(staticValueImports(sample)).toEqual([
      "@/lib/wartosci",
      "@/lib/wielowierszowy",
      "@/lib/efekt",
    ]);
  });
});
