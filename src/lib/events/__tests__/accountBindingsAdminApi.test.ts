// DOWIĄZANIA KONT DO KARTOTEK - warstwa danych ekranu organizatora (REG-01, D14).
//
// CO TU PILNUJEMY.
// 1) NAJEMCA Z SESJI, NIE Z ŁADUNKU. Trzy RPC biorą organizację
//    z `assert_event_admin_tenant()`; ładunek niesie WYŁĄCZNIE identyfikator
//    osoby albo wpisu dziennika. Klucz `tenant_id` w ładunku byłby zaproszeniem
//    do przyszłej regresji po stronie SQL.
// 2) ADRES KONTA TYLKO ZAMASKOWANY. Model ekranu nie ma pola na pełny adres
//    konta - nawet gdyby baza go kiedyś oddała, nie przejdzie dalej.
// 3) ŚMIECI NIE UDAJĄ WIERSZY. Wiersz bez identyfikatora (osoby, wpisu, daty)
//    odpada, a nieznane ryzyko i powód nie zamieniają się w „zweryfikowane".
// 4) ODMOWA BAZY DOJEŻDŻA W CAŁOŚCI - głowa komunikatu niesie powód dla mapy
//    odmów panelu (`not_bound`, `account_in_use`, ...).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { supabaseRpcStub, type SupabaseRpcStub } from "@/test/supabase/rpc";

const h = vi.hoisted(() => ({ rpc: null as SupabaseRpcStub | null }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (name: string, args?: Record<string, unknown>) => {
      if (h.rpc === null) throw new Error("test: atrapa RPC nie zostala ustawiona");
      return h.rpc.rpc(name, args);
    },
  },
}));

const api = await import("@/lib/events/accountBindingsAdminApi");

const PERSON = "7a000000-0000-4000-8000-000000000001";
const UNBIND = "7a000000-0000-4000-8000-000000000002";

function rpc(): SupabaseRpcStub {
  if (h.rpc === null) throw new Error("test: atrapa RPC nie zostala ustawiona");
  return h.rpc;
}

beforeEach(() => {
  h.rpc = supabaseRpcStub();
});

describe("fetchAccountBindings", () => {
  it("woła `admin_event_people_account_bindings` z pustym ładunkiem i czyta obie listy", async () => {
    rpc().setData("admin_event_people_account_bindings", {
      unverified: [
        {
          person_id: PERSON,
          first_name: "Lena",
          last_name: "Ofiara",
          email: "lena@example.com",
          account_email_hint: "x***@example.com",
          account_email_confirmed: true,
          risk: "foreign_record",
          registrations_by_account: 2,
          // Pełny adres konta nie jest częścią kontraktu - nie może przejść dalej.
          account_email: "x2@example.com",
        },
      ],
      unbinds: [
        {
          id: UNBIND,
          person_id: PERSON,
          first_name: "Lena",
          last_name: "Ofiara",
          email: "lena@example.com",
          account_email_hint: "x***@example.com",
          risk: "foreign_record",
          reason: "reg01_remediation",
          registrations_by_account: 1,
          unbound_at: "2026-10-12T19:00:00+00:00",
          restored_at: null,
          account_deleted: false,
          person_bound: false,
        },
      ],
    });

    const result = await api.fetchAccountBindings();

    expect(rpc().names()).toEqual(["admin_event_people_account_bindings"]);
    expect(rpc().lastCall("admin_event_people_account_bindings")?.args).toEqual({
      p_payload: {},
    });
    expect(result.unverified).toEqual([
      {
        personId: PERSON,
        firstName: "Lena",
        lastName: "Ofiara",
        email: "lena@example.com",
        accountEmailHint: "x***@example.com",
        accountEmailConfirmed: true,
        risk: "foreign_record",
        registrationsByAccount: 2,
      },
    ]);
    expect(result.unbinds).toEqual([
      {
        id: UNBIND,
        personId: PERSON,
        firstName: "Lena",
        lastName: "Ofiara",
        email: "lena@example.com",
        accountEmailHint: "x***@example.com",
        risk: "foreign_record",
        reason: "reg01_remediation",
        registrationsByAccount: 1,
        unboundAt: "2026-10-12T19:00:00+00:00",
        restoredAt: null,
        accountDeleted: false,
        personBound: false,
      },
    ]);
    expect(JSON.stringify(result)).not.toContain("x2@example.com");
  });

  it("wiersze bez identyfikatorów odpadają; nieznane ryzyko i powód nie udają znanych", () => {
    const parsed = api.parseAccountBindings({
      unverified: [{ first_name: "Bez id" }, { person_id: PERSON, risk: "verified_maybe" }],
      unbinds: [
        { id: UNBIND, person_id: PERSON },
        { id: UNBIND, person_id: PERSON, unbound_at: "2026-10-12T19:00:00Z", reason: "cos" },
      ],
    });

    expect(parsed.unverified).toHaveLength(1);
    // Nieznane ryzyko NIE zamienia się w „verified" - spada do klasy wymagającej uwagi.
    expect(parsed.unverified[0]?.risk).toBe("self_created");
    expect(parsed.unbinds).toHaveLength(1);
    expect(parsed.unbinds[0]?.reason).toBe("admin_unbind");
    expect(api.parseAccountBindings(null)).toEqual({ unverified: [], suspect: [], unbinds: [] });
  });

  it("lista przeglądu (R12): sygnały przejęcia, maskowany adres konta, stara baza bez klucza", () => {
    const parsed = api.parseAccountBindings({
      unverified: [],
      suspect: [
        {
          person_id: PERSON,
          first_name: "Vera",
          last_name: "Victim",
          email: "attacker@example.com",
          account_email_hint: "a***@example.com",
          risk: "suspect_takeover",
          mails_elsewhere: 3,
          registrations_by_others: 1,
          account_email: "attacker@example.com",
        },
        { first_name: "Bez id", mails_elsewhere: 1 },
      ],
      unbinds: [],
    });
    expect(parsed.suspect).toEqual([
      {
        personId: PERSON,
        firstName: "Vera",
        lastName: "Victim",
        email: "attacker@example.com",
        accountEmailHint: "a***@example.com",
        mailsElsewhere: 3,
        registrationsByOthers: 1,
      },
    ]);
    // Baza sprzed 20261012180650 nie zna klucza `suspect` - pusta lista, nie błąd.
    expect(api.parseAccountBindings({ unverified: [], unbinds: [] }).suspect).toEqual([]);
    // Nowe klasy ryzyka są znane modelowi - nie spadają do `self_created`.
    const risks = api
      .parseAccountBindings({
        unverified: [
          { person_id: PERSON, risk: "admin_provisioned" },
          { person_id: UNBIND, risk: "suspect_takeover" },
        ],
      })
      .unverified.map((row) => row.risk);
    expect(risks).toEqual(["admin_provisioned", "suspect_takeover"]);
  });

  it("błąd bazy (np. `forbidden` redaktora) leci w całości", async () => {
    rpc().setError("admin_event_people_account_bindings", "forbidden: admin role required");
    await expect(api.fetchAccountBindings()).rejects.toThrow(/^forbidden/);
  });
});

describe("unbindPersonAccount / restorePersonAccount", () => {
  it("odwiązanie wysyła WYŁĄCZNIE identyfikator osoby i oddaje wpis dziennika", async () => {
    rpc().setData("admin_event_person_account_unbind", {
      ok: true,
      person_id: PERSON,
      unbind_id: UNBIND,
      risk: "verified",
    });

    await expect(api.unbindPersonAccount(PERSON)).resolves.toBe(UNBIND);
    expect(rpc().lastCall("admin_event_person_account_unbind")?.args).toEqual({
      p_payload: { person_id: PERSON },
    });
  });

  it("przywrócenie wysyła WYŁĄCZNIE identyfikator wpisu dziennika", async () => {
    rpc().setData("admin_event_person_account_restore", {
      ok: true,
      person_id: PERSON,
      unbind_id: UNBIND,
    });

    await api.restorePersonAccount(UNBIND);
    expect(rpc().lastCall("admin_event_person_account_restore")?.args).toEqual({
      p_payload: { unbind_id: UNBIND },
    });
  });

  it.each([
    ["admin_event_person_account_unbind", "not_bound: this person is not linked to an account"],
    [
      "admin_event_person_account_restore",
      "account_in_use: this account is linked to another person",
    ],
  ] as const)("%s: odmowa bazy dojeżdża z kodem w głowie", async (name, message) => {
    rpc().setError(name, message);
    const call =
      name === "admin_event_person_account_unbind"
        ? api.unbindPersonAccount(PERSON)
        : api.restorePersonAccount(UNBIND);

    await expect(call).rejects.toThrow(new RegExp(`^${message.split(":")[0]}:`));
  });
});
