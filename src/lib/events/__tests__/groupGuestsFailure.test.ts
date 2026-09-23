// Odmowy DOPISANIA GOŚCI do zgłoszenia prowadzącego - zdania w obu językach.
//
// CO TEN PLIK DOWODZI.
//   1. KAŻDY `RAISE EXCEPTION` z `event_register_group_guests` MA WŁASNE ZDANIE,
//      po polsku i po angielsku. Do tej naprawy odmowy gości szły przez słownik
//      zapisu prowadzącego: `group_too_large`, `group_not_enabled`,
//      `already_settled`, `invalid_guests`, `account_required`, `sold_out` i
//      `registration_closed` nie miały tam kluczy, więc kupujący czytał ogólne
//      „Nie udało się zapisać. Spróbuj ponownie." - choć jego zgłoszenie już
//      stało w bazie.
//   2. `not_found` MÓWI O ZGŁOSZENIU, NIE O WYDARZENIU. Dla gości znaczy „nie ma
//      zgłoszenia prowadzącego na tym koncie"; stare „Nie znaleźliśmy tego
//      wydarzenia." było nieprawdą.
//   3. `already_registered: <email>` MÓWI, KTÓRY GOŚĆ. Adres z ogona komunikatu
//      trafia do zdania - bez niego kupujący zgaduje, kogo usunąć z listy.
//   4. `group_too_large` PODAJE LIMIT BILETU, gdy wołający go zna, i nie wstawia
//      pustego miejsca, gdy nie zna.
//   5. NIEZNANA ODMOWA NIE UDAJE ZNANEJ: najpierw słownik zapisu prowadzącego
//      (to samo połączenie może odmówić np. limitem prób), potem zdanie ogólne
//      O GOŚCIACH, które mówi, że zgłoszenie kupującego jest zapisane.
//   6. `isGroupTooLarge` ROZPOZNAJE ODMOWĘ LIMITEM po głowie komunikatu - tylko
//      po niej panel ponowienia czyta limit biletu od nowa.
//   7. KAŻDY NAPIS PANELU PONOWIENIA STOI W OBU SŁOWNIKACH, słowo w słowo.
//
// OBECNOŚĆ KLUCZA CZYTAMY Z EKSPORTOWANEGO SŁOWNIKA, NIE PRZEZ
// `i18n.exists(klucz, { lng: "en" })` ani `getFixedT("en")`. Instancja ma
// `fallbackLng: "pl"`, więc klucz obecny tylko po polsku przechodzi oba te
// sprawdzenia po angielsku (zmierzone: usunięty EN `retry.hint` zostawiał ten
// plik zielonym). `readKey(eventRegistrationEn, klucz)` patrzy dokładnie w
// bundel angielski - ta sama technika, co w `eventErrorMapsI18n.gate.test.ts`.
//
// i18n jedzie PRAWDZIWE (ta sama instancja, którą widzi uczestnik). Lista
// `GROUP_GUEST_REFUSALS` jest porównywana z ciałem funkcji w migracji
// `20260922230000`: nowa odmowa w SQL bez wpisu na liście (albo wpis bez
// odmowy) zapala pierwszy test, a wpis bez zdania w słowniku - testy per kod.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import i18n from "@/lib/i18n";
import { readKey, type ResourceTree } from "@/lib/ci/i18nParity";
import { eventRegistrationEn, eventRegistrationPl } from "@/lib/i18n-event-registration";
import {
  GROUP_GUEST_REFUSALS,
  groupGuestsFailure,
  isGroupTooLarge,
  type RegistrationFailure,
} from "@/lib/events/publicRegistrationErrors";

const MIGRATION = "supabase/migrations/20260922230000_event_ticket_tax_and_group.sql";
const LANGS = ["pl", "en"] as const;
const DICTIONARIES: Record<(typeof LANGS)[number], ResourceTree> = {
  pl: eventRegistrationPl,
  en: eventRegistrationEn,
};

/** Napis spod klucza W SŁOWNIKU DANEGO JĘZYKA - bez zapasowego „pl". */
function ownText(lang: (typeof LANGS)[number], key: string): string | null {
  const value = readKey(DICTIONARIES[lang], key);
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function render(failure: RegistrationFailure, lang: (typeof LANGS)[number]): string {
  return i18n.getFixedT(lang)(failure.key, failure.params);
}

/** Kody odmów z ciała `event_register_group_guests` w migracji. */
function refusalsInMigration(): string[] {
  const sql = readFileSync(MIGRATION, "utf8");
  const start = sql.indexOf("FUNCTION public.event_register_group_guests(");
  const end = sql.indexOf("END $$;", start);
  expect(start).toBeGreaterThan(-1);
  const body = sql.slice(start, end);
  const codes = [...body.matchAll(/RAISE EXCEPTION '([a-z_]+)/g)].map((match) => match[1] ?? "");
  return [...new Set(codes)];
}

describe("groupGuestsFailure - komplet odmów bazy", () => {
  it("lista odmów w kodzie to dokładnie odmowy funkcji SQL", () => {
    expect([...GROUP_GUEST_REFUSALS].sort()).toEqual(refusalsInMigration().sort());
  });

  for (const code of GROUP_GUEST_REFUSALS) {
    for (const lang of LANGS) {
      it(`„${code}” ma własne zdanie o gościach (${lang})`, () => {
        const failure = groupGuestsFailure(new Error(`${code}: gosc@example.com`), { maxSize: 4 });

        expect(failure.key.startsWith("eventRegistration.group.errors.")).toBe(true);
        expect(ownText(lang, failure.key), `${lang}:${failure.key}`).not.toBeNull();
        const text = render(failure, lang);
        expect(text).not.toBe(failure.key);
        expect(text).not.toMatch(/\{\{/);
        expect(text).not.toBe(
          render({ key: "eventRegistration.errors.unknown", params: {} }, lang),
        );
      });
    }
  }

  it("każda odmowa dostaje INNY klucz - żadne dwie nie zlewają się w jedno zdanie", () => {
    const keys = GROUP_GUEST_REFUSALS.map((code) => groupGuestsFailure(new Error(code)).key);
    expect(new Set(keys).size).toBe(GROUP_GUEST_REFUSALS.length);
  });
});

describe("groupGuestsFailure - zdania, które mówią, co zrobić", () => {
  it("not_found mówi o zgłoszeniu na tym koncie, a nie o wydarzeniu", () => {
    const failure = groupGuestsFailure(new Error("not_found"));

    expect(failure).toEqual({ key: "eventRegistration.group.errors.notFound", params: {} });
    expect(render(failure, "pl")).toBe(
      "Nie znaleźliśmy Twojego zgłoszenia na tym koncie. Gości dopisuje osoba, która złożyła zgłoszenie, z tego samego konta.",
    );
    expect(render(failure, "en")).toBe(
      "We could not find your registration on this account. Guests are added by the person who registered, from the same account.",
    );
    expect(render(failure, "pl")).not.toBe("Nie znaleźliśmy tego wydarzenia.");
  });

  it("already_registered podaje adres gościa z ogona komunikatu", () => {
    const failure = groupGuestsFailure({ message: "already_registered: gosc.dwa@example.com" });

    expect(failure).toEqual({
      key: "eventRegistration.group.errors.alreadyRegistered",
      params: { email: "gosc.dwa@example.com" },
    });
    expect(render(failure, "pl")).toBe(
      "Osoba z adresem gosc.dwa@example.com ma już aktywny zapis na to wydarzenie. Usuń ją z listy gości.",
    );
    expect(render(failure, "en")).toBe(
      "The person with the address gosc.dwa@example.com already has an active registration for this event. Remove them from the guest list.",
    );
  });

  it("already_registered bez adresu nie zostawia dziury w zdaniu", () => {
    const failure = groupGuestsFailure(new Error("already_registered"));

    expect(failure).toEqual({
      key: "eventRegistration.group.errors.alreadyRegisteredUnknown",
      params: {},
    });
    expect(render(failure, "pl")).toBe(
      "Jedna z osób ma już aktywny zapis na to wydarzenie. Usuń ją z listy gości.",
    );
    expect(render(failure, "en")).toBe(
      "One of the people already has an active registration for this event. Remove them from the guest list.",
    );
  });

  it("group_too_large podaje limit biletu, gdy wołający go zna", () => {
    const failure = groupGuestsFailure("group_too_large", { maxSize: 3 });

    expect(failure).toEqual({
      key: "eventRegistration.group.errors.groupTooLargeMax",
      params: { max: 3 },
    });
    expect(render(failure, "pl")).toBe(
      "Za dużo osób: ten bilet pozwala na grupę do 3 osób łącznie z Tobą. Usuń część gości.",
    );
    expect(render(failure, "en")).toBe(
      "Too many people: this ticket allows a group of up to 3 people including you. Remove some guests.",
    );
  });

  it("group_too_large bez znanego limitu nie zmyśla liczby", () => {
    for (const maxSize of [undefined, null, 0, Number.NaN, 2.5]) {
      const failure = groupGuestsFailure(new Error("group_too_large"), { maxSize });
      expect(failure).toEqual({ key: "eventRegistration.group.errors.groupTooLarge", params: {} });
    }
    const failure = groupGuestsFailure(new Error("group_too_large"));
    expect(render(failure, "pl")).toBe(
      "Za dużo osób jak na limit grupy tego biletu. Usuń część gości.",
    );
    expect(render(failure, "en")).toBe(
      "Too many people for this ticket's group limit. Remove some guests.",
    );
  });

  it("pozostałe odmowy mają zdania dosłownie takie, jakie zobaczy kupujący", () => {
    const expected: Record<string, { pl: string; en: string }> = {
      account_required: {
        pl: "Zaloguj się, aby dopisać gości do swojego zgłoszenia.",
        en: "Sign in to add guests to your registration.",
      },
      invalid_guests: {
        pl: "Lista gości ma nieprawidłowy format. Sprawdź dane i spróbuj ponownie.",
        en: "The guest list has an invalid format. Check the details and try again.",
      },
      registration_closed: {
        pl: "Twoje zgłoszenie zostało odwołane lub odrzucone - nie można już dopisać do niego gości.",
        en: "Your registration has been cancelled or rejected - guests can no longer be added to it.",
      },
      already_settled: {
        pl: "Twoje zgłoszenie jest już rozliczone - do opłaconego zamówienia nie dopiszemy gości. Zapisz ich osobnym zgłoszeniem.",
        en: "Your registration is already settled - we cannot add guests to a paid order. Register them separately.",
      },
      group_not_enabled: {
        pl: "Ten bilet nie pozwala na zapis grupowy.",
        en: "This ticket does not allow group registration.",
      },
      sold_out: {
        pl: "Nie ma już tylu wolnych miejsc na tym bilecie. Usuń część gości.",
        en: "There are not that many seats left on this ticket. Remove some guests.",
      },
      invalid_name: {
        pl: "Każdy gość musi mieć imię i nazwisko (do 80 znaków).",
        en: "Every guest needs a first and last name (up to 80 characters).",
      },
      invalid_email: {
        pl: "Adres e-mail jednego z gości jest niepoprawny.",
        en: "The e-mail address of one of the guests is not valid.",
      },
    };
    for (const [code, text] of Object.entries(expected)) {
      const failure = groupGuestsFailure(new Error(code));
      expect(render(failure, "pl"), code).toBe(text.pl);
      expect(render(failure, "en"), code).toBe(text.en);
    }
  });
});

describe("groupGuestsFailure - odmowy spoza funkcji gości", () => {
  it("znana odmowa zapisu (np. limit prób) zostaje przy słowniku zapisu", () => {
    expect(groupGuestsFailure(new Error("rate_limited: 5"))).toEqual({
      key: "eventRegistration.errors.rateLimited",
      params: { count: 5 },
    });
  });

  it("nieznana odmowa mówi o gościach i o tym, że zgłoszenie stoi (PL/EN)", () => {
    for (const error of [
      new Error('violates check constraint "event_people_email_check"'),
      new Error("Failed to fetch"),
      null,
      42,
    ]) {
      expect(groupGuestsFailure(error)).toEqual({
        key: "eventRegistration.group.errors.unknown",
        params: {},
      });
    }
    const failure = groupGuestsFailure(new Error("boom"));
    expect(render(failure, "pl")).toBe(
      "Nie udało się dopisać gości. Twoje zgłoszenie jest zapisane - spróbuj ponownie.",
    );
    expect(render(failure, "en")).toBe(
      "We could not add the guests. Your registration is saved - please try again.",
    );
  });
});

describe("isGroupTooLarge - odmowa limitem grupy", () => {
  it("rozpoznaje `group_too_large` w każdym kształcie błędu", () => {
    for (const error of [
      "group_too_large",
      new Error("group_too_large"),
      { message: " group_too_large " },
      new Error("group_too_large: 5"),
    ]) {
      expect(isGroupTooLarge(error), String(error)).toBe(true);
    }
  });

  it("inna odmowa albo brak komunikatu to nie odmowa limitem", () => {
    for (const error of [
      new Error("sold_out"),
      new Error("group_not_enabled"),
      new Error("already_registered: group_too_large@example.com"),
      null,
      42,
    ]) {
      expect(isGroupTooLarge(error), String(error)).toBe(false);
    }
  });
});

describe("eventRegistration.group.retry - napisy panelu ponowienia", () => {
  // ZMIANA ASERCJI: wcześniej sprawdzenie szło przez `getFixedT(lang)(klucz)
  // !== klucz`, a przy `fallbackLng: "pl"` usunięty napis angielski wracał
  // po polsku i test zostawał zielony. Teraz każdy napis czytamy z bundla
  // SWOJEGO języka i porównujemy dosłownie.
  const expected: Record<string, { pl: string; en: string }> = {
    hint: {
      pl: "Twoje zgłoszenie jest zapisane. Popraw listę gości i dopisz ich ponownie - nie musisz wypełniać formularza od nowa.",
      en: "Your registration is saved. Correct the guest list and add the guests again - you do not need to fill in the form from scratch.",
    },
    beforePayment: {
      pl: "Dopisz gości przed płatnością - wtedy jedno zamówienie obejmie wszystkie miejsca.",
      en: "Add the guests before paying - then one order covers every seat.",
    },
    submit: { pl: "Dopisz gości ponownie", en: "Add guests again" },
    submitting: { pl: "Dopisujemy gości...", en: "Adding guests..." },
    added: {
      pl: "Dopisano gości do zgłoszenia: {{count}}.",
      en: "Guests added to your registration: {{count}}.",
    },
  };

  it("każdy napis panelu stoi w bundlu SWOJEGO języka, słowo w słowo", () => {
    for (const [key, text] of Object.entries(expected)) {
      const full = `eventRegistration.group.retry.${key}`;
      expect(ownText("pl", full), full).toBe(text.pl);
      expect(ownText("en", full), full).toBe(text.en);
    }
  });

  it("lista napisów w teście to dokładnie gałąź `retry` obu słowników", () => {
    for (const lang of LANGS) {
      const branch = readKey(DICTIONARIES[lang], "eventRegistration.group.retry");
      expect(typeof branch === "object" && branch !== null, lang).toBe(true);
      expect(Object.keys(branch ?? {}).sort(), lang).toEqual(Object.keys(expected).sort());
    }
  });

  it("liczba trafia do zdania sukcesu w obu językach", () => {
    expect(i18n.getFixedT("pl")("eventRegistration.group.retry.added", { count: 2 })).toBe(
      "Dopisano gości do zgłoszenia: 2.",
    );
    expect(i18n.getFixedT("en")("eventRegistration.group.retry.added", { count: 2 })).toBe(
      "Guests added to your registration: 2.",
    );
  });
});
