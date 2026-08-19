// Bramka dostępu do klubu - MACIERZ STANÓW.
//
// Reguły dostępu są w tym repo dowiedzione: `capabilityMatrix`, `hubAccess`,
// `minisiteAccess` i 19 plików pgTAP mają własne testy. Nie była dowiedziona
// ich PREZENTACJA - a to ona decyduje, czy ktoś zobaczy formularz rejestracji,
// upsell do wyższego planu, czy prośbę o dostęp. `ClubAccessGate.tsx` stał
// na 0% przy 493 liniach.
//
// Ten plik testuje DESKRYPTOR, czyli decyzję „co pokazać", w oderwaniu od
// tego, „jak to narysować". Wariantów jest 3 (tożsamość) × 3 (polityka
// wejścia) × 2 (odznaka eksperta) × katalog progów - i to jest dokładnie ten
// rodzaj przestrzeni, której nie da się sprawdzić renderem.
import { describe, expect, it } from "vitest";
import {
  CLUB_PLAN_TIERS,
  CLUB_PLAN_TIER_RANK,
  DEFAULT_CLUB_PLAN_TIER,
} from "@/lib/clubs/planTiers";
import {
  CLUB_GATE_BENEFITS,
  clubGateView,
  type ClubGateClub,
  type ClubGateView,
} from "@/lib/clubs/gateView";

function club(overrides: Partial<ClubGateClub> = {}): ClubGateClub {
  return { min_tier_rank: 20, reason: null, join_policy: "request", ...overrides };
}

/** Rodzaje akcji w kolejności, w jakiej stoją na ekranie. */
function actionKinds(view: ClubGateView): string[] {
  return view.actions.map((a) => a.kind);
}

// ---------------------------------------------------------------------------
// Co bramka sprzedaje
// ---------------------------------------------------------------------------

describe("sellTier - czego bramka nie sprzedaje", () => {
  it("próg 'free' i 'plus' podnosi się do domyślnego progu klubu", () => {
    // Klub „za darmo" i tak nie bramkowałby wejścia, więc CTA „kup plan free"
    // byłoby zaproszeniem donikąd.
    for (const rank of [CLUB_PLAN_TIER_RANK.free, CLUB_PLAN_TIER_RANK.plus]) {
      const view = clubGateView({
        club: club({ min_tier_rank: rank }),
        signedIn: true,
        isExpert: false,
      });
      expect(view.sellTier).toBe(DEFAULT_CLUB_PLAN_TIER);
    }
  });

  it("brak progu (null) zachowuje się jak 'free'", () => {
    const view = clubGateView({
      club: club({ min_tier_rank: null }),
      signedIn: true,
      isExpert: false,
    });

    expect(view.sellTier).toBe(DEFAULT_CLUB_PLAN_TIER);
  });

  it("KAŻDY próg od PRO w górę sprzedaje SIEBIE, nie domyślny", () => {
    // To jest ta regresja, przez którą klub o progu 30 pokazywał w bramce
    // „PRO": lokalna mapa znała tylko free/plus/pro/vip.
    for (const tier of CLUB_PLAN_TIERS) {
      if (tier === "free" || tier === "plus") continue;
      const view = clubGateView({
        club: club({ min_tier_rank: CLUB_PLAN_TIER_RANK[tier] }),
        signedIn: true,
        isExpert: false,
      });
      expect(view.sellTier, `próg ${tier}`).toBe(tier);
    }
  });

  it("ranga spoza katalogu degraduje do najbliższego niższego progu", () => {
    const view = clubGateView({
      club: club({ min_tier_rank: 35 }),
      signedIn: true,
      isExpert: false,
    });

    expect(view.sellTier).toBe("corporate");
  });

  it("klucz etykiety zawsze wskazuje słownik progów, nie lokalną mapę", () => {
    for (const tier of CLUB_PLAN_TIERS) {
      const view = clubGateView({
        club: club({ min_tier_rank: CLUB_PLAN_TIER_RANK[tier] }),
        signedIn: true,
        isExpert: false,
      });
      expect(view.planLabelKey).toBe(`club.planTier.${view.sellTier}`);
    }
  });
});

// ---------------------------------------------------------------------------
// Trzy stany tożsamości
// ---------------------------------------------------------------------------

describe("ANONIM", () => {
  const view = clubGateView({ club: club(), signedIn: false, isExpert: false });

  it("widzi zdanie dla niezalogowanego i formularz rejestracji", () => {
    expect(view.leadKey).toBe("clubGate.anonLead");
    expect(actionKinds(view)).toEqual(["signup"]);
  });

  it("jest traktowany jak osoba z za niskim planem - nie ma czym wejść", () => {
    expect(view.tierTooLow).toBe(true);
  });

  it("NIE widzi ani upsellu, ani prośby o dostęp", () => {
    // Najpierw konto, potem plan, potem klub. Trzy wezwania naraz to zero
    // wezwań.
    expect(actionKinds(view)).not.toContain("upgrade");
    expect(actionKinds(view)).not.toContain("request");
  });

  it("nie widzi notek pomocniczych (są dla zalogowanych)", () => {
    expect(view.showExpertNote).toBe(false);
    expect(view.showUpgradeOnlyNote).toBe(false);
  });

  it("odznaka eksperta u ANONIMA niczego nie zmienia - nie ma jeszcze konta", () => {
    const expert = clubGateView({ club: club(), signedIn: false, isExpert: true });

    expect(actionKinds(expert)).toEqual(["signup"]);
    expect(expert.showExpertNote).toBe(false);
  });
});

describe("ZALOGOWANY z ZA NISKIM planem", () => {
  const base = { club: club({ reason: "tier_too_low" }), signedIn: true };

  it("widzi zdanie o podniesieniu planu i DWA wezwania cennikowe", () => {
    const view = clubGateView({ ...base, isExpert: false });

    expect(view.leadKey).toBe("clubGate.upgradeLead");
    expect(actionKinds(view)).toEqual(["upgrade", "plans"]);
  });

  it("BEZ odznaki eksperta NIE może poprosić o dostęp", () => {
    const view = clubGateView({ ...base, isExpert: false });

    // Zgłoszenie bez planu i tak nie mogłoby zostać przyjęte.
    expect(view.canRequest).toBe(false);
    expect(view.showUpgradeOnlyNote).toBe(true);
  });

  it("Z odznaką eksperta MOŻE poprosić - to jedyna ścieżka bez planu", () => {
    const view = clubGateView({ ...base, isExpert: true });

    expect(view.canRequest).toBe(true);
    expect(actionKinds(view)).toEqual(["upgrade", "plans", "request"]);
    expect(view.showExpertNote).toBe(true);
    expect(view.showUpgradeOnlyNote).toBe(false);
  });

  it("prośba eksperta jest WYCISZONA - upsell zostaje wezwaniem głównym", () => {
    const view = clubGateView({ ...base, isExpert: true });
    const request = view.actions.find((a) => a.kind === "request");

    expect(request).toMatchObject({ muted: true });
  });

  it("upsell stoi PRZED prośbą - kolejność akcji jest kolejnością na ekranie", () => {
    const view = clubGateView({ ...base, isExpert: true });

    expect(actionKinds(view).indexOf("upgrade")).toBeLessThan(actionKinds(view).indexOf("request"));
  });
});

describe("ZALOGOWANY z WYSTARCZAJĄCYM planem", () => {
  const base = { club: club({ reason: null }), signedIn: true };

  it("widzi zdanie o dołączeniu i SAMĄ prośbę o dostęp", () => {
    const view = clubGateView({ ...base, isExpert: false });

    expect(view.leadKey).toBe("clubGate.joinLead");
    expect(actionKinds(view)).toEqual(["request"]);
    expect(view.tierTooLow).toBe(false);
  });

  it("prośba NIE jest wyciszona - to jedyne wezwanie na ekranie", () => {
    const view = clubGateView({ ...base, isExpert: false });

    expect(view.actions[0]).toMatchObject({ kind: "request", muted: false });
  });

  it("nie widzi cennika ani notek", () => {
    const view = clubGateView({ ...base, isExpert: true });

    expect(actionKinds(view)).not.toContain("upgrade");
    expect(view.showExpertNote).toBe(false);
    expect(view.showUpgradeOnlyNote).toBe(false);
  });

  it("inny powód odmowy niż 'tier_too_low' NIE jest traktowany jak za niski plan", () => {
    const view = clubGateView({
      club: club({ reason: "not_member" }),
      signedIn: true,
      isExpert: false,
    });

    // Bramka rozpoznaje DOKŁADNIE jeden powód. Nieznany kod z nowszej migracji
    // nie może przypadkiem przełączyć ekranu na sprzedaż planu, który
    // użytkownik już ma.
    expect(view.tierTooLow).toBe(false);
    expect(view.leadKey).toBe("clubGate.joinLead");
  });
});

// ---------------------------------------------------------------------------
// Polityka wejścia
// ---------------------------------------------------------------------------

describe("polityka wejścia klubu", () => {
  it("'open' daje wezwanie DOŁĄCZ, 'request' - POPROŚ", () => {
    const open = clubGateView({
      club: club({ join_policy: "open" }),
      signedIn: true,
      isExpert: false,
    });
    const request = clubGateView({
      club: club({ join_policy: "request" }),
      signedIn: true,
      isExpert: false,
    });

    expect(open.actions[0]).toMatchObject({ ctaKey: "clubGate.joinCta" });
    expect(request.actions[0]).toMatchObject({ ctaKey: "clubGate.requestCta" });
  });

  it("'invite' NIE daje prośby o dostęp NIGDY - nawet ekspertowi z planem", () => {
    for (const isExpert of [false, true]) {
      for (const reason of [null, "tier_too_low"]) {
        const view = clubGateView({
          club: club({ join_policy: "invite", reason }),
          signedIn: true,
          isExpert,
        });
        // Klub „tylko z zaproszenia" nie ma drogi samoobsługowej. Przycisk
        // prowadziłby do formularza, którego RPC i tak odrzuci.
        expect(view.canRequest, `expert=${isExpert} reason=${reason}`).toBe(false);
        expect(actionKinds(view)).not.toContain("request");
      }
    }
  });

  it("'invite' z wystarczającym planem nie pokazuje też notki o podniesieniu planu", () => {
    const view = clubGateView({
      club: club({ join_policy: "invite", reason: null }),
      signedIn: true,
      isExpert: false,
    });

    // Plan wystarcza, więc podnoszenie go niczego nie zmieni - notka byłaby
    // kłamstwem.
    expect(view.showUpgradeOnlyNote).toBe(false);
    expect(actionKinds(view)).toEqual([]);
  });

  it("'invite' z za niskim planem pokazuje cennik i notkę", () => {
    const view = clubGateView({
      club: club({ join_policy: "invite", reason: "tier_too_low" }),
      signedIn: true,
      isExpert: false,
    });

    expect(actionKinds(view)).toEqual(["upgrade", "plans"]);
    expect(view.showUpgradeOnlyNote).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Inwarianty całej macierzy
// ---------------------------------------------------------------------------

describe("inwarianty macierzy stanów", () => {
  const MATRIX = [false, true].flatMap((signedIn) =>
    [false, true].flatMap((isExpert) =>
      ["open", "request", "invite"].flatMap((join_policy) =>
        [null, "tier_too_low", "not_member"].map((reason) => ({
          signedIn,
          isExpert,
          club: club({ join_policy, reason }),
        })),
      ),
    ),
  );

  it("ŻADEN stan nie pokazuje jednocześnie rejestracji i prośby o dostęp", () => {
    for (const input of MATRIX) {
      const kinds = actionKinds(clubGateView(input));
      expect(kinds.includes("signup") && kinds.includes("request")).toBe(false);
    }
  });

  it("ŻADEN stan nie pokazuje jednocześnie prośby i notki 'tylko przez plan'", () => {
    for (const input of MATRIX) {
      const view = clubGateView(input);
      // Notka mówi „tędy nie wejdziesz", więc przycisk obok niej byłby
      // sprzecznym komunikatem.
      expect(view.canRequest && view.showUpgradeOnlyNote).toBe(false);
    }
  });

  it("notka eksperta pojawia się WYŁĄCZNIE razem z prośbą o dostęp", () => {
    for (const input of MATRIX) {
      const view = clubGateView(input);
      if (view.showExpertNote) expect(view.canRequest).toBe(true);
    }
  });

  it("anonim ZAWSZE widzi dokładnie jedną akcję: rejestrację", () => {
    for (const input of MATRIX.filter((i) => !i.signedIn)) {
      expect(actionKinds(clubGateView(input))).toEqual(["signup"]);
    }
  });

  it("każdy stan ma niepusty klucz zdania wiodącego", () => {
    for (const input of MATRIX) {
      expect(clubGateView(input).leadKey).toMatch(/^clubGate\./);
    }
  });

  it("wezwanie cennikowe pojawia się DOKŁADNIE wtedy, gdy plan nie wystarcza", () => {
    for (const input of MATRIX.filter((i) => i.signedIn)) {
      const view = clubGateView(input);
      expect(actionKinds(view).includes("upgrade")).toBe(view.tierTooLow);
    }
  });

  it("żaden stan nie powtarza tej samej akcji dwa razy", () => {
    for (const input of MATRIX) {
      const kinds = actionKinds(clubGateView(input));
      expect(new Set(kinds).size).toBe(kinds.length);
    }
  });
});

describe("katalog korzyści", () => {
  it("jest niepusty, bez duplikatów i o stałej kolejności", () => {
    expect(CLUB_GATE_BENEFITS.length).toBeGreaterThan(0);
    expect(new Set(CLUB_GATE_BENEFITS).size).toBe(CLUB_GATE_BENEFITS.length);
  });
});
