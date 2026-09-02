// @vitest-environment node
//
// CO DOWODZI TEN PLIK
//
// `src/lib/community/tenant.ts` ma sześć linii i jedną funkcję, a wchodząc miał
// zero pokrycia. Nie zasługiwałby na osobny plik, gdyby nie to, CO robi:
// oddaje `tenant_id`, który klient wstawia do wiersza (`qa_question_votes`),
// a RLS wymaga jego RÓWNOŚCI z `public_tenant_id()`. Zła wartość nie kończy się
// źle wyglądającym ekranem - kończy się odmową zapisu albo, przy dryfie danych,
// wierszem w cudzym obszarze roboczym.
//
// ── GDZIE TEN MODUŁ NAPRAWDĘ STOI W SYSTEMIE ────────────────────────────────
//
// `grep -rn "community/tenant" src` daje DOKŁADNIE JEDNEGO importera:
// `src/routes/qa.$slug.tsx`, w `mutationFn` głosowania na pytanie Q&A. To jest
// ścieżka ZAPISU wywoływana kliknięciem zalogowanego użytkownika, czyli zawsze
// w przeglądarce. Publiczny CZYTNIK (`publicQueries.ts`) tego modułu NIE UŻYWA
// wcale - jego granicę najemcy stawia RLS po stronie bazy przez
// `public_tenant_id()`, bez udziału klienta.
//
// ── HAZARD, KTÓRY TRZYMA SIĘ NA ZAŁOŻENIU ŚRODOWISKA ────────────────────────
//
// `cached` jest zmienną MODUŁOWĄ, więc pamięć ma zasięg całego izolatu, a nie
// żądania. W przeglądarce to jest poprawne: jedna karta to jeden host, więc
// jeden najemca na całe życie modułu. Na serwerze (Workers) JEDEN izolat
// obsługuje żądania WIELU domen - pierwsze wywołanie zapieczętowałoby najemcę
// dla wszystkich następnych. Dziś nic nie woła tej funkcji po stronie serwera
// i tylko to trzyma inwariant. Test "pamięć nie odróżnia najemców" niżej
// przypina ten fakt WPROST, żeby pierwszy serwerowy konsument zobaczył go jako
// czerwony kontrakt, a nie jako subtelność do odkrycia w produkcji.
//
// `vi.resetModules()` przed każdym przypadkiem jest tu WARUNKIEM SENSU testu:
// bez tego pamięć modułowa przecieka między przypadkami i drugi test "dowodzi"
// cache'u, którego pierwszy nie zbudował (albo odwrotnie - nie widzi odczytu,
// bo poprzedni przypadek już go zapisał).
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseRpcStub } from "@/test/supabase";

const sb = vi.hoisted(() => ({ rpc: null as SupabaseRpcStub | null }));

vi.mock("@/integrations/supabase/client", async () => {
  const { supabaseRpcStub } = await import("@/test/supabase");
  const rpcStub = supabaseRpcStub();
  sb.rpc = rpcStub;
  return { supabase: { rpc: rpcStub.rpc } };
});

const TENANT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TENANT_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function rpc(): SupabaseRpcStub {
  if (sb.rpc === null) throw new Error("atrapa `rpc` nie została utworzona");
  return sb.rpc;
}

/** Świeży moduł = pusta pamięć modułowa. Bez tego przypadki widzą swoje cache. */
async function freshModule(): Promise<{ getPublicTenantId: () => Promise<string> }> {
  vi.resetModules();
  return import("@/lib/community/tenant");
}

beforeEach(() => {
  // Rejestr modułów czyścimy przed KAŻDYM przypadkiem (pamięć modułowa
  // `cached`), ale atrapa klienta jest tworzona przez fabrykę `vi.mock`, którą
  // vitest zapamiętuje ponad `resetModules` - dlatego licznik wywołań RPC trzeba
  // wyzerować osobno, inaczej drugi przypadek liczy podróże pierwszego.
  vi.resetModules();
  sb.rpc?.reset();
});

describe("getPublicTenantId: jedna podróż do bazy na izolat", () => {
  it("pierwsze wywołanie pyta RPC public_tenant_id BEZ argumentów", async () => {
    const { getPublicTenantId } = await freshModule();
    rpc().setData("public_tenant_id", TENANT_A);

    await expect(getPublicTenantId()).resolves.toBe(TENANT_A);

    expect(rpc().names()).toEqual(["public_tenant_id"]);
    expect(rpc().lastCall("public_tenant_id")?.keys()).toEqual([]);
  });

  it("drugie wywołanie czyta z pamięci modułu - zero podróży do bazy", async () => {
    const { getPublicTenantId } = await freshModule();
    rpc().setData("public_tenant_id", TENANT_A);

    await getPublicTenantId();
    await expect(getPublicTenantId()).resolves.toBe(TENANT_A);

    expect(rpc().callsFor("public_tenant_id")).toHaveLength(1);
  });

  it("PAMIĘĆ NIE ODRÓŻNIA NAJEMCÓW: raz zapisana wartość wygrywa z nową odpowiedzią bazy", async () => {
    // To NIE jest defekt w dzisiejszym użyciu (jedyny konsument to mutacja
    // w przeglądarce, gdzie karta = jeden host), ale JEST kontraktem, który
    // pierwszy konsument serwerowy musi zobaczyć na czerwono. Zapisujemy go
    // wprost: po pierwszym wywołaniu baza może odpowiadać cokolwiek - moduł
    // tego nie zauważy.
    const { getPublicTenantId } = await freshModule();
    rpc().setData("public_tenant_id", TENANT_A);
    await getPublicTenantId();

    rpc().setData("public_tenant_id", TENANT_B);

    await expect(getPublicTenantId()).resolves.toBe(TENANT_A);
    expect(rpc().callsFor("public_tenant_id")).toHaveLength(1);
  });

  it("świeży moduł znów pyta bazę - pamięć żyje w module, nie w wywołaniu", async () => {
    const first = await freshModule();
    rpc().setData("public_tenant_id", TENANT_A);
    await first.getPublicTenantId();

    const second = await freshModule();
    rpc().setData("public_tenant_id", TENANT_B);

    await expect(second.getPublicTenantId()).resolves.toBe(TENANT_B);
  });
});

describe("getPublicTenantId: odmowa bazy", () => {
  it("błąd RPC leci dalej jako wyjątek", async () => {
    const { getPublicTenantId } = await freshModule();
    rpc().setError("public_tenant_id", "function public_tenant_id() does not exist", "42883");

    await expect(getPublicTenantId()).rejects.toThrow("function public_tenant_id() does not exist");
  });

  it("BŁĄD NIE ZATRUWA PAMIĘCI - kolejne wywołanie próbuje ponownie i może się udać", async () => {
    // Gdyby nieudany odczyt zapisał cokolwiek (np. `null` albo `undefined`),
    // pojedynczy timeout przy pierwszym głosowaniu zablokowałby głosowanie na
    // całą sesję karty - bez żadnego komunikatu, bo funkcja przestałaby rzucać.
    const { getPublicTenantId } = await freshModule();
    rpc().setError("public_tenant_id", "statement timeout", "57014");
    await expect(getPublicTenantId()).rejects.toThrow("statement timeout");

    rpc().setData("public_tenant_id", TENANT_A);

    await expect(getPublicTenantId()).resolves.toBe(TENANT_A);
    expect(rpc().callsFor("public_tenant_id")).toHaveLength(2);
  });
});
