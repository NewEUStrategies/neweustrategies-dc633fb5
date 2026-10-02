// CO DOWODZI TEN PLIK: wiersze `SeoValidationSummary` w PRAWDZIWYM i18next.
//
// Siostrzany `SeoValidationSummary.test.tsx` jedzie na atrapie, która DOKLEJA
// każdy parametr do klucza - więc widzi, co komponent PRZEKAZAŁ, ale nie to,
// co redakcja PRZECZYTA. Prawdziwe i18next robi odwrotnie: parametr bez
// `{{miejsca}}` w wartości klucza jest po cichu wyrzucany. Dokładnie tak
// ginęła pozycja pustego nagłówka (komponent ją liczył, słownik jej nie
// miał). Tutaj mierzę napis końcowy:
//   1. uwaga o pustym nagłówku podaje pozycję i - przy kilku pustych -
//      liczbę we właściwej formie mnogiej, po polsku i po angielsku,
//   2. przeskok poziomu podaje pozycję i fragment tekstu (po naprawie
//      kontekstu renderowania to często skok od H1 UKŁADU, którego redaktor
//      nie widzi w treści - bez pozycji uwaga byłaby nie do znalezienia),
//   3. stan "nie sprawdzono" ma realny napis z nazwanymi językami,
//   4. kilka H1 (`multipleH1`) podaje pozycję i fragment DRUGIEGO H1 oraz
//      liczbę we właściwej formie ("2 nagłówki", nie "2 nagłówków").
//
// `react-i18next` ŚWIADOMIE NIE JEST ATRAPOWANY (fabryka z `reactI18nextMock`
// sięgnęłaby po `@/lib/i18n`, który importuje atrapowany moduł - plik
// zawiesiłby się bez komunikatu; pułapka opisana w `AdminDonations.test.tsx`).
// Komponent renderuje się w domyślnym polskim; angielskie brzmienie mierzę
// przez `realT("en")` z TYMI SAMYMI parametrami, które przekazuje komponent.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE: kluczy, rodzajów uwag i ról ARIA - to robi
// `SeoValidationSummary.test.tsx`; parytetu PL/EN - bramki
// `src/lib/ci/__tests__/i18nParity.test.ts` i `i18nKeyUsage.test.ts`.
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { realT } from "@/test/i18nReal";
import "@/lib/i18n-admin-extras";
import { SeoValidationSummary } from "@/components/admin/seo/SeoValidationSummary";
import type { HeadingIssue } from "@/lib/seo/headingValidation";

afterEach(cleanup);

function heading(kind: HeadingIssue["kind"], over: Partial<HeadingIssue> = {}): HeadingIssue {
  return { lang: "pl", kind, severity: "warning", ...over };
}

function rowText(issue: HeadingIssue): string {
  render(<SeoValidationSummary issues={[]} headingIssues={[issue]} />);
  return screen.getByRole("listitem").textContent ?? "";
}

describe("pusty nagłówek - pozycja i liczba w prawdziwym napisie", () => {
  it("PL: jeden pusty nagłówek - pozycja, bez liczby", () => {
    const text = rowText(heading("empty_heading", { count: 1, position: 4 }));
    expect(text).toBe(
      "PL - Struktura nagłówków: Pusty nagłówek w treści (#4) - usuń lub uzupełnij.",
    );
  });

  it.each([
    { count: 3, forma: "puste nagłówki" },
    { count: 5, forma: "pustych nagłówków" },
    { count: 22, forma: "puste nagłówki" },
  ])("PL: $count pustych - forma „$forma” i pozycja PIERWSZEGO", ({ count, forma }) => {
    const text = rowText(heading("empty_heading", { count, position: 2 }));
    expect(text).toBe(
      `PL - Struktura nagłówków: ${count} ${forma} w treści, pierwszy (#2) - usuń je lub uzupełnij.`,
    );
  });

  it("PL: brak dopisku w innym języku (negatywny - dawny ` (łącznie N)` nie wraca)", () => {
    const text = rowText(heading("empty_heading", { count: 3, position: 2 }));
    expect(text).not.toContain("łącznie");
    expect(text).not.toContain("{{");
  });

  it.each([
    { count: 1, oczekiwany: "Empty heading in content (#4) - delete or fill it in." },
    { count: 3, oczekiwany: "3 empty headings in content, first (#4) - delete or fill them in." },
  ])("EN: $count - te same parametry co komponent", ({ count, oczekiwany }) => {
    expect(realT("en")("admin.seo.validation.emptyHeading", { count, pos: " (#4)" })).toBe(
      oczekiwany,
    );
  });
});

describe("przeskok poziomu - pozycja i fragment", () => {
  it("PL: skok od H1 układu do H3 wskazuje nagłówek treści", () => {
    const text = rowText(
      heading("skipped_level", { from: 1, to: 3, position: 1, snippet: "Start" }),
    );
    expect(text).toBe(
      'PL - Struktura nagłówków: Przeskoczony poziom nagłówka: H1 → H3 (#1) - "Start". Zachowaj hierarchię H2 → H3 → H4.',
    );
  });

  it("EN: ta sama uwaga po angielsku", () => {
    expect(
      realT("en")("admin.seo.validation.skippedLevel", {
        from: 1,
        to: 3,
        pos: " (#1)",
        snip: ' - "Start"',
      }),
    ).toBe('Skipped heading level: H1 → H3 (#1) - "Start". Keep the hierarchy H2 → H3 → H4.');
  });
});

describe("kilka H1 - liczba, pozycja i fragment drugiego", () => {
  it.each([
    { count: 2, forma: "nagłówki" },
    { count: 5, forma: "nagłówków" },
  ])("PL: $count H1 - forma „$forma”, wskazany drugi H1", ({ count, forma }) => {
    const text = rowText(
      heading("multiple_h1", { severity: "error", count, position: 3, snippet: "Drugi" }),
    );
    expect(text).toBe(
      `PL - Struktura nagłówków: Znaleziono ${count} ${forma} H1 - powinien być tylko jeden; drugi (#3) - "Drugi".`,
    );
  });

  it("PL: bez pozycji i fragmentu nie zostaje żaden `{{` (negatywny)", () => {
    const text = rowText(heading("multiple_h1", { severity: "error", count: 2 }));
    expect(text).toBe(
      "PL - Struktura nagłówków: Znaleziono 2 nagłówki H1 - powinien być tylko jeden; drugi.",
    );
  });

  it("EN: te same parametry co komponent", () => {
    expect(
      realT("en")("admin.seo.validation.multipleH1", {
        count: 3,
        pos: " (#3)",
        snip: ' - "Second"',
      }),
    ).toBe('Found 3 H1 headings - there should be only one; second (#3) - "Second".');
  });
});

describe("stan „nie sprawdzono” - realny napis", () => {
  it("PL: nazwane języki i brak zielonego potwierdzenia jako jedynej treści", () => {
    render(
      <SeoValidationSummary issues={[]} headingIssues={[]} uncheckedHeadingLangs={["pl", "en"]} />,
    );
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Wszystkie pola mieszczą się w limitach Google.");
    expect(status).toHaveTextContent(
      "Struktury nagłówków nie sprawdzono (PL, EN) - w treści nie ma jeszcze żadnego nagłówka.",
    );
  });

  it("EN: ten sam stan po angielsku", () => {
    expect(realT("en")("admin.seo.validation.headingsUnchecked", { langs: "EN" })).toBe(
      "Heading structure not checked (EN) - the content has no headings yet.",
    );
  });
});
