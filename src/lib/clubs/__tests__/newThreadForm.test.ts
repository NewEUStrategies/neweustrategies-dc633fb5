// Reguły kompozytora nowego tematu, wyprowadzone z JSX-a trasy
// `/club/$clubSlug/new`.
//
// CO TO DOWODZI. Trzynaście reguł produktu, które przed wyprowadzeniem były
// wyrażeniami inline w drzewie JSX i w ciele komponentu - a więc dawały się
// sprawdzić wyłącznie przez zamontowanie całego formularza z atrapą Radiksa,
// pola wzmianek i pickera kotwicy:
//
//   1. PROGI PÓL liczą się PO PRZYCIĘCIU. Pięć spacji nie jest tytułem, a
//      dokładnie przycięta wartość jedzie w payloadzie - walidacja i wysyłka
//      nie mają prawa się rozjechać.
//   2. GOTOWOŚĆ FORMULARZA to jedna funkcja dla przycisku i dla strażnika
//      w handlerze. Dwa osobne warunki znaczyły, że klawiatura obchodzi
//      walidację, której mysz obejść nie może.
//   3. DZIAŁ Z ADRESU obowiązuje TYLKO tam, gdzie wolno założyć temat -
//      inaczej link z huba prowadzi do formularza, którego zapis odmówi.
//   4. `announcement` NIE MA PRAWA stać na dropliście bez uprawnienia
//      moderacyjnego, a wartość z adresu degraduje do dyskusji.
//   5. ATRYBUCJA DZIEDZICZY DZIAŁ, nie klub. To jest sedno: `club_groups_list`
//      zwraca wartość już efektywną, więc dział prowadzony w regule Chatham
//      House musi przykryć ustawienie klubu.
//   6. NADPISANIE wolno wyłącznie ZAOSTRZYĆ - poluzowanie byłoby obejściem
//      polityki klubu przez założenie wątku.
//   7. WIDOCZNOŚĆ pięciu pól jako jeden deskryptor: pole widoczne tam, gdzie
//      RPC go nie przyjmie, produkuje odmowę po napisaniu tekstu.
//   8. PAYLOAD: przycięcie, `lockReplies` tylko z uprawnieniem, ikona przez
//      katalog, SUROWE nadpisanie atrybucji (`null` = dziedzicz).
//   9. WYNIK PUBLIKACJI: `pending` NIE prowadzi do wątku, bo jego strona
//      odpowiedziałaby odmową.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE.
// - Katalogu ikon: `normalizeClubThreadIcon` ma testy w `clubPureModules`.
//   Tutaj dowodzimy tylko, że payload przez niego PRZECHODZI.
// - Słownika trybów atrybucji i rodzajów wątku: `isClubAttributionMode`
//   i `CLUB_THREAD_KINDS` mają testy w `clubTypes.test.ts`.
// - AUTORYTETU: `can_post_thread`, `can_moderate` i `attribution_mode`
//   pochodzą z SECURITY DEFINER RPC (pgTAP). Te funkcje ich nie liczą - one
//   decydują, czego formularz nie oferuje, bo RPC i tak by tego nie przyjął.
// - SKLEJENIA trasy (co jedzie do mutacji, co unieważnia sukces, jak działa
//   nawigacja): to `src/routes/__tests__/clubNewThreadRoute.test.tsx`.
import { describe, expect, it } from "vitest";
import {
  CLUB_THREAD_BODY_MAX,
  CLUB_THREAD_BODY_MIN,
  CLUB_THREAD_TITLE_MAX,
  CLUB_THREAD_TITLE_MIN,
  NEW_THREAD_ATTRIBUTION_INHERIT,
  attributionHintKey,
  attributionInheritLabel,
  attributionOverrideChoices,
  attributionSelectValue,
  baseAttributionMode,
  buildNewThreadPayload,
  canComposeThread,
  canPostAnonymously,
  defaultLockReplies,
  effectiveAttributionMode,
  isAttributionOverrideAllowed,
  newThreadDenialKey,
  newThreadFieldVisibility,
  newThreadFormReady,
  newThreadOutcome,
  postableThreadGroups,
  readAttributionSelection,
  resolveThreadGroupId,
  resolveThreadKind,
  threadBodyValid,
  threadKindChoices,
  threadTitleValid,
  type NewThreadFormState,
  type NewThreadGroupRow,
} from "@/lib/clubs/newThreadForm";
import { CLUB_IDS, clubGroupRow, clubViewRow } from "@/test/clubs/fixtures";
import type { CreateThreadVars } from "@/lib/clubs/useClubThreadsData";

/** Wiersz działu w wąskim kształcie, na którym stoją te reguły. */
function group(overrides: Partial<NewThreadGroupRow> = {}): NewThreadGroupRow {
  return {
    id: CLUB_IDS.group,
    can_post_thread: true,
    attribution_mode: "attributed",
    ...overrides,
  };
}

/** Napis o zadanej długości - do trafiania DOKŁADNIE w progi. */
function chars(count: number): string {
  return "x".repeat(count);
}

// --- progi pól -------------------------------------------------------------

describe("threadTitleValid - próg tytułu liczony PO PRZYCIĘCIU", () => {
  it.each([
    ["dokładnie minimum", chars(CLUB_THREAD_TITLE_MIN), true],
    ["o jeden pod minimum", chars(CLUB_THREAD_TITLE_MIN - 1), false],
    ["dokładnie maksimum", chars(CLUB_THREAD_TITLE_MAX), true],
    ["o jeden nad maksimum", chars(CLUB_THREAD_TITLE_MAX + 1), false],
    ["pusty napis", "", false],
    ["same białe znaki", "        ", false],
    ["minimum otoczone spacjami", `   ${chars(CLUB_THREAD_TITLE_MIN)}   `, true],
    ["o jeden pod minimum ze spacjami", `   ${chars(CLUB_THREAD_TITLE_MIN - 1)}   `, false],
  ])("%s -> %s", (_label, value, expected) => {
    expect(threadTitleValid(value)).toBe(expected);
  });

  it("maksimum tytułu jest tym samym progiem, co `maxLength` pola", () => {
    // Rozjazd tych dwóch liczb daje pole, w które da się wpisać tekst
    // odrzucany przez walidację - i przycisk publikacji bez wyjaśnienia.
    expect(CLUB_THREAD_TITLE_MAX).toBe(200);
  });
});

describe("threadBodyValid - próg treści", () => {
  it.each([
    ["dokładnie minimum", chars(CLUB_THREAD_BODY_MIN), true],
    ["o jeden pod minimum", chars(CLUB_THREAD_BODY_MIN - 1), false],
    ["dokładnie maksimum", chars(CLUB_THREAD_BODY_MAX), true],
    ["o jeden nad maksimum", chars(CLUB_THREAD_BODY_MAX + 1), false],
    ["same białe znaki", "\n\n\t ", false],
  ])("%s -> %s", (_label, value, expected) => {
    expect(threadBodyValid(value)).toBe(expected);
  });
});

describe("newThreadFormReady - jedna reguła dla przycisku i dla strażnika", () => {
  const OK = {
    title: chars(CLUB_THREAD_TITLE_MIN),
    body: chars(CLUB_THREAD_BODY_MIN),
    groupId: CLUB_IDS.group,
  };

  it("komplet poprawnych pól jest gotowy do wysyłki", () => {
    expect(newThreadFormReady(OK)).toBe(true);
  });

  it.each([
    ["bez działu", { groupId: "" }],
    ["tytuł za krótki", { title: "abc" }],
    ["treść za krótka", { body: "krotka" }],
    ["tytuł z samych spacji", { title: "     " }],
  ])("%s NIE jest gotowy", (_label, patch) => {
    expect(newThreadFormReady({ ...OK, ...patch })).toBe(false);
  });
});

// --- dział -----------------------------------------------------------------

describe("postableThreadGroups - droplista bez wyborów, które RPC odrzuci", () => {
  it("zostawia wyłącznie działy z prawem do założenia tematu", () => {
    const rows = [
      group({ id: "g-1", can_post_thread: false }),
      group({ id: "g-2", can_post_thread: true }),
      group({ id: "g-3", can_post_thread: false }),
    ];
    expect(postableThreadGroups(rows).map((row) => row.id)).toEqual(["g-2"]);
  });

  it("pusta lista działów daje pustą listę, a nie wyjątek", () => {
    expect(postableThreadGroups([])).toEqual([]);
  });

  it("przyjmuje pełny wiersz `club_groups_list` bez zawężania kolumn", () => {
    // Sanity kształtu: gdyby RPC zmieniło nazwę kolumny, ten test padnie
    // razem z typami, a nie dopiero w runtime na formularzu.
    const rows = [clubGroupRow({ can_post_thread: false }), clubGroupRow({ id: "g-9" })];
    expect(postableThreadGroups(rows).map((row) => row.id)).toEqual(["g-9"]);
  });
});

describe("resolveThreadGroupId - czym wypełnić droplistę przed pierwszym kliknięciem", () => {
  const POSTABLE = [{ id: "g-1" }, { id: "g-2" }];

  it("brak wyboru degraduje do PIERWSZEGO dozwolonego działu", () => {
    expect(resolveThreadGroupId("", POSTABLE)).toBe("g-1");
  });

  it("dział z adresu spoza listy dozwolonych jest ZASTĘPOWANY pierwszym dozwolonym", () => {
    expect(resolveThreadGroupId("g-zakazany", POSTABLE)).toBe("g-1");
  });

  it("wybór dozwolony zostaje - `null` znaczy „nie ruszaj”", () => {
    expect(resolveThreadGroupId("g-2", POSTABLE)).toBeNull();
  });

  it("pusta lista dozwolonych NIE kasuje wyboru (zapytanie jeszcze w locie)", () => {
    // Zerowanie pola w trakcie wczytywania działów mrugałoby wyborem
    // użytkownika i gasiło przycisk publikacji bez powodu.
    expect(resolveThreadGroupId("g-2", [])).toBeNull();
    expect(resolveThreadGroupId("", [])).toBeNull();
  });
});

// --- rodzaj wątku ----------------------------------------------------------

describe("threadKindChoices - ogłoszenie wymaga moderacji", () => {
  it("moderator widzi cały słownik rodzajów", () => {
    expect(threadKindChoices(true)).toContain("announcement");
  });

  it("zwykły członek NIE dostaje `announcement` na dropliście", () => {
    const kinds = threadKindChoices(false);
    expect(kinds).not.toContain("announcement");
    expect(kinds).toContain("discussion");
    expect(kinds.length).toBe(threadKindChoices(true).length - 1);
  });
});

describe("resolveThreadKind - wartość z adresu nie ma prawa zablokować publikacji", () => {
  it.each([
    ["ogłoszenie bez uprawnienia", "announcement", false, "discussion"],
    ["ogłoszenie z uprawnieniem", "announcement", true, "announcement"],
    ["pytanie bez uprawnienia", "question", false, "question"],
    ["stanowisko z uprawnieniem", "position", true, "position"],
  ] as const)("%s -> %s", (_label, kind, canModerate, expected) => {
    expect(resolveThreadKind(kind, canModerate)).toBe(expected);
  });
});

describe("defaultLockReplies - ogłoszenie domyślnie jest komunikatem", () => {
  it.each([
    ["announcement", true],
    ["discussion", false],
    ["question", false],
    ["poll", false],
  ] as const)("%s -> %s", (kind, expected) => {
    expect(defaultLockReplies(kind)).toBe(expected);
  });
});

// --- atrybucja -------------------------------------------------------------

describe("baseAttributionMode - zasada DZIEDZICZY DZIAŁ, nie klub", () => {
  it("wybrany dział przykrywa ustawienie klubu", () => {
    // To jest ten błąd: dział prowadzony w regule Chatham House pokazywał
    // ustawienia klubu, więc przełącznik anonimowości pojawiał się tam, gdzie
    // RPC go odrzuca.
    const rows = [group({ id: "g-1", attribution_mode: "chatham" })];
    expect(baseAttributionMode(rows, "g-1", "anonymous_allowed")).toBe("chatham");
  });

  it("dział bez rozstrzygniętej zasady spada na klub", () => {
    const rows = [group({ id: "g-1", attribution_mode: null })];
    expect(baseAttributionMode(rows, "g-1", "anonymous_allowed")).toBe("anonymous_allowed");
  });

  it("brak działu w liście (jeszcze się nie wczytały) spada na klub", () => {
    expect(baseAttributionMode([], "g-1", "chatham")).toBe("chatham");
  });

  it("brak jednego i drugiego daje `null` = zasady nie pokazujemy", () => {
    expect(baseAttributionMode([], "g-1", null)).toBeNull();
  });

  it.each([
    ["napis spoza słownika w dziale", [group({ id: "g-1", attribution_mode: "posrednie" })], null],
    ["pusty napis w dziale", [group({ id: "g-1", attribution_mode: "" })], null],
  ])("%s degraduje do `null`", (_label, rows, expected) => {
    expect(baseAttributionMode(rows, "g-1", null)).toBe(expected);
  });

  it("napis spoza słownika w KLUBIE też degraduje do `null`", () => {
    expect(baseAttributionMode([], "g-1", "cokolwiek")).toBeNull();
  });

  it("przyjmuje pełny wiersz `club_view` jako źródło zasady klubu", () => {
    const club = clubViewRow({ attribution_mode: "chatham" });
    expect(baseAttributionMode([], "g-nieznany", club.attribution_mode)).toBe("chatham");
  });
});

describe("attributionOverrideChoices - autor może zasadę wyłącznie ZAOSTRZYĆ", () => {
  it("moderator dostaje cały słownik", () => {
    expect(attributionOverrideChoices(true, "attributed")).toEqual([
      "attributed",
      "chatham",
      "anonymous_allowed",
    ]);
  });

  it("moderator dostaje cały słownik także bez rozstrzygniętej zasady bazowej", () => {
    expect(attributionOverrideChoices(true, null).length).toBe(3);
  });

  it("członek w dziale `attributed` może zaostrzyć do Chatham House", () => {
    expect(attributionOverrideChoices(false, "attributed")).toEqual(["chatham"]);
  });

  it("członek w dziale `anonymous_allowed` też może zaostrzyć do Chatham House", () => {
    expect(attributionOverrideChoices(false, "anonymous_allowed")).toEqual(["chatham"]);
  });

  it.each([
    ["dział już w Chatham House", "chatham" as const],
    ["zasada nierozstrzygnięta", null],
  ])("%s nie daje członkowi ŻADNEGO wyboru (droplista się nie pokazuje)", (_label, base) => {
    expect(attributionOverrideChoices(false, base)).toEqual([]);
  });
});

describe("isAttributionOverrideAllowed - zmiana działu unieważnia wybór", () => {
  it("wybór spoza dozwolonych jest odrzucany (powrót do dziedziczenia)", () => {
    expect(isAttributionOverrideAllowed("anonymous_allowed", ["chatham"])).toBe(false);
  });

  it("wybór z listy zostaje", () => {
    expect(isAttributionOverrideAllowed("chatham", ["chatham"])).toBe(true);
  });

  it("brak nadpisania jest zawsze dozwolony - „dziedzicz” nie da się unieważnić", () => {
    expect(isAttributionOverrideAllowed(null, [])).toBe(true);
  });
});

describe("effectiveAttributionMode i canPostAnonymously", () => {
  it("nadpisanie wygrywa z dziedziczeniem", () => {
    expect(effectiveAttributionMode("chatham", "anonymous_allowed")).toBe("chatham");
  });

  it("bez nadpisania obowiązuje zasada działu", () => {
    expect(effectiveAttributionMode(null, "anonymous_allowed")).toBe("anonymous_allowed");
  });

  it("bez jednego i drugiego zasada jest nieznana", () => {
    expect(effectiveAttributionMode(null, null)).toBeNull();
  });

  it.each([
    ["anonymous_allowed", "anonymous_allowed" as const, true],
    ["chatham", "chatham" as const, false],
    ["attributed", "attributed" as const, false],
    ["zasada nieznana", null, false],
  ])("anonimowy głos przy %s -> %s", (_label, effective, expected) => {
    // Chatham House ukrywa uczestników w PREZENTACJI - to nie jest zgoda na
    // anonimowe autorstwo, więc przełącznik nie ma się tam pokazywać.
    expect(canPostAnonymously(effective)).toBe(expected);
  });
});

describe("droplista nadpisania - wartownik „dziedzicz”", () => {
  it("brak nadpisania pokazuje wartownika, nie pustą wartość", () => {
    expect(attributionSelectValue(null)).toBe(NEW_THREAD_ATTRIBUTION_INHERIT);
  });

  it("wybrany tryb jest wartością dropListy", () => {
    expect(attributionSelectValue("chatham")).toBe("chatham");
  });

  it.each([
    ["wartownik", NEW_THREAD_ATTRIBUTION_INHERIT, null],
    ["napis spoza słownika", "cokolwiek", null],
    ["pusty napis", "", null],
    ["tryb ze słownika", "anonymous_allowed", "anonymous_allowed"],
  ])("odczyt wyboru: %s -> %s", (_label, value, expected) => {
    expect(readAttributionSelection(value)).toBe(expected);
  });

  it("bez zasady bazowej etykieta mówi wprost „podpisane”, nie „dziedzicz nieznane”", () => {
    expect(attributionInheritLabel(null)).toEqual({
      key: "club.attribution.attributed",
      modeKey: null,
    });
  });

  it.each(["attributed", "chatham", "anonymous_allowed"] as const)(
    "z zasadą %s etykieta niesie KLUCZ nazwy zasady jako parametr",
    (base) => {
      expect(attributionInheritLabel(base)).toEqual({
        key: "club.composer.participantAnonymityInherit",
        modeKey: `club.attribution.${base}`,
      });
    },
  );

  it.each([
    ["chatham", "chatham" as const, "club.composer.participantAnonymityChatham"],
    ["attributed", "attributed" as const, "club.composer.participantAnonymityHint"],
    ["zasada nieznana", null, "club.composer.participantAnonymityHint"],
  ])("podpowiedź przy %s", (_label, effective, expected) => {
    expect(attributionHintKey(effective)).toBe(expected);
  });
});

// --- widoczność pól --------------------------------------------------------

describe("newThreadFieldVisibility - pięć warunków jako jeden deskryptor", () => {
  const BASE = {
    kind: "discussion",
    canModerate: false,
    effectiveAttribution: null,
    attributionChoiceCount: 0,
  } as const;

  it("stan minimalny: żadne pole warunkowe się nie pokazuje", () => {
    expect(newThreadFieldVisibility(BASE)).toEqual({
      attributionNote: false,
      attributionOverride: false,
      announcementPinnedNote: false,
      lockReplies: false,
      anonymousToggle: false,
    });
  });

  it("nota o zasadzie autorstwa pojawia się z ROZSTRZYGNIĘTĄ zasadą", () => {
    const fields = newThreadFieldVisibility({ ...BASE, effectiveAttribution: "chatham" });
    expect(fields.attributionNote).toBe(true);
    expect(fields.anonymousToggle).toBe(false);
  });

  it("przełącznik anonimowości TYLKO przy `anonymous_allowed`", () => {
    const fields = newThreadFieldVisibility({
      ...BASE,
      effectiveAttribution: "anonymous_allowed",
    });
    expect(fields.anonymousToggle).toBe(true);
  });

  it.each([
    ["brak wyborów", 0, false],
    ["jedno zaostrzenie", 1, true],
    ["cały słownik", 3, true],
  ])("droplista zaostrzenia przy %s -> %s", (_label, count, expected) => {
    expect(
      newThreadFieldVisibility({ ...BASE, attributionChoiceCount: count }).attributionOverride,
    ).toBe(expected);
  });

  it("ostrzeżenie o przypięciu należy do rodzaju `announcement`", () => {
    expect(newThreadFieldVisibility({ ...BASE, kind: "announcement" }).announcementPinnedNote).toBe(
      true,
    );
    expect(newThreadFieldVisibility({ ...BASE, kind: "poll" }).announcementPinnedNote).toBe(false);
  });

  it("przełącznik zamknięcia odpowiedzi jest uprawnieniem moderacyjnym", () => {
    expect(newThreadFieldVisibility({ ...BASE, canModerate: true }).lockReplies).toBe(true);
  });
});

// --- bramka ----------------------------------------------------------------

describe("canComposeThread i newThreadDenialKey - kto widzi formularz", () => {
  it("klub z prawem do zakładania tematów wpuszcza do kompozytora", () => {
    expect(canComposeThread(clubViewRow({ can_post_thread: true }))).toBe(true);
  });

  it.each([
    ["brak klubu (404 albo awaria RPC)", null],
    ["klub bez prawa do zakładania tematów", clubViewRow({ can_post_thread: false })],
  ])("%s nie wpuszcza", (_label, club) => {
    expect(canComposeThread(club)).toBe(false);
  });

  it("powód z `club_view` trafia do klucza i18n", () => {
    expect(newThreadDenialKey({ reason: "tier_too_low" })).toBe("club.reason.tier_too_low");
  });

  it.each([
    ["brak klubu", null],
    ["pusty powód", { reason: "" }],
    ["powód NULL", { reason: null }],
  ])("%s degraduje do zdania ogólnego, a nie do klucza bez ogona", (_label, club) => {
    // `club.reason.` bez ogona renderowałby surowy identyfikator na ekranie.
    expect(newThreadDenialKey(club)).toBe("club.cannotPost");
  });
});

// --- payload ---------------------------------------------------------------

describe("buildNewThreadPayload - kształt argumentów `club_create_thread`", () => {
  function state(overrides: Partial<NewThreadFormState> = {}): NewThreadFormState {
    return {
      groupId: CLUB_IDS.group,
      title: "  Korytarz północ-południe  ",
      body: "  Treść tematu z odstępami na brzegach.  ",
      kind: "discussion",
      anonymous: false,
      lockReplies: false,
      canModerate: false,
      topic: "energy",
      icon: null,
      anchor: null,
      attributionOverride: null,
      idempotencyKey: "club_create_thread:test-1",
      ...overrides,
    };
  }

  it("kompletny payload dla zwykłego członka", () => {
    expect(buildNewThreadPayload(state())).toEqual({
      groupId: CLUB_IDS.group,
      title: "Korytarz północ-południe",
      body: "Treść tematu z odstępami na brzegach.",
      kind: "discussion",
      anonymous: false,
      anchorType: null,
      anchorId: null,
      idempotencyKey: "club_create_thread:test-1",
      lockReplies: false,
      topic: "energy",
      icon: null,
      attributionMode: null,
    });
  });

  it("tytuł i treść jadą PRZYCIĘTE - tą samą wartością, którą sprawdza walidacja", () => {
    const payload = buildNewThreadPayload(state({ title: "   Tytuł   ", body: "   Treść   " }));
    expect(payload.title).toBe("Tytuł");
    expect(payload.body).toBe("Treść");
  });

  it("kotwica rozpada się na dwa pola", () => {
    const payload = buildNewThreadPayload(
      state({ anchor: { anchorType: "eu_policy_item", anchorId: "pol-1" } }),
    );
    expect(payload.anchorType).toBe("eu_policy_item");
    expect(payload.anchorId).toBe("pol-1");
  });

  it("brak kotwicy daje DWA `null`, nie `undefined`", () => {
    const payload = buildNewThreadPayload(state({ anchor: null }));
    expect(payload.anchorType).toBeNull();
    expect(payload.anchorId).toBeNull();
  });

  it.each([
    ["moderator z włączonym zamknięciem", true, true, true],
    ["moderator z wyłączonym zamknięciem", true, false, false],
    ["członek z włączonym przełącznikiem w stanie", false, true, false],
    ["członek bez zamknięcia", false, false, false],
  ])("`lockReplies` przy %s -> %s", (_label, canModerate, lockReplies, expected) => {
    // Bez tego warunku zwykły członek dostawał odmowę za pole, którego nawet
    // nie widział - stan mógł zostać po utracie uprawnienia moderacyjnego.
    expect(buildNewThreadPayload(state({ canModerate, lockReplies })).lockReplies).toBe(expected);
  });

  it.each([
    ["nazwa z katalogu", "shield", "shield"],
    ["nazwa z katalogu z wielkiej litery i odstępami", "  Shield  ", "shield"],
    ["nazwa spoza katalogu", "nie-ma-takiej-ikony", null],
    ["pusty napis", "", null],
    ["brak wyboru", null, null],
  ])("ikona: %s -> %s", (_label, icon, expected) => {
    expect(buildNewThreadPayload(state({ icon })).icon).toBe(expected);
  });

  it("obszar tematyczny jedzie w postaci, w jakiej go wybrano (także `null`)", () => {
    expect(buildNewThreadPayload(state({ topic: null })).topic).toBeNull();
    expect(buildNewThreadPayload(state({ topic: "digital" })).topic).toBe("digital");
  });

  it("`attributionMode` niesie SUROWE nadpisanie, a nie zasadę efektywną", () => {
    // `null` = „dziedzicz dział”. Wysłanie wartości efektywnej zamrażałoby
    // w wątku stan działu z chwili pisania - a dział może się zmienić.
    expect(buildNewThreadPayload(state({ attributionOverride: null })).attributionMode).toBeNull();
    expect(buildNewThreadPayload(state({ attributionOverride: "chatham" })).attributionMode).toBe(
      "chatham",
    );
  });

  it("payload jest przyjmowany przez `CreateThreadVars` bez rzutowania", () => {
    // Sanity kontraktu z hookiem mutacji: rozjazd pola wychodzi na typach
    // w tym pliku, a nie w runtime na formularzu.
    const vars: CreateThreadVars = buildNewThreadPayload(state());
    expect(vars.groupId).toBe(CLUB_IDS.group);
  });
});

// --- wynik publikacji ------------------------------------------------------

describe("newThreadOutcome - gdzie wylądować po publikacji", () => {
  it("wpis w premoderacji NIE prowadzi do wątku", () => {
    // Strona wątku odpowiedziałaby odmową: autor nie ma prawa czytać treści
    // czekającej na dopuszczenie.
    expect(newThreadOutcome({ slug: "temat-pierwszy", status: "pending" })).toEqual({
      toastKey: "club.threadPending",
      threadSlug: null,
    });
  });

  it.each(["open", "published", "cokolwiek-nowego-w-slowniku"])(
    "status `%s` otwiera utworzony wątek",
    (status) => {
      expect(newThreadOutcome({ slug: "temat-pierwszy", status })).toEqual({
        toastKey: "club.threadCreated",
        threadSlug: "temat-pierwszy",
      });
    },
  );
});
