// Kontrakt macierzy zdolności Discussion Club.
//
// Te testy nie sprawdzają "czy kod robi to, co robi" - sprawdzają INWARIANTY,
// których złamanie jest incydentem bezpieczeństwa albo powtórzeniem błędu,
// który już raz w tym repozytorium wystąpił.
import { describe, expect, it, vi } from "vitest";
import {
  CAPABILITY_KEYS,
  CAPABILITY_ROLES,
  CLUB_CAPABILITY_MATRIX,
  capabilityValue,
  readCapability,
  superAdminCoversAdmin,
  type CapabilityKey,
  type CapabilityValue,
} from "../capabilityMatrix";
import { NO_CLUB_CAPABILITIES, toClubCapabilities, type ClubCapabilities } from "../types";

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
    for (const role of [
      "editor",
      "lead",
      "moderator",
      "member",
      "observer",
      "non_member",
    ] as const) {
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

// ---------------------------------------------------------------------------
// KOMPLETNOŚĆ MACIERZY
//
// Powyższe warunki czytają POJEDYNCZE komórki, więc milczą o komórce, która
// z macierzy WYPADŁA. Brak wiersza dla roli nie jest w tym pliku błędem typu:
// `Record<CapabilityRole, CapabilityValue>` sprawdza literał w miejscu
// deklaracji, ale zakładka panelu renderuje wiersz po wierszu z tablicy
// `CAPABILITY_ROLES` - a `undefined` w komórce rysuje się jako pusta kratka,
// czyli „nie wiadomo", a nie „nie wolno". Dlatego kompletność jest tu osobnym
// warunkiem, a nie efektem ubocznym typów.
// ---------------------------------------------------------------------------

describe("kompletność macierzy - żadna kombinacja nie może wypaść", () => {
  it("każdy wiersz ma DOKŁADNIE role z `CAPABILITY_ROLES` - bez braków i bez nadmiaru", () => {
    for (const key of CAPABILITY_KEYS) {
      const columns = Object.keys(CLUB_CAPABILITY_MATRIX[key]).sort();
      expect(columns, `zdolność ${key}`).toEqual([...CAPABILITY_ROLES].sort());
    }
  });

  it("macierz ma DOKŁADNIE klucze z `CAPABILITY_KEYS`", () => {
    expect(Object.keys(CLUB_CAPABILITY_MATRIX).sort()).toEqual([...CAPABILITY_KEYS].sort());
  });

  it("obie listy są zbiorami - powtórzona kolumna renderowałaby dwa razy tę samą rolę", () => {
    expect(new Set(CAPABILITY_ROLES).size).toBe(CAPABILITY_ROLES.length);
    expect(new Set(CAPABILITY_KEYS).size).toBe(CAPABILITY_KEYS.length);
  });

  // 9 zdolności x 8 ról. Warunek na LICZBĘ, żeby dopisanie roli albo zdolności
  // bez uzupełnienia macierzy zapaliło czerwień tutaj, a nie w panelu.
  it("wszystkie 72 komórki istnieją i niosą wartość ze słownika", () => {
    const cells: CapabilityValue[] = [];
    for (const key of CAPABILITY_KEYS) {
      for (const role of CAPABILITY_ROLES) {
        const value = capabilityValue(key, role);
        expect(["yes", "no", "cond"], `${key} x ${role}`).toContain(value);
        cells.push(value);
      }
    }
    expect(cells).toHaveLength(72);
  });

  // Komórka `cond` to OBIETNICA, że w `club_capabilities()` stoi odpowiadająca
  // jej gałąź warunkowa (widoczność, who_can_post, próg planu). Zamiana `cond`
  // na `yes` jest cichym rozszerzeniem uprawnienia, a `yes` na `cond` - cichym
  // dołożeniem bramki, której baza nie ma. Dlatego pełny spis warunkowych
  // komórek jest tu wypisany wprost.
  it("warunkowe są DOKŁADNIE te komórki, które mają gałąź w bazie", () => {
    const conditional: string[] = [];
    for (const key of CAPABILITY_KEYS) {
      for (const role of CAPABILITY_ROLES) {
        if (capabilityValue(key, role) === "cond") conditional.push(`${key}.${role}`);
      }
    }
    expect(conditional.sort()).toEqual(
      [
        "can_read.editor",
        "can_read.non_member",
        "can_post_thread.editor",
        "can_post_thread.member",
        "can_reply.editor",
        "can_react.editor",
        "can_see_members.editor",
        "can_see_members.non_member",
      ].sort(),
    );
  });

  // Nie-członek i obserwator to dwie różne odpowiedzi na to samo pytanie
  // „czy zobaczy skład": obserwator JEST w klubie (zawsze tak), nie-członek
  // zależy od widoczności. Sklejenie ich odbiera klubowi secret ochronę składu.
  it("widoczność składu: obserwator bezwarunkowo, nie-członek zależnie od ustawień", () => {
    expect(capabilityValue("can_see_members", "observer")).toBe("yes");
    expect(capabilityValue("can_see_members", "non_member")).toBe("cond");
  });
});

// ---------------------------------------------------------------------------
// INWARIANT super_admin ⊇ admin NA MACIERZACH, KTÓRYCH DZIŚ NIE MA
//
// `superAdminCoversAdmin()` czyta macierz z modułu, więc na obecnych danych
// wykonuje SAMĄ gałąź `admin === "yes"` - dwie pozostałe (admin warunkowy,
// admin bez uprawnienia) nie są nigdy sprawdzane i cicho zgniłyby razem
// z pierwszą zmianą macierzy. Żeby je zweryfikować, potrzebna jest INNA
// macierz - i stąd import świeżej kopii modułu przez `vi.resetModules()`:
// mutacja dotyczy wtedy WYŁĄCZNIE tej kopii, a macierz zaimportowana na górze
// pliku (i czytana przez warunki wyżej) zostaje nietknięta.
//
// GRANICA DOWODU: to nie jest test danych produkcyjnych, tylko REGUŁY
// porównania. Dane produkcyjne sprawdza warunek „super_admin przechodzi
// wszędzie tam, gdzie przechodzi admin" wyżej.
// ---------------------------------------------------------------------------

describe("reguła porównania super_admin z admin", () => {
  /** Świeża kopia modułu z podmienioną jedną kolumną - patrz nagłówek sekcji. */
  async function verdictFor(admin: CapabilityValue, superAdmin: CapabilityValue): Promise<boolean> {
    vi.resetModules();
    const fresh = await import("../capabilityMatrix");
    const row = fresh.CLUB_CAPABILITY_MATRIX.can_read;
    row.admin = admin;
    row.super_admin = superAdmin;
    return fresh.superAdminCoversAdmin();
  }

  it("admin bezwarunkowo, super_admin bezwarunkowo - inwariant spełniony", async () => {
    await expect(verdictFor("yes", "yes")).resolves.toBe(true);
  });

  it("admin bezwarunkowo, super_admin warunkowo - ZŁAMANIE inwariantu", async () => {
    // To jest dokładnie kształt regresji z `profiles_guard_verification`:
    // bramka zawężona tak, że super_admin bez osobnej roli admina traci
    // uprawnienie, które admin ma bezwarunkowo.
    await expect(verdictFor("yes", "cond")).resolves.toBe(false);
  });

  it("admin warunkowo, super_admin bezwarunkowo - szersze uprawnienie jest OK", async () => {
    await expect(verdictFor("cond", "yes")).resolves.toBe(true);
  });

  it("admin warunkowo, super_admin warunkowo - równe uprawnienie jest OK", async () => {
    // Gałąź `||`: prawa strona rozstrzyga dopiero wtedy, gdy super_admin
    // NIE jest bezwarunkowy.
    await expect(verdictFor("cond", "cond")).resolves.toBe(true);
  });

  it("admin warunkowo, super_admin bez uprawnienia - ZŁAMANIE inwariantu", async () => {
    await expect(verdictFor("cond", "no")).resolves.toBe(false);
  });

  it("admin bez uprawnienia - super_admin nie jest niczym związany", async () => {
    // Inwariant mówi tylko „nie mniej niż admin". Gdy admin nie ma nic,
    // każda wartość super_admina go spełnia - także brak uprawnienia.
    await expect(verdictFor("no", "no")).resolves.toBe(true);
    await expect(verdictFor("no", "yes")).resolves.toBe(true);
  });
});

// ---------------------------------------------------------------------------
// MAPOWANIE KLUCZ MACIERZY -> POLE WYNIKU RPC
//
// Warunek „wszystko na true" wyżej przechodzi RÓWNIEŻ dla mapowania, w którym
// dwa klucze wskazują na to samo pole - a taki rozjazd znaczy w panelu
// „Podgląd jako..." zdolność pokazaną z cudzej kratki. Dlatego tu każdy klucz
// jest sprawdzany W IZOLACJI: jedno pole prawdziwe, reszta fałszywa.
// ---------------------------------------------------------------------------

describe("odczyt zdolności - mapowanie jest różnowartościowe", () => {
  /** Wynik RPC, w którym prawdziwa jest DOKŁADNIE jedna zdolność. */
  function capsWithOnly(only: CapabilityKey): ClubCapabilities {
    return toClubCapabilities({
      can_read: only === "can_read",
      can_post_thread: only === "can_post_thread",
      can_reply: only === "can_reply",
      can_react: only === "can_react",
      can_moderate: only === "can_moderate",
      can_manage: only === "can_manage",
      can_invite: only === "can_invite",
      can_see_members: only === "can_see_members",
      can_reveal_author: only === "can_reveal_author",
      effective_role: "member",
      reason: null,
    });
  }

  it("każdy klucz czyta SWOJE pole i żadnego innego", () => {
    for (const key of CAPABILITY_KEYS) {
      const caps = capsWithOnly(key);
      for (const other of CAPABILITY_KEYS) {
        expect(readCapability(caps, other), `${key} widziane przez ${other}`).toBe(other === key);
      }
    }
  });

  // Bramka domyślnie ZAMKNIĘTA: `readCapability` porównuje do `true`, więc
  // wszystko, co nie jest jawnym „wolno", jest odmową. Do tego dochodzi rola:
  // kod roli, którego klient nie zna (bo baza wyprzedziła wdrożenie), nie może
  // zostać surowy - schodzi do najsłabszej roli, a nie do „coś nieznanego",
  // które widok mógłby potraktować jak członkostwo.
  it("wszystkie zdolności fałszywe plus NIEZNANA rola z bazy to pełne zamknięcie", () => {
    const caps = toClubCapabilities({
      can_read: false,
      can_post_thread: false,
      can_reply: false,
      can_react: false,
      can_moderate: false,
      can_manage: false,
      can_invite: false,
      can_see_members: false,
      can_reveal_author: false,
      effective_role: "rola-z-przyszlej-migracji",
      reason: "powod-z-przyszlej-migracji",
    });
    for (const key of CAPABILITY_KEYS) {
      expect(readCapability(caps, key), `zdolność ${key}`).toBe(false);
    }
    expect(caps.effectiveRole).toBe("non_member");
    // Nieznany kod powodu też nie przecieka do interfejsu jako surowy napis -
    // widok pokaże ogólną odmowę zamiast wewnętrznego identyfikatora bazy.
    expect(caps.reason).toBeNull();
  });

  it("znana rola i znany powód przechodzą bez zmiany", () => {
    // Kanarek do warunku wyżej: gdyby mapowanie kasowało KAŻDĄ rolę i KAŻDY
    // powód, tamten warunek przechodziłby z tego samego powodu, co ten.
    const caps = toClubCapabilities({
      can_read: true,
      can_post_thread: false,
      can_reply: false,
      can_react: false,
      can_moderate: false,
      can_manage: false,
      can_invite: false,
      can_see_members: false,
      can_reveal_author: false,
      effective_role: "observer",
      reason: "tier_too_low",
    });
    expect(caps.effectiveRole).toBe("observer");
    expect(caps.reason).toBe("tier_too_low");
    expect(readCapability(caps, "can_read")).toBe(true);
  });
});
