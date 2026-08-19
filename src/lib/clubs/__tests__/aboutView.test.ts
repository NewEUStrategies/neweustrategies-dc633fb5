// Reguły wejścia do klubu, wyprowadzone z JSX-a trasy `/club/$clubSlug/about`.
//
// CO TEN PLIK DOWODZI. Strona „o klubie" jest miejscem, w którym człowiek
// poznaje warunki i podejmuje decyzję - więc każda z tych czterech reguł ma
// skutek poza ekranem:
//
//   1. KOMPLET WARUNKÓW. Cztery odznaki (widoczność, polityka wstępu, tryb
//      autorstwa, kto może pisać) to zestaw ustaleń, na które użytkownik godzi
//      się PRZED wejściem - jego treść zostaje w klubie także po usunięciu
//      konta (V1 §7). Zgubiona odznaka nie psuje niczego widocznego, dlatego
//      komplet i kolejność są tu asercją, a nie układem.
//   2. TRZY ROZŁĄCZNE STANY PANELU AKCJI i ich KOLEJNOŚĆ: członkostwo bije
//      politykę wstępu (członek klubu „na zaproszenie" musi dostać swój panel),
//      polityka bije domyślny przycisk (`invite` nie ma ścieżki
//      samoobsługowej). Przycisk z etykietą „dołącz" tam, gdzie klub wymaga
//      zatwierdzenia, obiecuje wejście, którego RPC nie dowiezie.
//   3. AKCEPTACJA ZASAD tylko od CZŁONKA i tylko RAZ.
//   4. POZIOM POWIADOMIEŃ czytany z MOJEGO wiersza członkostwa. Był tu literał
//      „digest", więc kontrolka pokazywała ten poziom każdemu: użytkownik
//      ustawiał „wszystkie", dostawał zielony toast i natychmiast widział
//      z powrotem „skrót".
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. Mapowania komunikatu Postgresa na kod
// (`toClubInviteError`) - to `inviteErrors.test.ts`; tu sprawdzamy wyłącznie
// SKŁADANIE klucza i18n z kodu oraz domysł dla kodu nieznanego. Normalizacji
// poziomu powiadomień (`toClubNotifyLevel`) - to `clubTypes.test.ts`; tu liczy
// się WYBÓR wiersza. Autorytetu dostępu: `my_status` i `join_policy` pochodzą
// z SECURITY DEFINER RPC i mają pgTAP - te funkcje je czytają, nie liczą.
// Sklejenia z trasą (co robi kliknięcie, jaki toast leci) -
// `clubAboutRoute.test.tsx`.
import { describe, expect, it } from "vitest";
import {
  clubAboutAction,
  clubAboutErrorKey,
  clubAboutTermKeys,
  clubJoinToastKey,
  clubRulesAcceptVisible,
  myClubNotifyLevel,
  type ClubAboutTermsRow,
  type ClubNotifyLevelRow,
} from "@/lib/clubs/aboutView";
import {
  CLUB_ATTRIBUTION_MODES,
  CLUB_INVITE_ERRORS,
  CLUB_JOIN_POLICIES,
  CLUB_POST_POLICIES,
  CLUB_VISIBILITIES,
} from "@/lib/clubs/types";
import { CLUB_IDS, CLUB_BASE_ISO } from "@/test/clubs/fixtures";
import { clubEn, clubPl } from "@/lib/i18n-club";

/** Odczyt klucza i18n z drzewa słownika - `undefined`, gdy klucza nie ma. */
function readKey(tree: unknown, key: string): unknown {
  return key.split(".").reduce<unknown>((acc, part) => {
    if (acc !== null && typeof acc === "object" && part in acc) {
      return (acc as Record<string, unknown>)[part];
    }
    return undefined;
  }, tree);
}

function terms(overrides: Partial<ClubAboutTermsRow> = {}): ClubAboutTermsRow {
  return {
    visibility: "public",
    join_policy: "request",
    attribution_mode: "chatham",
    who_can_post: "members",
    ...overrides,
  };
}

/** Statusy, które NIE są członkostwem - każdy widzi drogę do środka. */
const NIE_CZLONEK = ["pending", "invited", "left", "banned", "", "ACTIVE"];

// --- clubAboutTermKeys -----------------------------------------------------

describe("clubAboutTermKeys - komplet warunków członkostwa", () => {
  it("składa cztery klucze w ustalonej kolejności", () => {
    // Wartości są tu RÓŻNE między polami, więc przestawienie dwóch pól
    // w składaniu klucza wychodzi natychmiast - na jednakowych nie wyszłoby.
    expect(
      clubAboutTermKeys(
        terms({
          visibility: "secret",
          join_policy: "invite",
          attribution_mode: "attributed",
          who_can_post: "staff_only",
        }),
      ),
    ).toEqual([
      "club.visibility.secret",
      "club.joinPolicy.invite",
      "club.attribution.attributed",
      "club.whoCanPost.staff_only",
    ]);
  });

  it("zawsze cztery pozycje - żaden warunek nie jest opcjonalny", () => {
    expect(clubAboutTermKeys(terms())).toHaveLength(4);
  });

  it.each(CLUB_VISIBILITIES)("widoczność `%s` ma tłumaczenie w PL i EN", (value) => {
    const [key] = clubAboutTermKeys(terms({ visibility: value }));
    expect(typeof readKey(clubPl, key)).toBe("string");
    expect(typeof readKey(clubEn, key)).toBe("string");
  });

  it.each(CLUB_JOIN_POLICIES)("polityka wstępu `%s` ma tłumaczenie w PL i EN", (value) => {
    const key = clubAboutTermKeys(terms({ join_policy: value }))[1];
    expect(typeof readKey(clubPl, key)).toBe("string");
    expect(typeof readKey(clubEn, key)).toBe("string");
  });

  it.each(CLUB_ATTRIBUTION_MODES)("tryb autorstwa `%s` ma tłumaczenie w PL i EN", (value) => {
    const key = clubAboutTermKeys(terms({ attribution_mode: value }))[2];
    expect(typeof readKey(clubPl, key)).toBe("string");
    expect(typeof readKey(clubEn, key)).toBe("string");
  });

  it.each(CLUB_POST_POLICIES)("prawo do zakładania tematu `%s` ma tłumaczenie", (value) => {
    const key = clubAboutTermKeys(terms({ who_can_post: value }))[3];
    expect(typeof readKey(clubPl, key)).toBe("string");
    expect(typeof readKey(clubEn, key)).toBe("string");
  });

  it("wartość spoza słownika NIE wypada z listy - awaria ma być widoczna", () => {
    // Nowa wartość w CHECK-u bazy bez wpisu w słowniku wyrenderuje surowy
    // klucz. To dobrze: cicha luka w warunkach członkostwa jest gorsza.
    const keys = clubAboutTermKeys(terms({ visibility: "cooperative" }));
    expect(keys).toHaveLength(4);
    expect(keys[0]).toBe("club.visibility.cooperative");
  });

  it("puste wartości też składają klucz, zamiast urwać listę", () => {
    expect(clubAboutTermKeys(terms({ join_policy: "" }))[1]).toBe("club.joinPolicy.");
  });
});

// --- clubAboutAction -------------------------------------------------------

describe("clubAboutAction - co wolno zrobić na tej stronie", () => {
  it.each(CLUB_JOIN_POLICIES)("gość nie dostaje panelu akcji (polityka `%s`)", (joinPolicy) => {
    // Dołączenie bez sesji kończy się `auth_required` po stronie RPC, więc
    // przycisk byłby obietnicą odmowy.
    expect(clubAboutAction({ signedIn: false, myStatus: "active", joinPolicy })).toBeNull();
  });

  it.each(CLUB_JOIN_POLICIES)(
    "członek dostaje panel członka niezależnie od polityki `%s`",
    (joinPolicy) => {
      expect(clubAboutAction({ signedIn: true, myStatus: "active", joinPolicy })).toEqual({
        kind: "membership",
      });
    },
  );

  it("KOLEJNOŚĆ: członkostwo bije politykę `invite`", () => {
    // Odwrotna kolejność pokazywałaby członkowi klubu zamkniętego zdanie
    // „wejście wyłącznie na zaproszenie" zamiast jego własnych ustawień.
    expect(clubAboutAction({ signedIn: true, myStatus: "active", joinPolicy: "invite" })).toEqual({
      kind: "membership",
    });
  });

  it.each(NIE_CZLONEK)("status `%s` NIE jest członkostwem - widzi drogę do środka", (myStatus) => {
    expect(clubAboutAction({ signedIn: true, myStatus, joinPolicy: "open" })).toEqual({
      kind: "join",
      labelKey: "club.join",
    });
  });

  it("brak wiersza członkostwa (`null`) też prowadzi do przycisku wejścia", () => {
    expect(clubAboutAction({ signedIn: true, myStatus: null, joinPolicy: "open" })).toEqual({
      kind: "join",
      labelKey: "club.join",
    });
  });

  it("klub `invite` mówi zdaniem, a nie martwym przyciskiem", () => {
    expect(clubAboutAction({ signedIn: true, myStatus: null, joinPolicy: "invite" })).toEqual({
      kind: "inviteOnly",
      noticeKey: "adminClubs.invitations.error.invitation_required",
    });
  });

  it("klub `open` obiecuje wejście, klub `request` - prośbę", () => {
    const open = clubAboutAction({ signedIn: true, myStatus: null, joinPolicy: "open" });
    const request = clubAboutAction({ signedIn: true, myStatus: null, joinPolicy: "request" });
    expect(open).toEqual({ kind: "join", labelKey: "club.join" });
    expect(request).toEqual({ kind: "join", labelKey: "club.requestJoin" });
  });

  it.each(["", "sponsored", "OPEN"])(
    "polityka `%s` spoza słownika degraduje się do prośby, nie do obietnicy",
    (joinPolicy) => {
      expect(clubAboutAction({ signedIn: true, myStatus: null, joinPolicy })).toEqual({
        kind: "join",
        labelKey: "club.requestJoin",
      });
    },
  );

  it("każdy klucz, który ta reguła zwraca, istnieje w PL i EN", () => {
    const keys = new Set<string>();
    for (const joinPolicy of [...CLUB_JOIN_POLICIES, "sponsored"]) {
      for (const myStatus of [null, "active", "pending"]) {
        const action = clubAboutAction({ signedIn: true, myStatus, joinPolicy });
        if (action === null || action.kind === "membership") continue;
        keys.add(action.kind === "inviteOnly" ? action.noticeKey : action.labelKey);
      }
    }
    expect(keys.size).toBe(3);
    for (const key of keys) {
      expect(typeof readKey(clubPl, key), `PL: ${key}`).toBe("string");
      expect(typeof readKey(clubEn, key), `EN: ${key}`).toBe("string");
    }
  });
});

// --- clubRulesAcceptVisible ------------------------------------------------

describe("clubRulesAcceptVisible - tylko członek i tylko raz", () => {
  it("członek bez akceptacji dostaje przycisk", () => {
    expect(clubRulesAcceptVisible({ myStatus: "active", rulesAcceptedAt: null })).toBe(true);
  });

  it("członek, który już zaakceptował, nie jest pytany drugi raz", () => {
    expect(clubRulesAcceptVisible({ myStatus: "active", rulesAcceptedAt: CLUB_BASE_ISO })).toBe(
      false,
    );
  });

  it.each(NIE_CZLONEK)("status `%s` nie ma czego akceptować", (myStatus) => {
    expect(clubRulesAcceptVisible({ myStatus, rulesAcceptedAt: null })).toBe(false);
  });

  it("brak członkostwa (`null`) też nie pyta o zasady", () => {
    expect(clubRulesAcceptVisible({ myStatus: null, rulesAcceptedAt: null })).toBe(false);
  });

  it("pusty znacznik czasu to NIE brak akceptacji", () => {
    // Jedynym stanem „jeszcze nie przyjął" jest `null`. Puste napisy z bazy
    // tu nie przychodzą, ale gdyby przyszły, powtórne pytanie byłoby błędem.
    expect(clubRulesAcceptVisible({ myStatus: "active", rulesAcceptedAt: "" })).toBe(false);
  });
});

// --- clubJoinToastKey ------------------------------------------------------

describe("clubJoinToastKey - RPC oddaje STATUS, nie sukces", () => {
  it("`active` znaczy jesteś w środku", () => {
    expect(clubJoinToastKey("active")).toBe("club.joined");
  });

  it.each(["pending", "", "invited", "ACTIVE"])(
    "status `%s` znaczy prośba czeka - komunikat nie może ogłaszać wejścia",
    (status) => {
      expect(clubJoinToastKey(status)).toBe("club.joinRequested");
    },
  );

  it("oba komunikaty istnieją w PL i EN", () => {
    for (const key of [clubJoinToastKey("active"), clubJoinToastKey("pending")]) {
      expect(typeof readKey(clubPl, key), `PL: ${key}`).toBe("string");
      expect(typeof readKey(clubEn, key), `EN: ${key}`).toBe("string");
    }
  });
});

// --- clubAboutErrorKey -----------------------------------------------------

describe("clubAboutErrorKey - kod ze słownika RPC dostaje własne zdanie", () => {
  it("znany kod składa klucz w gałęzi zaproszeń", () => {
    expect(clubAboutErrorKey(new Error("clubs: invitation required"))).toBe(
      "adminClubs.invitations.error.invitation_required",
    );
  });

  it("blokada dostępu ma własne zdanie, nie ogólne niepowodzenie zapisu", () => {
    expect(clubAboutErrorKey(new Error("clubs: user is banned from this club"))).toBe(
      "adminClubs.invitations.error.banned",
    );
  });

  it.each([
    new Error("nieznany wyjątek"),
    new Error(""),
    "surowy napis",
    null,
    undefined,
    { code: "42501" },
  ])("wejście bez rozpoznanego kodu degraduje się do ogólnego komunikatu", (error) => {
    expect(clubAboutErrorKey(error)).toBe("adminClubs.saveFailed");
  });

  it("KAŻDY kod ze słownika ma zdanie w PL i EN", () => {
    // Bez tego dopisanie kodu w migracji dawałoby na produkcji surowy klucz
    // `adminClubs.invitations.error.<kod>` w toaście.
    for (const code of CLUB_INVITE_ERRORS) {
      const key = `adminClubs.invitations.error.${code}`;
      expect(typeof readKey(clubPl, key), `PL: ${key}`).toBe("string");
      expect(typeof readKey(clubEn, key), `EN: ${key}`).toBe("string");
    }
    expect(typeof readKey(clubPl, "adminClubs.saveFailed")).toBe("string");
    expect(typeof readKey(clubEn, "adminClubs.saveFailed")).toBe("string");
  });
});

// --- myClubNotifyLevel -----------------------------------------------------

describe("myClubNotifyLevel - poziom z MOJEGO wiersza członkostwa", () => {
  function row(overrides: Partial<ClubNotifyLevelRow> = {}): ClubNotifyLevelRow {
    return { club_id: CLUB_IDS.club, notify_level: "all", ...overrides };
  }

  it("czyta poziom z wiersza TEGO klubu", () => {
    expect(myClubNotifyLevel([row({ notify_level: "mentions" })], CLUB_IDS.club)).toBe("mentions");
  });

  it("NIE bierze poziomu z innego klubu - to był defekt literału", () => {
    const rows = [row({ club_id: CLUB_IDS.otherClub, notify_level: "none" })];
    expect(myClubNotifyLevel(rows, CLUB_IDS.club)).toBe("digest");
  });

  it("wybiera właściwy wiersz z listy wielu członkostw", () => {
    const rows = [
      row({ club_id: CLUB_IDS.otherClub, notify_level: "none" }),
      row({ club_id: CLUB_IDS.club, notify_level: "all" }),
    ];
    expect(myClubNotifyLevel(rows, CLUB_IDS.club)).toBe("all");
  });

  it("zapytanie W LOCIE (`undefined`) oddaje domyślny poziom kolumny", () => {
    expect(myClubNotifyLevel(undefined, CLUB_IDS.club)).toBe("digest");
  });

  it("pusta lista członkostw oddaje domyślny poziom", () => {
    expect(myClubNotifyLevel([], CLUB_IDS.club)).toBe("digest");
  });

  it("brak identyfikatoru klubu (karta jeszcze nie dojechała) nie zgaduje wiersza", () => {
    expect(myClubNotifyLevel([row({ notify_level: "none" })], undefined)).toBe("digest");
  });

  it.each(["", "weekly", "ALL"])(
    "poziom `%s` spoza słownika schodzi na domyślny, nie wywraca kontrolki",
    (notify_level) => {
      expect(myClubNotifyLevel([row({ notify_level })], CLUB_IDS.club)).toBe("digest");
    },
  );

  it("`none` (wyciszony klub) jest wartością POPRAWNĄ, nie brakiem wartości", () => {
    // `none` jest falsy w żadnym sensie, ale bywa mylone z „nie ustawiono".
    expect(myClubNotifyLevel([row({ notify_level: "none" })], CLUB_IDS.club)).toBe("none");
  });
});
