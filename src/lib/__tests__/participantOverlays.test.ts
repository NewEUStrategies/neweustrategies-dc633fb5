// OSIEM NAKŁADEK FUNKCJI UCZESTNIKA F1-F5 - kontrakt zasiewu (spec B.14).
//
// Foundation tworzy wszystkie nakładki (dwie własne i po dwie dla torów A/B/C),
// a tory dopisują do swoich klucze. Ten plik przypina to, co MUSI przetrwać
// każdą zmianę toru - dlatego nie sprawdza konkretnych zdań seedu poza
// znacznikiem czystości chunka startowego:
//
//  1. Nazwane eksporty `…Pl` / `…En` mają IDENTYCZNE drzewa kluczy pod jednym
//     korzeniem, a każdy liść jest niepustym napisem, innym w obu językach.
//  2. `ensureI18n()` jest idempotentne, a sam import rejestruje słownik.
//  3. Znacznik `HEAVY_DICTIONARIES` (`scripts/check-entry-purity.ts`) jest
//     zdaniem PL z tej nakładki - bramka paczki startowej rozpoznaje nakładkę
//     właśnie po nim, więc usunięcie zdania oślepiłoby bramkę.
//  4. Prefiks nakładki jest bramkowany (`GATED_PREFIXES`) i skanowany
//     (`REFERENCE_PREFIXES`).
//  5. Tytuły tras F1-F5 w `i18n-event-head` istnieją w obu językach, bez
//     interpolacji (trasy nie mają loadera z nazwą wydarzenia).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import i18n from "@/lib/i18n";
import { readKey, type ResourceTree } from "@/lib/ci/i18nParity";
import * as eventParticipant from "@/lib/i18n-event-participant";
import * as adminEventParticipant from "@/lib/i18n-admin-event-participant";
import * as eventCalendar from "@/lib/i18n-event-calendar";
import * as eventPlan from "@/lib/i18n-event-plan";
import * as eventTicketActions from "@/lib/i18n-event-ticket-actions";
import * as adminEventOffers from "@/lib/i18n-admin-event-offers";
import * as eventFollowUp from "@/lib/i18n-event-follow-up";
import * as adminEventFollowUp from "@/lib/i18n-admin-event-follow-up";
import { eventHeadEn, eventHeadPl } from "@/lib/i18n-event-head";

interface Nakladka {
  plik: string;
  prefiks: string;
  pl: ResourceTree;
  en: ResourceTree;
  ensure: () => void;
  /** Ścieżka zdania-znacznika `HEAVY_DICTIONARIES` (pod prefiksem). */
  znacznik: string;
}

const NAKLADKI: readonly Nakladka[] = [
  {
    plik: "i18n-event-participant",
    prefiks: "eventParticipant",
    pl: eventParticipant.eventParticipantPl,
    en: eventParticipant.eventParticipantEn,
    ensure: eventParticipant.ensureI18n,
    znacznik: "options.loadError",
  },
  {
    plik: "i18n-admin-event-participant",
    prefiks: "adminEventParticipant",
    pl: adminEventParticipant.adminEventParticipantPl,
    en: adminEventParticipant.adminEventParticipantEn,
    ensure: adminEventParticipant.ensureI18n,
    znacznik: "policies.refund.rule",
  },
  {
    plik: "i18n-event-calendar",
    prefiks: "eventCalendar",
    pl: eventCalendar.eventCalendarPl,
    en: eventCalendar.eventCalendarEn,
    ensure: eventCalendar.ensureI18n,
    znacznik: "menu.title",
  },
  {
    plik: "i18n-event-plan",
    prefiks: "eventPlan",
    pl: eventPlan.eventPlanPl,
    en: eventPlan.eventPlanEn,
    ensure: eventPlan.ensureI18n,
    znacznik: "title",
  },
  {
    plik: "i18n-event-ticket-actions",
    prefiks: "eventTicketActions",
    pl: eventTicketActions.eventTicketActionsPl,
    en: eventTicketActions.eventTicketActionsEn,
    ensure: eventTicketActions.ensureI18n,
    znacznik: "title",
  },
  {
    plik: "i18n-admin-event-offers",
    prefiks: "adminEventOffers",
    pl: adminEventOffers.adminEventOffersPl,
    en: adminEventOffers.adminEventOffersEn,
    ensure: adminEventOffers.ensureI18n,
    znacznik: "title",
  },
  {
    plik: "i18n-event-follow-up",
    prefiks: "eventFollowUp",
    pl: eventFollowUp.eventFollowUpPl,
    en: eventFollowUp.eventFollowUpEn,
    ensure: eventFollowUp.ensureI18n,
    znacznik: "title",
  },
  {
    plik: "i18n-admin-event-follow-up",
    prefiks: "adminEventFollowUp",
    pl: adminEventFollowUp.adminEventFollowUpPl,
    en: adminEventFollowUp.adminEventFollowUpEn,
    ensure: adminEventFollowUp.ensureI18n,
    znacznik: "title",
  },
];

function isTree(value: unknown): value is ResourceTree {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Pary `[ścieżka, liść]` całego drzewa. */
function liscie(tree: ResourceTree, prefix = ""): [string, unknown][] {
  const out: [string, unknown][] = [];
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix === "" ? key : `${prefix}.${key}`;
    if (isTree(value)) out.push(...liscie(value, path));
    else out.push([path, value]);
  }
  return out;
}

const ENTRY_PURITY = readFileSync(join(process.cwd(), "scripts", "check-entry-purity.ts"), "utf8");
const PARITY_GATE = readFileSync(
  join(process.cwd(), "src", "__tests__", "i18nParity.gate.test.ts"),
  "utf8",
);
const KEY_GATE = readFileSync(
  join(
    process.cwd(),
    "src",
    "components",
    "admin",
    "events",
    "__tests__",
    "eventsI18nKeys.gate.test.ts",
  ),
  "utf8",
);

describe.each(NAKLADKI)("nakładka $plik ($prefiks)", (nakladka) => {
  it("jeden korzeń = prefiks nakładki, w obu językach", () => {
    expect(Object.keys(nakladka.pl)).toEqual([nakladka.prefiks]);
    expect(Object.keys(nakladka.en)).toEqual([nakladka.prefiks]);
  });

  it("drzewa PL i EN mają identyczne klucze; każdy liść jest niepusty i różny w obu językach", () => {
    const pl = liscie(nakladka.pl);
    const en = new Map(liscie(nakladka.en));
    expect(pl.map(([path]) => path).sort()).toEqual([...en.keys()].sort());
    for (const [path, value] of pl) {
      expect(typeof value, path).toBe("string");
      expect(String(value).trim(), path).not.toBe("");
      expect(en.get(path), path).not.toBe(value);
    }
  });

  it("identyczne miejsca interpolacji w PL i EN", () => {
    const placeholders = (value: unknown) =>
      [...String(value).matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort();
    const en = new Map(liscie(nakladka.en));
    for (const [path, value] of liscie(nakladka.pl)) {
      expect(placeholders(value), path).toEqual(placeholders(en.get(path)));
    }
  });

  it("import rejestruje słownik, a `ensureI18n()` jest idempotentne", () => {
    const spy = vi.spyOn(i18n, "addResourceBundle");
    nakladka.ensure();
    nakladka.ensure();
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
    for (const [path] of liscie(nakladka.pl)) {
      expect(i18n.exists(path, { lng: "pl" }), path).toBe(true);
    }
  });

  it("zdanie-znacznik `HEAVY_DICTIONARIES` stoi w nakładce i w bramce paczki startowej", () => {
    const zdanie = readKey(nakladka.pl, `${nakladka.prefiks}.${nakladka.znacznik}`);
    expect(typeof zdanie).toBe("string");
    expect(ENTRY_PURITY).toContain(`"${String(zdanie)}"`);
    expect(ENTRY_PURITY).toContain(nakladka.plik);
  });

  it("prefiks jest bramkowany i skanowany", () => {
    expect(PARITY_GATE).toContain(`"${nakladka.prefiks}",`);
    expect(KEY_GATE).toContain(`"${nakladka.prefiks}",`);
  });
});

describe("i18n-event-head - tytuły tras F1-F5", () => {
  it.each(["meTitle", "transferTitle", "certificateTitle", "followUpTitle"] as const)(
    "%s istnieje w obu językach, różni się i nie ma interpolacji",
    (key) => {
      const pl = eventHeadPl.eventHead[key];
      const en = eventHeadEn.eventHead[key];
      expect(pl.trim()).not.toBe("");
      expect(en.trim()).not.toBe("");
      expect(pl).not.toBe(en);
      expect(pl).not.toContain("{{");
      expect(en).not.toContain("{{");
    },
  );

  it("prefiks `eventHead` jest bramkowany parytetem", () => {
    expect(PARITY_GATE).toContain('"eventHead",');
  });
});
