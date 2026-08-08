// Normalizacja danych z RPC: zawężanie stringów z bazy do słowników klienta.
//
// Sedno tych testów: nieznana wartość z NOWSZEJ migracji nie może wywrócić
// interfejsu. Baza jest forward-only, więc klient prędzej czy później zobaczy
// wartość, której jego wersja jeszcze nie zna - i musi to przeżyć.
import { describe, expect, it } from "vitest";
import {
  CLUB_ACCESS_REASONS,
  CLUB_GROUP_VISIBILITIES,
  CLUB_VISIBILITIES,
  NO_CLUB_CAPABILITIES,
  toClubCapabilities,
  toClubGroupVisibility,
  toGroupSettings,
  type GroupInheritanceFields,
} from "../types";

function capsRow(overrides: Record<string, unknown> = {}) {
  return {
    can_read: true,
    can_post_thread: false,
    can_reply: true,
    can_react: true,
    can_moderate: false,
    can_manage: false,
    can_invite: false,
    can_see_members: true,
    can_reveal_author: false,
    effective_role: "member",
    reason: null,
    ...overrides,
  };
}

describe("toClubCapabilities", () => {
  it("przepisuje flagi na formę znormalizowaną", () => {
    const caps = toClubCapabilities(capsRow());
    expect(caps.canRead).toBe(true);
    expect(caps.canPostThread).toBe(false);
    expect(caps.canSeeMembers).toBe(true);
    expect(caps.effectiveRole).toBe("member");
    expect(caps.reason).toBeNull();
  });

  it("rozpoznaje każdy kod powodu ze słownika", () => {
    for (const reason of CLUB_ACCESS_REASONS) {
      const caps = toClubCapabilities(capsRow({ reason }));
      expect(caps.reason, `powód ${reason}`).toBe(reason);
    }
  });

  // Kluczowe zachowanie: nieznany kod NIE trafia do interfejsu jako surowy
  // string. Zamiast tego degraduje do braku powodu, więc UI pokaże ogólną
  // odmowę zamiast wyświetlić użytkownikowi identyfikator z bazy.
  it("nieznany kod powodu degraduje do null zamiast wyciec do UI", () => {
    const caps = toClubCapabilities(capsRow({ reason: "quantum_flux_denied" }));
    expect(caps.reason).toBeNull();
  });

  it("nieznana rola efektywna degraduje do non_member, nie do undefined", () => {
    const caps = toClubCapabilities(capsRow({ effective_role: "grand_wizard" }));
    expect(caps.effectiveRole).toBe("non_member");
  });

  it("brak wiersza to zdolności całkowicie zamknięte", () => {
    expect(toClubCapabilities(undefined)).toEqual(NO_CLUB_CAPABILITIES);
    expect(toClubCapabilities(null)).toEqual(NO_CLUB_CAPABILITIES);
  });

  // Wartość inna niż dokładnie `true` nie może dawać uprawnienia. RPC zwraca
  // boolean, ale gdyby kiedyś zwróciło null (LEFT JOIN bez trafienia),
  // domyślną odpowiedzią musi być odmowa, nie zgoda.
  it("null w kolumnie zdolności czyta się jako brak uprawnienia", () => {
    const caps = toClubCapabilities(capsRow({ can_read: null, can_moderate: null }));
    expect(caps.canRead).toBe(false);
    expect(caps.canModerate).toBe(false);
  });
});

function groupRow(overrides: Partial<GroupInheritanceFields> = {}): GroupInheritanceFields {
  return {
    visibility: "members",
    visibility_inherited: true,
    who_can_post: "moderators",
    who_can_post_inherited: true,
    moderation_mode: "trusted",
    moderation_mode_inherited: true,
    min_tier_rank: 0,
    min_tier_rank_inherited: true,
    attribution_mode: "attributed",
    attribution_mode_inherited: true,
    ...overrides,
  };
}

describe("toGroupSettings - dziedziczenie ustawień grupy", () => {
  it("przenosi flagę dziedziczenia razem z wartością", () => {
    const s = toGroupSettings(groupRow());
    expect(s.visibility).toEqual({ value: "members", inherited: true });
    expect(s.whoCanPost.inherited).toBe(true);
    expect(s.minTierRank).toEqual({ value: 0, inherited: true });
  });

  it("nadpisanie na grupie zeruje flagę dziedziczenia", () => {
    const s = toGroupSettings(
      groupRow({
        visibility: "secret",
        visibility_inherited: false,
        min_tier_rank: 3,
        min_tier_rank_inherited: false,
      }),
    );
    expect(s.visibility).toEqual({ value: "secret", inherited: false });
    expect(s.minTierRank).toEqual({ value: 3, inherited: false });
  });

  // Grupa nie może być 'public' (CHECK w bazie dopuszcza tylko members/private/
  // secret), ale wartość efektywna dziedziczona z klubu MOŻE nią być. Zawężanie
  // musi to przepuścić, bo inaczej grupa w klubie publicznym pokazywałaby
  // błędną widoczność.
  it("przepuszcza widoczność public odziedziczoną z klubu", () => {
    const s = toGroupSettings(groupRow({ visibility: "public", visibility_inherited: true }));
    expect(s.visibility.value).toBe("public");
  });

  it("nieznana wartość degraduje do bezpiecznego domyślnego", () => {
    const s = toGroupSettings(
      groupRow({ visibility: "cosmic", who_can_post: "everyone", attribution_mode: "telepathy" }),
    );
    expect(s.visibility.value).toBe("members");
    expect(s.whoCanPost.value).toBe("moderators");
    expect(s.attributionMode.value).toBe("attributed");
  });

  it("brak progu planu czyta się jako zero, nie jako NaN", () => {
    const s = toGroupSettings(groupRow({ min_tier_rank: null }));
    expect(s.minTierRank.value).toBe(0);
  });
});

describe("widoczność działu: zobaczyć wolno więcej, niż wolno zapisać", () => {
  // CHECK `club_groups_visibility_check` zna members/private/secret. Droplista
  // nadpisania karmiona pełnym słownikiem klubu oddawała administratorowi
  // wybór 'public', który baza odrzuca dopiero przy zapisie - czyli po stracie
  // wypełnionego formularza.
  it("słownik zapisu nie zawiera 'public'", () => {
    expect(CLUB_GROUP_VISIBILITIES).not.toContain("public");
    expect([...CLUB_GROUP_VISIBILITIES]).toEqual(["members", "private", "secret"]);
  });

  it("każda wartość zapisu jest też wartością odczytu (słowniki się nie rozjeżdżają)", () => {
    for (const value of CLUB_GROUP_VISIBILITIES) {
      expect(CLUB_VISIBILITIES).toContain(value);
    }
  });

  it("sprowadza odziedziczone 'public' do najbliższej wartości ustawialnej", () => {
    expect(toClubGroupVisibility("public")).toBe("members");
  });

  it("nie rusza wartości, które i tak wolno ustawić", () => {
    expect(toClubGroupVisibility("private")).toBe("private");
    expect(toClubGroupVisibility("secret")).toBe("secret");
    expect(toClubGroupVisibility("members")).toBe("members");
  });

  it("nieznana wartość z nowszej migracji degraduje bezpiecznie", () => {
    expect(toClubGroupVisibility("cosmic")).toBe("members");
  });
});
