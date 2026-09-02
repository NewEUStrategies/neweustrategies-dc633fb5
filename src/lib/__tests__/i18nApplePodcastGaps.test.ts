// CO DOWODZI TEN PLIK
//
// Domknięcie pętli między REGUŁĄ gotowości kanału Apple i SŁOWNIKIEM. Reguła
// (`@/lib/podcast/applePodcast`) nie zwraca zdań, tylko klucze i18n, a karta
// gotowości renderuje je bez zapasu (`t(gap.messageKey)`), więc klucz nieobecny
// w słowniku wychodzi na ekran redakcji jako
// „adminPodcasts.settings.apple.blocking.imageSquare".
//
// KONSEKWENCJA DEFEKTU jest podwójna: brak klucza zamienia komunikat o powodzie
// odrzucenia kanału w techniczny śmieć, a klucz w tylko JEDNYM języku robi to
// samo połowie panelu. Parytet PL/EN sam tego nie łapie, bo nie wie, których
// kluczy reguła w ogóle używa - dlatego lista kluczy jest tu WYLICZANA
// z reguły, a nie przepisana z ręki.
//
// Drugi kierunek tej samej pętli: żaden kod w gałęziach `blocking`/`warnings`
// nie może być martwy. Klucz, którego ani reguła, ani adapter starszej
// checklisty nie umieją wyemitować, to tłumaczenie utrzymywane bez powodu -
// i pierwszy kandydat na rozjazd, gdy kody się zmienią.
//
// CZEGO NIE DUBLUJE: parytetu całego bundla admina
// (`src/lib/__tests__/i18nAdminPodcasts.test.ts`) ani samej reguły
// (`src/lib/podcast/__tests__/applePodcast.test.ts`).
import { describe, expect, it } from "vitest";

import { adminPodcastsEn, adminPodcastsPl } from "@/lib/i18n-admin-podcasts";
import {
  applePodcastGaps,
  applePodcastGapsFromReadiness,
  type ApplePodcastChannelMeta,
} from "@/lib/podcast/applePodcast";

/** Kody starszej checklisty panelu - `src/lib/seo/podcastFeedReadiness.ts`. */
const LEGACY_BLOCKING = [
  "title",
  "description",
  "language",
  "image",
  "ownerEmail",
  "episodes",
] as const;
const LEGACY_WARNINGS = [
  "author",
  "ownerName",
  "copyright",
  "enclosureLength",
  "duration",
] as const;

/**
 * Wejścia pokrywające KAŻDĄ gałąź reguły. Nowe sprawdzenie bez wpisu tutaj
 * przejdzie ten plik, ale nie przejdzie testu reguły (tam liczy się pokrycie),
 * więc jedno z dwóch zapali się zawsze.
 */
const WEJSCIA: readonly ApplePodcastChannelMeta[] = [
  // Pusty kanał: tytuł, opis, język, brak kategorii, brak explicit, brak
  // okładki, brak e-maila, oba zalecenia.
  {},
  { category: "Polityka europejska" },
  { imageUrl: "http://cdn.example.org/okladka.jpg" },
  { imageUrl: "https://cdn.example.org/banner.jpg", imageWidth: 1600, imageHeight: 900 },
  { imageUrl: "https://cdn.example.org/male.jpg", imageWidth: 600, imageHeight: 600 },
  { ownerEmail: "redakcja@example" },
];

const KLUCZE_REGULY = [
  ...new Set(WEJSCIA.flatMap((wejscie) => applePodcastGaps(wejscie).map((g) => g.messageKey))),
].sort();

const KLUCZE_ADAPTERA = [
  ...new Set(
    applePodcastGapsFromReadiness({
      ready: false,
      blocking: [...LEGACY_BLOCKING],
      warnings: [...LEGACY_WARNINGS],
    }).map((g) => g.messageKey),
  ),
].sort();

const WSZYSTKIE = [...new Set([...KLUCZE_REGULY, ...KLUCZE_ADAPTERA])].sort();

type Tree = { readonly [key: string]: unknown };

/** Wartość spod klucza z kropkami - `null`, gdy ścieżka nie prowadzi do napisu. */
function wartosc(tree: Tree, key: string): string | null {
  const node = key.split(".").reduce<unknown>((acc, seg) => {
    return acc !== null && typeof acc === "object" ? (acc as Tree)[seg] : undefined;
  }, tree);
  return typeof node === "string" ? node : null;
}

const PL = adminPodcastsPl as unknown as Tree;
const EN = adminPodcastsEn as unknown as Tree;

/** Cała gałąź kodów (`apple.blocking` / `apple.warnings`) jednego języka. */
function galaz(tree: Tree, nazwa: "blocking" | "warnings"): Record<string, string> {
  const apple = ((tree.adminPodcasts as Tree).settings as Tree).apple as Tree;
  const node = apple[nazwa];
  if (node === null || typeof node !== "object") {
    throw new Error(`test: brak galezi apple.${nazwa} w slowniku`);
  }
  return node as Record<string, string>;
}

describe("reguła Apple a słownik - klucze, których używa reguła", () => {
  it("reguła w ogóle emituje klucze (bezpiecznik samego testu)", () => {
    // Gdyby lista wyszła pusta, wszystkie asercje niżej przechodziłyby
    // trywialnie - a to jest najgorszy możliwy stan tego pliku.
    expect(KLUCZE_REGULY.length).toBeGreaterThanOrEqual(12);
    expect(KLUCZE_ADAPTERA).toHaveLength(LEGACY_BLOCKING.length + LEGACY_WARNINGS.length);
  });

  it.each(WSZYSTKIE)("klucz %s ma tłumaczenie PL i EN", (key) => {
    const braki = (
      [
        ["pl", PL],
        ["en", EN],
      ] as const
    )
      .filter(([, tree]) => wartosc(tree, key) === null)
      .map(([jezyk]) => jezyk);
    // Nazwa brakującego języka musi być W KOMUNIKACIE: „klucz nie istnieje"
    // bez wskazania strony nie mówi, którą nakładkę uzupełnić.
    expect({ key, braki }).toEqual({ key, braki: [] });
  });

  it.each(WSZYSTKIE)("klucz %s nie jest puściutki ani nie nosi pauzy", (key) => {
    for (const [jezyk, tree] of [
      ["pl", PL],
      ["en", EN],
    ] as const) {
      const tekst = wartosc(tree, key) ?? "";
      expect({ jezyk, key, pusty: tekst.trim() === "" }).toEqual({ jezyk, key, pusty: false });
      // Dom stosuje dywiz, nie pauzę - patrz zasady słownikowe repo.
      expect({ jezyk, key, pauza: tekst.includes("—") }).toEqual({
        jezyk,
        key,
        pauza: false,
      });
    }
  });

  it("komunikaty braków są ZDANIAMI, a nie echem kodu", () => {
    // Klucz „imageSquare" z wartością „imageSquare" przechodziłby parytet
    // i wyglądałby na ekranie jak surowy kod - a to jest właśnie ten defekt,
    // przed którym ten plik ma chronić.
    for (const key of WSZYSTKIE) {
      const kod = key.split(".").at(-1) ?? "";
      for (const tree of [PL, EN]) {
        expect(wartosc(tree, key)).not.toBe(kod);
      }
    }
  });
});

describe("reguła Apple a słownik - martwe kody", () => {
  it.each(["blocking", "warnings"] as const)(
    "każdy kod w gałęzi %s da się wyemitować regułą albo adapterem",
    (nazwa) => {
      const emitowane = new Set(
        WSZYSTKIE.filter((key) => key.includes(`.apple.${nazwa}.`)).map((key) =>
          key.split(".").at(-1),
        ),
      );
      const martwe = Object.keys(galaz(PL, nazwa))
        .filter((kod) => !emitowane.has(kod))
        .sort();
      expect(martwe).toEqual([]);
    },
  );

  it.each(["blocking", "warnings"] as const)("gałąź %s ma identyczne kody w PL i EN", (nazwa) => {
    expect(Object.keys(galaz(PL, nazwa)).sort()).toEqual(Object.keys(galaz(EN, nazwa)).sort());
  });
});
