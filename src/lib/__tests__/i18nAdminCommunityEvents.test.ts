// Parzystosc PL/EN slownika panelu wydarzen + pokrycie kluczy uzywanych w kodzie
// + gwarancja, ze panel nie wraca do recznych `isPl ? ... : ...`.
//
// Trasa i panel prelegentow trzymaly razem ~100 napisow w wyrazeniach
// warunkowych, a `isPl` bylo przekazywane w dol jako props. Testy nizej pilnuja
// wszystkich warstw naprawy naraz: slownika, map etykiet enumow i tego, ze
// zaden z dwoch plikow nie ma juz twardego polskiego tekstu.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { adminCommunityEventsPl, adminCommunityEventsEn } from "@/lib/i18n-admin-community-events";
import {
  EVENT_KIND_LABEL_KEYS,
  EVENT_STATUS_LABEL_KEYS,
  EVENT_KINDS,
  EVENT_STATUSES,
  isEventKind,
  isEventStatus,
} from "@/lib/admin/community";

type Tree = { [key: string]: string | Tree };

function flatten(node: Tree, prefix = ""): string[] {
  return Object.entries(node).flatMap(([key, value]) => {
    const path = prefix === "" ? key : `${prefix}.${key}`;
    return typeof value === "string" ? [path] : flatten(value, path);
  });
}

// Polski ma wiecej form liczby mnogiej niz angielski, wiec porownanie zbiorow
// kluczy musi - jak bramka rdzenia locale - normalizowac sufiksy.
const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;
const baseKeys = (paths: readonly string[]): string[] => [
  ...new Set(paths.map((k) => k.replace(PLURAL_SUFFIX, ""))),
];

const ROUTE_SOURCE = readFileSync("src/routes/admin.community.events.tsx", "utf8");
const SPEAKERS_SOURCE = readFileSync(
  "src/components/admin/community/EventSpeakersManager.tsx",
  "utf8",
);
// Popup zakladania prelegenta BEZ KONTA woła ~35 kluczy z tego samego drzewa.
// Bez tego pliku w skanie brakujacy klucz przechodzil parytet (nie ma go
// w OBU slownikach), przechodzil `tsc` i wychodzil na ekran jako
// `adminCommunityEvents.speakers.create.…`.
const SPEAKER_CREATE_SOURCE = readFileSync(
  "src/components/admin/community/EventSpeakerCreateDialog.tsx",
  "utf8",
);

const pl = flatten(adminCommunityEventsPl as unknown as Tree);
const en = flatten(adminCommunityEventsEn as unknown as Tree);

describe("i18n-admin-community-events", () => {
  it("ma identyczny zestaw kluczy w PL i EN (po normalizacji liczby mnogiej)", () => {
    expect(baseKeys(pl).sort()).toEqual(baseKeys(en).sort());
  });

  it("ma polskie formy liczby mnogiej dla licznika przypomnien", () => {
    // 1 przypomnienie / 2-4 przypomnienia / 5+ przypomnien - poprzednio jedna
    // forma obslugiwala wszystkie liczby ("Wyslano 1 przypomnien").
    const family = pl.filter((k) => k.startsWith("adminCommunityEvents.toasts.remindersSent"));
    expect(family.sort()).toEqual([
      "adminCommunityEvents.toasts.remindersSent_few",
      "adminCommunityEvents.toasts.remindersSent_many",
      "adminCommunityEvents.toasts.remindersSent_one",
      "adminCommunityEvents.toasts.remindersSent_other",
    ]);
    const enFamily = en.filter((k) => k.startsWith("adminCommunityEvents.toasts.remindersSent"));
    expect(enFamily.sort()).toEqual([
      "adminCommunityEvents.toasts.remindersSent_one",
      "adminCommunityEvents.toasts.remindersSent_other",
    ]);
  });

  it("nie zawiera pustych tlumaczen ani pauzy typograficznej", () => {
    const values = [adminCommunityEventsPl, adminCommunityEventsEn]
      .map((tree) => JSON.stringify(tree))
      .join(" ");
    expect(values).not.toContain("—");
    expect(values).not.toContain('""');
  });

  it("pokrywa KAZDY klucz adminCommunityEvents.* wolany w kodzie", () => {
    const used = [ROUTE_SOURCE, SPEAKERS_SOURCE, SPEAKER_CREATE_SOURCE].flatMap((src) =>
      [...src.matchAll(/"(adminCommunityEvents\.[A-Za-z0-9_.]+)"/g)].map((m) => m[1]),
    );
    // Rodzina liczby mnogiej jest wolana kluczem BAZOWYM (`...remindersSent`) -
    // sufiks dobiera i18next w czasie wykonania - wiec zbior zadeklarowanych
    // kluczy musi obejmowac obie formy zapisu.
    const declared = new Set([...pl, ...baseKeys(pl)]);
    const missing = [...new Set(used)].filter((key) => !declared.has(key)).sort();
    expect(missing).toEqual([]);
  });

  it("pokrywa klucze map etykiet rodzaju i statusu wydarzenia", () => {
    // `Record<EventKind, string>` w community.ts wymusza, ze kazdy wariant MA
    // klucz. Ten test domyka druga polowe kontraktu: ze klucz jest w slowniku.
    const mapped = [
      ...Object.values(EVENT_KIND_LABEL_KEYS),
      ...Object.values(EVENT_STATUS_LABEL_KEYS),
    ];
    expect(mapped.filter((key) => !pl.includes(key)).sort()).toEqual([]);
  });

  it("straznicy typow przyjmuja tylko wartosci z CHECK-a bazy", () => {
    // Kolumny `kind`/`status` sa w wygenerowanych typach zwyklym `string`, wiec
    // plakietka polega na tych straznikach zamiast na rzutowaniu.
    for (const kind of EVENT_KINDS) expect(isEventKind(kind)).toBe(true);
    for (const status of EVENT_STATUSES) expect(isEventStatus(status)).toBe(true);
    expect(isEventKind("conference")).toBe(false);
    expect(isEventStatus("archived")).toBe(false);
    expect(isEventKind("")).toBe(false);
  });

  it("ani trasa, ani panel prelegentow nie maja twardych polskich napisow", () => {
    // Bramka regresyjna: konwersja na slownik jest warta tyle, ile jej trwalosc.
    // Skanujemy tekst JSX i literaly stringow (bez komentarzy) w poszukiwaniu
    // polskich znakow diakrytycznych - one nie maja jak trafic do kodu inaczej
    // niz jako tekst dla uzytkownika.
    const offenders: string[] = [];
    for (const source of [ROUTE_SOURCE, SPEAKERS_SOURCE, SPEAKER_CREATE_SOURCE]) {
      const withoutComments = source
        .replace(/\/\/[^\n]*/g, "")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
      for (const match of withoutComments.matchAll(/>([^<>{}\n]{3,80})</g)) {
        if (/[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/.test(match[1])) offenders.push(match[1].trim());
      }
      for (const match of withoutComments.matchAll(/"([^"\\\n]{4,120})"/g)) {
        if (/[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/.test(match[1])) offenders.push(match[1]);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("nie przekazuje juz jezyka przez propsy", () => {
    // `isPl` w propsach oznaczalo, ze nowe miejsce montowania komponentu moze
    // po prostu zapomniec podac jezyk. Komponent bierze `t()` sam.
    expect(SPEAKERS_SOURCE).not.toContain("isPl");
    expect(ROUTE_SOURCE).not.toContain("isPl={");
  });
});
