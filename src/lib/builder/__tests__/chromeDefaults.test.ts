// Domyślne dokumenty chrome'u (nagłówek / stopka / menu) i szablon strony
// głównej. Oba pliki startowały z 0% - a to one decydują, co redaktor widzi
// przy PIERWSZYM wejściu do buildera i co ląduje na świeżo postawionym tenancie.
//
// Testujemy trzy rzeczy, których złamanie widzi wyłącznie użytkownik:
//  1. dokument jest STRUKTURALNIE poprawny - `safeParseBuilderDoc` nie może mieć
//     nic do wyrzucenia (gdyby miał, część domyślnego chrome'u znikałaby cicho);
//  2. każdy użyty typ widgetu ISTNIEJE w rejestrze - literówka w typie daje
//     pustą sekcję zamiast nagłówka;
//  3. identyfikatory są DETERMINISTYCZNE - `newId()` pod spodem to
//     `crypto.randomUUID()`, więc bez normalizacji przez `withStableIds` SSR i
//     hydratacja dostałyby różne drzewa i React wyrzuciłby cały render.
import { describe, it, expect } from "vitest";
import { defaultDocFor } from "../chromeDefaults";
import { buildHomepageDocument } from "../homepageTemplate";
import { isKnownWidgetType, safeParseBuilderDoc, isBuilderDoc } from "../schema";
import type {
  BuilderDocument,
  SectionNode,
  ColumnNode,
  InnerSectionNode,
  WidgetNode,
} from "../types";

type AnyChild = ColumnNode | InnerSectionNode;

function columnsOf(child: AnyChild): ColumnNode[] {
  return child.kind === "inner-section" ? child.columns : [child];
}

function widgetsOf(doc: BuilderDocument): WidgetNode[] {
  return doc.sections.flatMap((s: SectionNode) =>
    (s.children ?? []).flatMap((c) =>
      columnsOf(c as AnyChild).flatMap((col) => col.children ?? []),
    ),
  );
}

function idsOf(doc: BuilderDocument): string[] {
  const out: string[] = [];
  for (const s of doc.sections) {
    out.push(s.id);
    for (const raw of s.children ?? []) {
      const c = raw as AnyChild;
      out.push(c.id);
      // Kolumnę liczymy RAZ: dla zwykłej kolumny `c` jest już tą kolumną,
      // a `columnsOf` zwraca ją ponownie (to opakowanie dla inner-section).
      const nested = c.kind === "inner-section" ? c.columns : [];
      for (const col of nested) {
        out.push(col.id);
        for (const w of col.children ?? []) out.push(w.id);
      }
      if (c.kind !== "inner-section") {
        for (const w of c.children ?? []) out.push(w.id);
      }
    }
  }
  return out;
}

const SCOPES = ["header", "footer", "menu"] as const;

describe("defaultDocFor - kontrakt dokumentu", () => {
  it.each(SCOPES)("%s: zwraca dokument w wersji 1 z niepustymi sekcjami", (scope) => {
    const doc = defaultDocFor(scope);
    expect(doc.version).toBe(1);
    expect(doc.sections.length).toBeGreaterThan(0);
  });

  it.each(SCOPES)("%s: przechodzi STRICT walidację `isBuilderDoc`", (scope) => {
    expect(isBuilderDoc(defaultDocFor(scope))).toBe(true);
  });

  it.each(SCOPES)("%s: `safeParseBuilderDoc` nie wyrzuca ANI JEDNEGO węzła", (scope) => {
    // Gdyby parser cokolwiek odrzucił, ta część domyślnego chrome'u nie
    // dojechałaby do renderera - i nikt by o tym nie wiedział.
    const doc = defaultDocFor(scope);
    const parsed = safeParseBuilderDoc(doc);
    expect(idsOf(parsed)).toEqual(idsOf(doc));
    expect(widgetsOf(parsed)).toHaveLength(widgetsOf(doc).length);
  });

  it.each(SCOPES)("%s: każdy widget ma ZNANY typ i obiektową treść", (scope) => {
    const widgets = widgetsOf(defaultDocFor(scope));
    expect(widgets.length).toBeGreaterThan(0);
    for (const w of widgets) {
      expect(isKnownWidgetType(w.type)).toBe(true);
      expect(w.kind).toBe("widget");
      expect(typeof w.content).toBe("object");
      expect(w.content).not.toBeNull();
    }
  });

  it.each(SCOPES)("%s: identyfikatory są unikalne", (scope) => {
    const ids = idsOf(defaultDocFor(scope));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it.each(SCOPES)("%s: identyfikatory są DETERMINISTYCZNE między wywołaniami", (scope) => {
    // Sedno kontraktu SSR: dwa wywołania muszą dać identyczne id, mimo że
    // fabryki węzłów pod spodem korzystają z `crypto.randomUUID()`.
    expect(idsOf(defaultDocFor(scope))).toEqual(idsOf(defaultDocFor(scope)));
  });

  it.each(SCOPES)("%s: identyfikatory noszą stabilny prefiks zakresu", (scope) => {
    // Prefiksy są skrócone w źródle (hdr/ftr/menu) - pilnujemy ich jawnie, bo
    // to one gwarantują, że nagłówek i stopka nie zderzą się identyfikatorami
    // po wstawieniu obu dokumentów w to samo drzewo edytora.
    const prefix = { header: "hdr-default", footer: "ftr-default", menu: "menu-default" }[scope];
    const ids = idsOf(defaultDocFor(scope));
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) expect(id.startsWith(prefix)).toBe(true);
  });

  it("nagłówek, stopka i menu nie dzielą ANI JEDNEGO identyfikatora", () => {
    const all = SCOPES.flatMap((s) => idsOf(defaultDocFor(s)));
    expect(new Set(all).size).toBe(all.length);
  });

  it("każdy zakres daje INNY dokument (żaden nie jest kopią drugiego)", () => {
    const [h, f, m] = SCOPES.map((s) => JSON.stringify(defaultDocFor(s)));
    expect(new Set([h, f, m]).size).toBe(3);
  });

  it("każda kolumna ma obiekt `span`, a każda sekcja tablicę dzieci", () => {
    for (const scope of SCOPES) {
      const doc = defaultDocFor(scope);
      for (const s of doc.sections) {
        expect(Array.isArray(s.children)).toBe(true);
        for (const c of s.children ?? []) {
          for (const col of columnsOf(c as AnyChild)) {
            expect(typeof col.span).toBe("object");
            expect(Array.isArray(col.children)).toBe(true);
          }
        }
      }
    }
  });

  it("mutacja zwróconego dokumentu nie truje kolejnego wywołania", () => {
    // Fabryka MUSI zwracać świeże drzewo - wspólna referencja oznaczałaby, że
    // edycja nagłówka jednego tenanta zmienia domyślny nagłówek następnego.
    const first = defaultDocFor("header");
    first.sections.length = 0;
    expect(defaultDocFor("header").sections.length).toBeGreaterThan(0);
  });
});

describe("buildHomepageDocument", () => {
  it("zwraca dokument w wersji 1 z ośmioma sekcjami", () => {
    const doc = buildHomepageDocument();
    expect(doc.version).toBe(1);
    expect(doc.sections).toHaveLength(8);
  });

  it("przechodzi STRICT walidację i nic nie gubi w parserze", () => {
    const doc = buildHomepageDocument();
    expect(isBuilderDoc(doc)).toBe(true);
    expect(idsOf(safeParseBuilderDoc(doc))).toEqual(idsOf(doc));
  });

  it("każdy widget szablonu ma znany typ", () => {
    const widgets = widgetsOf(buildHomepageDocument());
    expect(widgets.length).toBeGreaterThan(0);
    for (const w of widgets) expect(isKnownWidgetType(w.type)).toBe(true);
  });

  it("identyfikatory są unikalne w obrębie jednego dokumentu", () => {
    const a = idsOf(buildHomepageDocument());
    expect(new Set(a).size).toBe(a.length);
  });

  it("identyfikatory są LOSOWE przy każdym wywołaniu - i tak ma być", () => {
    // Świadoma różnica wobec `defaultDocFor`: szablon strony głównej NIE
    // przechodzi przez `withStableIds`, bo nie jest renderowany jako fallback.
    // Jego jedyny konsument to akcja `loadHomepage()` w edytorze
    // (useBuilderOperations.ts:89) - wstawia drzewo do historii, redaktor je
    // zapisuje i od tego momentu id żyją w bazie. `defaultDocFor` przeciwnie:
    // leci z `__root.tsx` i `Footer.tsx` na KAŻDYM renderze, po stronie serwera
    // i klienta, więc losowe id rozjechałyby hydratację. Ten test pilnuje, że
    // nikt nie „ujednolici" obu ścieżek bez zrozumienia tej różnicy.
    const a = idsOf(buildHomepageDocument());
    const b = idsOf(buildHomepageDocument());
    expect(a).toHaveLength(b.length);
    expect(a).not.toEqual(b);
  });

  it("struktura jest za to w pełni powtarzalna (kształt bez id)", () => {
    const shape = (d: ReturnType<typeof buildHomepageDocument>) =>
      JSON.stringify(d, (k, v) => (k === "id" ? "<id>" : v));
    expect(shape(buildHomepageDocument())).toBe(shape(buildHomepageDocument()));
  });

  it("zwraca świeże drzewo przy każdym wywołaniu", () => {
    const first = buildHomepageDocument();
    first.sections.length = 0;
    expect(buildHomepageDocument().sections).toHaveLength(8);
  });

  it("treści dwujęzyczne mają wersję PL i EN tam, gdzie mają klucz `_pl`", () => {
    // Bramki i18n repo wymagają obu wersji. Szablon strony głównej to treść
    // startowa - brak EN znaczy, że nowy tenant ma pustą stronę po angielsku.
    for (const w of widgetsOf(buildHomepageDocument())) {
      for (const key of Object.keys(w.content)) {
        if (!key.endsWith("_pl")) continue;
        const base = key.slice(0, -3);
        expect(Object.keys(w.content)).toContain(`${base}_en`);
      }
    }
  });
});
