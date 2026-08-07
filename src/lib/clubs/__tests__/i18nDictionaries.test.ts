// Bramka: KAŻDY kod z domkniętego słownika modułu ma zdanie w PL i EN.
//
// Parytet PL/EN pilnuje bramka i18n, ale ona porównuje tylko dwa bundle ze
// sobą - klucz nieobecny w OBU przechodzi przez nią bez zająknięcia. A
// dokładnie to się zdarzyło: migracja A8 dorzuciła kod powodu `tier_unknown`,
// klient nie miał dla niego ani wpisu w słowniku, ani tłumaczenia, więc panel
// "Podgląd jako..." pokazywał "Brak przeszkód" tam, gdzie baza mówiła "nie
// umiem policzyć planu tej osoby".
//
// Ten test łączy oba końce: bierze słowniki z types.ts (te same, na które
// zawęża się odpowiedź RPC) i sprawdza, że bundle ma dla każdego kodu tekst.
// Nowy kod w migracji bez tłumaczenia = czerwone CI, a nie cicha nieprawda
// na ekranie.
import { describe, expect, it, vi } from "vitest";

// Instancja i18next jest tu zbędna: sprawdzamy LITERAŁY bundla, a nie
// zachowanie t(). Atrapa odcina też cały graf runtime'u lokalizacji
// (localeRuntime -> @tanstack/react-start), którego ten test nie dotyka,
// a który wciągałby serwerowe zależności do środowiska jsdom.
vi.mock("@/lib/i18n", () => ({
  default: { addResourceBundle: () => undefined },
}));

import { clubEn, clubPl } from "@/lib/i18n-club";
import {
  CLUB_ACCESS_REASONS,
  CLUB_MEMBER_ROLES,
  CLUB_MEMBER_STATUSES,
  CLUB_MODERATION_ACTIONS,
  CLUB_NOTIFY_LEVELS,
  CLUB_REACTION_KINDS,
  CLUB_THREAD_KINDS,
  CLUB_THREAD_STATUSES,
} from "../types";

type Tree = Record<string, unknown>;

function read(tree: Tree, path: string): unknown {
  let node: unknown = tree;
  for (const part of path.split(".")) {
    if (node === null || typeof node !== "object") return undefined;
    node = (node as Tree)[part];
  }
  return node;
}

/** Zwraca kody bez tekstu - pusta lista znaczy komplet. */
function missing(tree: Tree, prefix: string, codes: readonly string[]): string[] {
  return codes.filter((code) => {
    const value = read(tree, `${prefix}.${code}`);
    return typeof value !== "string" || value.trim() === "";
  });
}

const DICTIONARIES: ReadonlyArray<{
  label: string;
  prefix: string;
  codes: readonly string[];
}> = [
  { label: "powody odmowy dostępu", prefix: "club.reason", codes: CLUB_ACCESS_REASONS },
  { label: "role członkowskie", prefix: "club.role", codes: CLUB_MEMBER_ROLES },
  { label: "statusy członkostwa", prefix: "club.memberStatus", codes: CLUB_MEMBER_STATUSES },
  { label: "rodzaje tematów", prefix: "club.kind", codes: CLUB_THREAD_KINDS },
  { label: "statusy tematu", prefix: "club.threadStatus", codes: CLUB_THREAD_STATUSES },
  { label: "rodzaje reakcji", prefix: "club.reaction", codes: CLUB_REACTION_KINDS },
  { label: "poziomy powiadomień", prefix: "club.notify", codes: CLUB_NOTIFY_LEVELS },
  {
    label: "akcje moderacyjne",
    prefix: "adminClubs.moderation.action",
    codes: CLUB_MODERATION_ACTIONS,
  },
];

describe("słowniki Discussion Club mają komplet tłumaczeń", () => {
  for (const { label, prefix, codes } of DICTIONARIES) {
    it(`${label}: każdy kod ma tekst PL`, () => {
      expect(missing(clubPl as Tree, prefix, codes)).toEqual([]);
    });

    it(`${label}: każdy kod ma tekst EN`, () => {
      expect(missing(clubEn as Tree, prefix, codes)).toEqual([]);
    });
  }

  // Odwrotny kierunek dla powodów odmowy: bundle nie może obiecywać zdania,
  // którego baza nigdy nie wyprodukuje. Martwy klucz to nie awaria, ale
  // wprowadza w błąd przy czytaniu tłumaczeń - ktoś szuka, kiedy to się
  // pokazuje, i nie znajduje.
  it("słownik powodów nie ma martwych kluczy", () => {
    const inBundle = Object.keys((read(clubPl as Tree, "club.reason") ?? {}) as Tree);
    const known = new Set<string>(CLUB_ACCESS_REASONS);
    expect(inBundle.filter((key) => !known.has(key))).toEqual([]);
  });
});
