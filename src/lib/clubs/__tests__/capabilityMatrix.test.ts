// Kontrakt macierzy zdolności Discussion Club.
//
// Te testy nie sprawdzają "czy kod robi to, co robi" - sprawdzają INWARIANTY,
// których złamanie jest incydentem bezpieczeństwa albo powtórzeniem błędu,
// który już raz w tym repozytorium wystąpił.
import { describe, expect, it } from "vitest";
import {
  CAPABILITY_KEYS,
  CAPABILITY_ROLES,
  CLUB_CAPABILITY_MATRIX,
  capabilityValue,
  readCapability,
  superAdminCoversAdmin,
} from "../capabilityMatrix";
import { NO_CLUB_CAPABILITIES, toClubCapabilities } from "../types";

describe("macierz zdolności klubu", () => {
  it("pokrywa każdą kombinację zdolność x rola", () => {
    for (const key of CAPABILITY_KEYS) {
      for (const role of CAPABILITY_ROLES) {
        expect(["yes", "no", "cond"]).toContain(capabilityValue(key, role));
      }
    }
  });

  // INWARIANT V2 §2.3. Audyt z 2026-08-06 złapał dokładnie ten rozjazd
  // w profiles_guard_verification: bramkę zawężono do samego 'admin', przez co
  // super_admin bez osobnej roli 'admin' stracił uprawnienie sterujące odznaką
  // eksperta, a odznaka pociąga dożywotni VIP.
  it("super_admin przechodzi wszędzie tam, gdzie przechodzi admin", () => {
    expect(superAdminCoversAdmin()).toBe(true);

    for (const key of CAPABILITY_KEYS) {
      const row = CLUB_CAPABILITY_MATRIX[key];
      if (row.admin === "yes") {
        expect(row.super_admin, `zdolność ${key}`).toBe("yes");
      }
    }
  });

  // V2 §0: struktura należy WYŁĄCZNIE do staffu. Gdyby lead mógł zarządzać,
  // mógłby zmienić widoczność klubu secret na public.
  it("strukturą zarządza wyłącznie staff", () => {
    const row = CLUB_CAPABILITY_MATRIX.can_manage;
    expect(row.super_admin).toBe("yes");
    expect(row.admin).toBe("yes");
    for (const role of ["editor", "lead", "moderator", "member", "observer", "non_member"] as const) {
      expect(row[role], `rola ${role}`).toBe("no");
    }
  });

  // V2 §2.4: prowadzący jest STRONĄ dyskusji, więc dostęp do tożsamości
  // anonimowych wypowiedzi byłby konfliktem interesu.
  it("autora anonimowej wypowiedzi ujawnia wyłącznie staff, nigdy lead", () => {
    const row = CLUB_CAPABILITY_MATRIX.can_reveal_author;
    expect(row.super_admin).toBe("yes");
    expect(row.admin).toBe("yes");
    expect(row.lead).toBe("no");
    expect(row.moderator).toBe("no");
    expect(row.member).toBe("no");
  });

  it("observer jest z definicji cichy - nie pisze i nie reaguje", () => {
    expect(CLUB_CAPABILITY_MATRIX.can_reply.observer).toBe("no");
    expect(CLUB_CAPABILITY_MATRIX.can_react.observer).toBe("no");
    expect(CLUB_CAPABILITY_MATRIX.can_post_thread.observer).toBe("no");
    // ...ale czyta i widzi członków - po to istnieje ta rola.
    expect(CLUB_CAPABILITY_MATRIX.can_read.observer).toBe("yes");
    expect(CLUB_CAPABILITY_MATRIX.can_see_members.observer).toBe("yes");
  });

  it("nie-członek nie pisze i nie moderuje w żadnym wariancie ustawień", () => {
    for (const key of ["can_post_thread", "can_reply", "can_react", "can_moderate"] as const) {
      expect(CLUB_CAPABILITY_MATRIX[key].non_member, `zdolność ${key}`).toBe("no");
    }
  });

  it("editor nie moderuje - to praca redakcyjna, nie moderatorska", () => {
    expect(CLUB_CAPABILITY_MATRIX.can_moderate.editor).toBe("no");
    expect(CLUB_CAPABILITY_MATRIX.can_manage.editor).toBe("no");
  });
});

describe("odczyt zdolności z wyniku RPC", () => {
  it("mapuje każdy klucz macierzy na istniejące pole zdolności", () => {
    const allTrue = {
      can_read: true,
      can_post_thread: true,
      can_reply: true,
      can_react: true,
      can_moderate: true,
      can_manage: true,
      can_invite: true,
      can_see_members: true,
      can_reveal_author: true,
      effective_role: "lead",
      reason: null,
    };
    const caps = toClubCapabilities(allTrue);
    for (const key of CAPABILITY_KEYS) {
      expect(readCapability(caps, key), `zdolność ${key}`).toBe(true);
    }
  });

  it("brak odpowiedzi z RPC oznacza zdolności całkowicie zamknięte", () => {
    const caps = toClubCapabilities(null);
    expect(caps).toEqual(NO_CLUB_CAPABILITIES);
    for (const key of CAPABILITY_KEYS) {
      expect(readCapability(caps, key), `zdolność ${key}`).toBe(false);
    }
  });
});
