// Jedno źródło najemcy dla funkcji serwerowych - macierz decyzji helpera.
//
// CO BYŁO ZŁE. Bramka roli (`has_role` -> `current_tenant_id` ->
// `profiles.tenant_id`) i warstwa danych (`resolveTenantIdForHost(host)`)
// rozstrzygały najemcę NIEZALEŻNIE. Admin obszaru A otwierał publiczną domenę
// obszaru B, wołał funkcję serwerową swoim tokenem i przechodził bramkę w A,
// a zapytanie szło po B: rejestr wpłat, rejestr monetyzacji i eksport audytu
// rozliczeń cudzego obszaru.
//
// JAK NAPRAWIONE. Zakres pochodzi z PROFILU wołającego, host jest wyłącznie
// kontrolą spójności. Ten plik pilnuje obu połówek kontraktu naraz:
// zawężenia (host wskazuje kogoś innego -> odmowa) i ZGODNOŚCI WSTECZNEJ
// (host bez wiązania -> przepuszczamy, inaczej padają dev i podgląd).
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ok, supabaseFromStub, type SupabaseFromStub } from "@/test/supabase/chain";

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const TENANT_B = "22222222-2222-4222-8222-222222222222";
const USER = "33333333-3333-4333-8333-333333333333";

/** Stan granic: host żądania i katalog domen. */
const h = vi.hoisted(() => ({
  host: "a.example.com" as string | null,
  binding: {
    tenant: null as { id: string } | null,
    directoryPopulated: true,
  },
}));

vi.mock("@/lib/http/requestHost", () => ({
  currentTenantHost: async () => h.host,
}));
vi.mock("@/lib/server/tenant.server", () => ({
  resolveDomainBinding: async () => h.binding,
}));

const { assertCallerTenantMatchesHost, TENANT_HOST_MISMATCH } =
  await import("@/lib/server/callerTenant.server");

let db: SupabaseFromStub;

/** Klient UŻYTKOWNIKA - na nim czytany jest profil (polityka self-select). */
function client() {
  return { from: (table: string) => db.from(table) } as unknown as Parameters<
    typeof assertCallerTenantMatchesHost
  >[0];
}

beforeEach(() => {
  db = supabaseFromStub();
  db.setResponse("profiles", ok({ tenant_id: TENANT_A }));
  h.host = "a.example.com";
  h.binding = { tenant: { id: TENANT_A }, directoryPopulated: true };
});

describe("assertCallerTenantMatchesHost", () => {
  it("host wiąże się z TYM SAMYM najemcą - zwraca najemcę profilowego", async () => {
    await expect(assertCallerTenantMatchesHost(client(), USER)).resolves.toBe(TENANT_A);

    // Profil czytany jest po identyfikatorze Z KONTEKSTU, nigdy z ładunku.
    expect(db.lastChain("profiles")?.argsOf("eq")).toEqual(["id", USER]);
  });

  it("host wiąże się z INNYM najemcą - odmowa, bez zdradzania czyj to host", async () => {
    h.binding = { tenant: { id: TENANT_B }, directoryPopulated: true };

    await expect(assertCallerTenantMatchesHost(client(), USER)).rejects.toThrow(
      TENANT_HOST_MISMATCH,
    );
    // Komunikat jest stały i NIE niesie identyfikatora najemcy spod hosta -
    // inaczej odmowa byłaby wyrocznią mapy domena -> obszar roboczy.
    await expect(assertCallerTenantMatchesHost(client(), USER)).rejects.toThrow(
      new RegExp(`^${TENANT_HOST_MISMATCH}$`),
    );
  });

  it("host podglądowy / localhost (brak wiązania) PRZEPUSZCZA na najemcy profilowego", async () => {
    // TEST ANTYREGRESYJNY dla dev i podglądu. `resolveTenantForHost` ma
    // fallback na najemcę domyślnego dla każdego nieznanego hosta - gdyby
    // helper porównywał się z TĄ wartością, każdy admin spoza najemcy
    // domyślnego dostawałby odmowę na localhoście i na `*.pages.dev`.
    h.host = "podglad.pages.dev";
    h.binding = { tenant: null, directoryPopulated: true };

    await expect(assertCallerTenantMatchesHost(client(), USER)).resolves.toBe(TENANT_A);
  });

  it("pusty katalog domen (instalacja przed multi-domain) też przepuszcza", async () => {
    h.binding = { tenant: null, directoryPopulated: false };

    await expect(assertCallerTenantMatchesHost(client(), USER)).resolves.toBe(TENANT_A);
  });

  it("brak hosta w ogóle (praca poza kontekstem żądania) przepuszcza", async () => {
    h.host = null;
    h.binding = { tenant: null, directoryPopulated: true };

    await expect(assertCallerTenantMatchesHost(client(), USER)).resolves.toBe(TENANT_A);
  });

  it("profil bez najemcy to ODMOWA, a nie zakres „wszyscy”", async () => {
    db.setResponse("profiles", ok({ tenant_id: null }));

    await expect(assertCallerTenantMatchesHost(client(), USER)).rejects.toThrow(
      "No tenant for current user",
    );
  });

  it("brak wiersza profilu również zamyka ścieżkę", async () => {
    db.setResponse("profiles", ok(null));

    await expect(assertCallerTenantMatchesHost(client(), USER)).rejects.toThrow(
      "No tenant for current user",
    );
  });

  it("ŻADNEJ gałęzi wyjątku po roli: zgodność hosta liczy się tak samo dla każdego", async () => {
    // `is_super_admin()` ma w bazie `AND tenant_id = current_tenant_id()`, więc
    // „super admin pomija porównanie" odtworzyłoby całą lukę dla każdego, kto
    // ma tę rolę we własnym obszarze. Helper nie przyjmuje roli ARGUMENTEM -
    // ten test pilnuje tego kształtu (dwa parametry, nic o roli).
    expect(assertCallerTenantMatchesHost.length).toBe(2);

    h.binding = { tenant: { id: TENANT_B }, directoryPopulated: true };
    await expect(assertCallerTenantMatchesHost(client(), USER)).rejects.toThrow(
      TENANT_HOST_MISMATCH,
    );
  });
});
