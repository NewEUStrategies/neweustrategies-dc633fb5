// Reguły strony wątku wyprowadzone z JSX-a trasy `/club/$clubSlug/t/$threadSlug`.
//
// CO TEN PLIK DOWODZI. Sześć reguł produktu, które przed wyprowadzeniem były
// wyrażeniami inline w drzewie znaczników najdłuższej trasy modułu (1 095 linii)
// i dały się sprawdzić wyłącznie przez zamontowanie jej z czternastoma atrapami
// zapytań:
//
//   1. CZTERY ETAPY WCZYTYWANIA SĄ ROZŁĄCZNE, a ich kolejność jest regułą:
//      oczekiwanie na wątek liczy się TYLKO przy istniejącym klubie (zapytanie
//      o wątek jest wyłączone bez id klubu, a wyłączone `useQuery` zostaje
//      w `isPending` na zawsze - stąd wieczny szkielet zamiast 404), a awaria
//      wygrywa nad pustką, bo pustka po awarii nie jest pustką.
//   2. UPRAWNIENIA POSTU liczą się z wiersza RPC i sesji, nie z trasy:
//      rozstrzygać wolno w wątku `question` autorowi albo moderacji, redakcja
//      gaśnie razem z zamknięciem wątku, a zgłoszenie dotyczy wpisu CUDZEGO
//      i tylko zalogowanego.
//   3. REGUŁA CHATHAM HOUSE: przy `author_id = null` z RPC żadne porównanie
//      z sesją nie ma prawa wyjść prawdziwe - także dla gościa, u którego
//      tożsamość też jest `null`. To jest ten jeden przypadek, w którym
//      `null === null` byłoby wyciekiem uprawnienia.
//   4. LICZNIK STRONY ODPOWIEDZI odróżnia ZAPYTANIE W LOCIE (`undefined`) od
//      zera odpowiedzi, mówi o ucięciu wprost i pokazuje droplistę porządków
//      dopiero od dwóch wpisów.
//   5. AKCJA ROZSTRZYGNIĘCIA ma trzy postacie i to one decydują o etykiecie
//      oraz o komunikacie: „oznacz” tam, gdzie nic nie jest rozstrzygnięte,
//      „przenieś” tam, gdzie już jest (bo klik ZDEJMIE decyzję z innego wpisu),
//      „cofnij” na wpisie rozstrzygającym.
//   6. UPRAWNIENIA ODPOWIEDZI pytają o STATUS, nie tylko o autorstwo - wpis
//      zdjęty przez moderację nie zachowuje przycisku redakcji - a przycisk
//      „Odpowiedz” gaśnie na drugim poziomie przyciętego drzewa.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE.
// - `isClubReplyLive`, `buildClubReplyTree`, `toAuthorLabel`, `groupReactions`
//   i `CLUB_REPLY_SORTS` mają własne zakresy w `clubTypes.test.ts`,
//   `replyTree.test.ts` i `reactions.test.ts` - tutaj są UŻYTE, nie sprawdzane
//   od nowa.
// - AUTORYTETU DOSTĘPU: `can_reply`, `can_moderate` i skrywanie `author_id`
//   pochodzą z SECURITY DEFINER RPC i mają pgTAP. Te funkcje wyłącznie CZYTAJĄ
//   to, co RPC oddało.
// - SKLEJENIA TRASY (co dostają zapytania, co robi formularz, jaki nagłówek
//   emituje): `src/routes/__tests__/clubThreadRoute.test.tsx`.
// - KOLEJNOŚCI HOOKÓW trasy: `threadRouteHookOrder.test.ts`.
import { describe, expect, it } from "vitest";
import {
  availableClubReplySorts,
  clubReactionTotal,
  clubRepliesMeter,
  clubReplyCapabilities,
  clubResolveAction,
  clubResolveToastKey,
  clubThreadCapabilities,
  clubThreadHasResolution,
  resolveClubThreadStage,
  CLUB_REPLY_MAX_DEPTH,
  CLUB_RESOLVE_LABEL_KEYS,
  type ClubReplyCapabilityInput,
  type ClubThreadCapabilityInput,
  type ClubThreadStageInput,
} from "@/lib/clubs/threadPageView";
import { CLUB_IDS } from "@/test/clubs/fixtures";

// --- etapy wczytywania ------------------------------------------------------

function stage(overrides: Partial<ClubThreadStageInput> = {}): ClubThreadStageInput {
  return {
    clubPending: false,
    clubMissing: false,
    threadPending: false,
    threadMissing: false,
    failed: false,
    ...overrides,
  };
}

describe("resolveClubThreadStage - cztery stany strony wątku", () => {
  it("komplet danych daje etap gotowy", () => {
    expect(resolveClubThreadStage(stage())).toBe("ready");
  });

  it("oczekiwanie na kartę klubu daje szkielet", () => {
    expect(resolveClubThreadStage(stage({ clubPending: true, clubMissing: true }))).toBe("loading");
  });

  it("oczekiwanie na wątek PRZY ISTNIEJĄCYM klubie daje szkielet", () => {
    expect(resolveClubThreadStage(stage({ threadPending: true, threadMissing: true }))).toBe(
      "loading",
    );
  });

  it("oczekiwanie na wątek BEZ klubu daje 404, nie wieczny szkielet", () => {
    // Zapytanie o wątek jest wyłączone, dopóki nie znamy id klubu, a wyłączone
    // `useQuery` zostaje w `isPending` na zawsze. Sklejenie tych dwóch stanów
    // zamieniało wejście na nieistniejący slug w stronę, która wiruje bez końca.
    expect(
      resolveClubThreadStage(stage({ clubMissing: true, threadPending: true, threadMissing: true })),
    ).toBe("missing");
  });

  it("AWARIA to nie 404 - poprawny link nie może wyglądać na martwy", () => {
    expect(resolveClubThreadStage(stage({ failed: true, threadMissing: true }))).toBe("error");
  });

  it("awaria PRZEGRYWA z oczekiwaniem - ponowienie w tle nie kasuje treści z ekranu", () => {
    expect(resolveClubThreadStage(stage({ failed: true, clubPending: true }))).toBe("loading");
  });

  it.each([
    ["pusty klub", { clubMissing: true }],
    ["pusty wątek", { threadMissing: true }],
  ])("zero wierszy (%s) to 404, a nie odmowa dostępu", (_label, overrides) => {
    // Klub `secret` bez dostępu nie ma prawa zdradzić, że istnieje - więc 404,
    // nie 403.
    expect(resolveClubThreadStage(stage(overrides))).toBe("missing");
  });
});

// --- uprawnienia postu otwierającego ---------------------------------------

function threadInput(
  overrides: Partial<ClubThreadCapabilityInput> = {},
): ClubThreadCapabilityInput {
  return {
    kind: "discussion",
    authorId: CLUB_IDS.member,
    canModerate: false,
    lockedAt: null,
    attributionMode: "named",
    viewerId: CLUB_IDS.me,
    signedIn: true,
    ...overrides,
  };
}

describe("clubThreadCapabilities - rozstrzyganie pytania", () => {
  it("autor pytania może wskazać odpowiedź rozstrzygającą", () => {
    const caps = clubThreadCapabilities(
      threadInput({ kind: "question", authorId: CLUB_IDS.me }),
    );
    expect(caps.canResolve).toBe(true);
  });

  it("moderacja może rozstrzygnąć CUDZE pytanie", () => {
    const caps = clubThreadCapabilities(threadInput({ kind: "question", canModerate: true }));
    expect(caps.canResolve).toBe(true);
  });

  it("czytelnik z ulicy nie rozstrzyga cudzego pytania", () => {
    expect(clubThreadCapabilities(threadInput({ kind: "question" })).canResolve).toBe(false);
  });

  it.each(["discussion", "position", "resource", "announcement", "poll"])(
    "wątek `%s` NIE ma rozstrzygnięcia - RPC odrzuci próbę, więc przycisk nie stoi",
    (kind) => {
      const caps = clubThreadCapabilities(threadInput({ kind, authorId: CLUB_IDS.me }));
      expect(caps.canResolve).toBe(false);
    },
  );

  it("rodzaj spoza słownika nie dostaje ani stanowisk, ani rozstrzygnięcia", () => {
    const caps = clubThreadCapabilities(
      threadInput({ kind: "briefing-z-przyszlosci", authorId: CLUB_IDS.me, canModerate: true }),
    );
    expect(caps.canResolve).toBe(false);
    expect(caps.isPosition).toBe(false);
  });
});

describe("clubThreadCapabilities - autorstwo pod regułą Chatham House", () => {
  it("zgodne identyfikatory znaczą MÓJ wpis", () => {
    expect(clubThreadCapabilities(threadInput({ authorId: CLUB_IDS.me })).isMine).toBe(true);
  });

  it("`author_id` skryte przez RPC NIE jest moim wpisem, choć jestem zalogowany", () => {
    // W klubie pod regułą Chatham House autorstwo nie wychodzi z bazy. Interfejs
    // nie ma prawa zdradzić, że to wpis czytającego - baza sprawdzi autorstwo
    // przy zapisie.
    expect(clubThreadCapabilities(threadInput({ authorId: null })).isMine).toBe(false);
  });

  it("gość przy skrytym autorstwie też nie dostaje cudzego wpisu na własność", () => {
    // `null === null` byłoby tu wyciekiem: gość zobaczyłby redakcję cudzego
    // wpisu w każdym klubie Chatham House.
    const caps = clubThreadCapabilities(
      threadInput({ authorId: null, viewerId: null, signedIn: false }),
    );
    expect(caps.isMine).toBe(false);
    expect(caps.canEdit).toBe(false);
  });
});

describe("clubThreadCapabilities - redakcja i zamknięcie wątku", () => {
  it("autor poprawia swój wpis", () => {
    expect(clubThreadCapabilities(threadInput({ authorId: CLUB_IDS.me })).canEdit).toBe(true);
  });

  it("moderacja poprawia każdy wpis", () => {
    expect(clubThreadCapabilities(threadInput({ canModerate: true })).canEdit).toBe(true);
  });

  it("ZAMKNIĘCIE wątku gasi redakcję także moderacji", () => {
    const caps = clubThreadCapabilities(
      threadInput({ canModerate: true, lockedAt: "2026-08-18T10:00:00.000Z" }),
    );
    expect(caps.canEdit).toBe(false);
  });

  it("obcy wpis w otwartym wątku nie ma redakcji", () => {
    expect(clubThreadCapabilities(threadInput()).canEdit).toBe(false);
  });
});

describe("clubThreadCapabilities - zgłoszenie", () => {
  it("zalogowany zgłasza CUDZY wpis", () => {
    expect(clubThreadCapabilities(threadInput()).canReport).toBe(true);
  });

  it("WŁASNEGO wpisu nie zgłasza nikt - RPC odrzuca to z 22023", () => {
    expect(clubThreadCapabilities(threadInput({ authorId: CLUB_IDS.me })).canReport).toBe(false);
  });

  it("gość nie zgłasza niczego - przycisk kończyłby się zawsze błędem", () => {
    const caps = clubThreadCapabilities(threadInput({ signedIn: false, viewerId: null }));
    expect(caps.canReport).toBe(false);
  });
});

describe("clubThreadCapabilities - anonimowość i porządki odpowiedzi", () => {
  it("anonimowość wolno włączyć tylko w trybie `anonymous_allowed`", () => {
    expect(
      clubThreadCapabilities(threadInput({ attributionMode: "anonymous_allowed" })).canGoAnonymous,
    ).toBe(true);
  });

  it.each(["named", "chatham", "", "anonymous"])(
    "tryb `%s` NIE otwiera przełącznika anonimowości",
    (attributionMode) => {
      expect(clubThreadCapabilities(threadInput({ attributionMode })).canGoAnonymous).toBe(false);
    },
  );

  it("wątek `position` dostaje mapę sporu", () => {
    const caps = clubThreadCapabilities(threadInput({ kind: "position" }));
    expect(caps.isPosition).toBe(true);
    expect(caps.replySorts).toEqual(["chronological", "best", "stance"]);
  });

  it("wątek bez stanowisk nie dostaje sortu `stance`", () => {
    expect(clubThreadCapabilities(threadInput()).replySorts).toEqual(["chronological", "best"]);
  });
});

describe("availableClubReplySorts", () => {
  it.each([
    [true, ["chronological", "best", "stance"]],
    [false, ["chronological", "best"]],
  ])("isPosition=%s daje %j", (isPosition, expected) => {
    expect(availableClubReplySorts(isPosition)).toEqual(expected);
  });
});

// --- licznik strony odpowiedzi ---------------------------------------------

describe("clubRepliesMeter - zapytanie w locie to NIE zero odpowiedzi", () => {
  it("`undefined` schodzi na zera i nie wywala się na `.length`", () => {
    expect(clubRepliesMeter(undefined)).toEqual({
      total: 0,
      shown: 0,
      truncated: false,
      sortPickerVisible: false,
    });
  });

  it("`null` traktujemy jak brak strony", () => {
    expect(clubRepliesMeter(null).total).toBe(0);
  });

  it("pełna strona nie jest ucięta", () => {
    const meter = clubRepliesMeter({ rows: [1, 2, 3], total: 3 });
    expect(meter).toEqual({ total: 3, shown: 3, truncated: false, sortPickerVisible: true });
  });

  it("strona krótsza od licznika JEST ucięta - milcząca różnica wygląda jak utrata treści", () => {
    const meter = clubRepliesMeter({ rows: [1, 2], total: 240 });
    expect(meter.truncated).toBe(true);
    expect(meter.shown).toBe(2);
  });

  it("licznik MNIEJSZY od strony nie udaje ucięcia", () => {
    // Denormalizacja może się spóźnić za wstawieniem wiersza; „-1 pozostało”
    // byłoby zdaniem bez sensu.
    expect(clubRepliesMeter({ rows: [1, 2, 3], total: 2 }).truncated).toBe(false);
  });

  it.each([
    [0, false],
    [1, false],
    [2, true],
  ])("przy %i odpowiedziach droplista porządków widoczna=%s", (total, visible) => {
    expect(clubRepliesMeter({ rows: [], total }).sortPickerVisible).toBe(visible);
  });
});

describe("clubThreadHasResolution", () => {
  it("pusta lista nie ma rozstrzygnięcia", () => {
    expect(clubThreadHasResolution([])).toBe(false);
  });

  it("jedna flaga wśród wielu wpisów wystarczy", () => {
    expect(
      clubThreadHasResolution([{ is_resolution: false }, { is_resolution: true }]),
    ).toBe(true);
  });

  it("same wpisy bez flagi dają fałsz", () => {
    expect(clubThreadHasResolution([{ is_resolution: false }])).toBe(false);
  });
});

// --- rozstrzygnięcie -------------------------------------------------------

describe("clubResolveAction - trzy postacie tej samej operacji", () => {
  it.each([
    ["brak prawa", { canResolve: false, isResolution: false, hasResolution: false }, "none"],
    ["brak prawa na wpisie rozstrzygającym", { canResolve: false, isResolution: true, hasResolution: true }, "none"],
    ["pierwsze oznaczenie", { canResolve: true, isResolution: false, hasResolution: false }, "mark"],
    ["przeniesienie", { canResolve: true, isResolution: false, hasResolution: true }, "move"],
    ["cofnięcie", { canResolve: true, isResolution: true, hasResolution: true }, "unmark"],
  ])("%s daje `%s`", (_label, input, expected) => {
    expect(clubResolveAction(input)).toBe(expected);
  });

  it("wpis rozstrzygający wygrywa nad brakiem flagi w wątku", () => {
    // Stan niespójny (wpis oznaczony, wątek „bez rozstrzygnięcia”) ma prowadzić
    // do COFNIĘCIA tego wpisu, nie do jego powtórnego oznaczenia.
    expect(
      clubResolveAction({ canResolve: true, isResolution: true, hasResolution: false }),
    ).toBe("unmark");
  });

  it("etykiety trzech akcji są rozłącznymi kluczami i18n", () => {
    expect(CLUB_RESOLVE_LABEL_KEYS).toEqual({
      mark: "club.markResolution",
      move: "club.moveResolution",
      unmark: "club.unmarkResolution",
    });
  });
});

describe("clubResolveToastKey - komunikat mówi PRAWDĘ o tym, co się stało", () => {
  it("cofnięcie ma własne zdanie", () => {
    expect(clubResolveToastKey(null, true)).toBe("club.unresolvedToast");
  });

  it("cofnięcie w wątku bez rozstrzygnięcia to nadal cofnięcie", () => {
    expect(clubResolveToastKey(null, false)).toBe("club.unresolvedToast");
  });

  it("oznaczenie w wątku, który już coś miał, to PRZENIESIENIE", () => {
    expect(clubResolveToastKey(CLUB_IDS.reply, true)).toBe("club.movedResolutionToast");
  });

  it("pierwsze oznaczenie to rozstrzygnięcie", () => {
    expect(clubResolveToastKey(CLUB_IDS.reply, false)).toBe("club.resolvedToast");
  });
});

// --- uprawnienia jednej odpowiedzi ----------------------------------------

function replyInput(
  overrides: Partial<ClubReplyCapabilityInput> = {},
): ClubReplyCapabilityInput {
  return {
    authorId: CLUB_IDS.member,
    status: "visible",
    depth: 0,
    isResolution: false,
    viewerId: CLUB_IDS.me,
    canModerate: false,
    threadLocked: false,
    canResolve: false,
    hasResolution: false,
    ...overrides,
  };
}

describe("clubReplyCapabilities - redakcja pyta o STATUS wpisu", () => {
  it.each([
    ["visible", true],
    ["pending", true],
    ["hidden", false],
    ["deleted", false],
  ])("wpis o statusie `%s` ma redakcję=%s", (status, expected) => {
    // Poprzednia wersja sprawdzała `status !== "removed"`, a takiego statusu nie
    // ma w słowniku - warunek był zawsze prawdziwy i wpis zdjęty przez
    // moderację zachowywał przycisk redakcji.
    expect(clubReplyCapabilities(replyInput({ authorId: CLUB_IDS.me, status })).canEdit).toBe(
      expected,
    );
  });

  it("status spoza słownika NIE jest wpisem w obiegu", () => {
    expect(
      clubReplyCapabilities(replyInput({ authorId: CLUB_IDS.me, status: "removed" })).canEdit,
    ).toBe(false);
  });

  it("moderacja redaguje cudzy wpis", () => {
    expect(clubReplyCapabilities(replyInput({ canModerate: true })).canEdit).toBe(true);
  });

  it("zamknięty wątek gasi redakcję moderacji", () => {
    expect(
      clubReplyCapabilities(replyInput({ canModerate: true, threadLocked: true })).canEdit,
    ).toBe(false);
  });

  it("obcy wpis bez moderacji nie ma redakcji", () => {
    expect(clubReplyCapabilities(replyInput()).canEdit).toBe(false);
  });
});

describe("clubReplyCapabilities - zgłoszenie odpowiedzi", () => {
  it("zalogowany zgłasza cudzą odpowiedź", () => {
    expect(clubReplyCapabilities(replyInput()).canReport).toBe(true);
  });

  it("własnej odpowiedzi się nie zgłasza", () => {
    expect(clubReplyCapabilities(replyInput({ authorId: CLUB_IDS.me })).canReport).toBe(false);
  });

  it("gość nie zgłasza - i nie rozpoznaje autorstwa", () => {
    const caps = clubReplyCapabilities(replyInput({ authorId: null, viewerId: null }));
    expect(caps.canReport).toBe(false);
    expect(caps.isMine).toBe(false);
  });
});

describe("clubReplyCapabilities - głębokość przyciętego drzewa", () => {
  it.each([
    [0, true],
    [1, true],
    [CLUB_REPLY_MAX_DEPTH, false],
    [3, false],
  ])("odpowiedź na poziomie %i ma przycisk „Odpowiedz”=%s", (depth, expected) => {
    // Drzewo jest przycięte do dwóch poziomów; przycisk, który po cichu
    // przypina wpis gdzie indziej, wprowadza w błąd.
    expect(clubReplyCapabilities(replyInput({ depth })).canReplyTo).toBe(expected);
  });
});

describe("clubReplyCapabilities - akcja rozstrzygnięcia dojeżdża do wpisu", () => {
  it("bez prawa nie ma akcji", () => {
    expect(clubReplyCapabilities(replyInput()).resolveAction).toBe("none");
  });

  it("z prawem na wpisie rozstrzygającym akcją jest cofnięcie", () => {
    const caps = clubReplyCapabilities(
      replyInput({ canResolve: true, isResolution: true, hasResolution: true }),
    );
    expect(caps.resolveAction).toBe("unmark");
  });

  it("z prawem w wątku, który już ma rozstrzygnięcie, akcją jest przeniesienie", () => {
    const caps = clubReplyCapabilities(replyInput({ canResolve: true, hasResolution: true }));
    expect(caps.resolveAction).toBe("move");
  });
});

// --- reakcje ---------------------------------------------------------------

describe("clubReactionTotal", () => {
  it("pusta partia daje zero, nie `undefined`", () => {
    // `ClubReactionAvatars` pisze „+N” - `undefined` dałoby „+NaN”.
    expect(clubReactionTotal([])).toBe(0);
  });

  it("sumuje wszystkie rodzaje reakcji jednej partii", () => {
    expect(clubReactionTotal([{ total: 3 }, { total: 1 }, { total: 0 }])).toBe(4);
  });
});
