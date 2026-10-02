// HOOK `useTenantPublicOrigin` - skąd kokpit SEO bierze fakty dla reguły
// originu (sama reguła ma własną tablicę w `tenantPublicOrigin.test.ts`).
//
// PRZEDMIOT DOWODU - sklejenie, nie reguła:
//   1. domena przychodzi z WIERSZA WŁASNEGO TENANTA (`tenants.domain`,
//      zawężenie po `id` jawnie, a nie tylko przez RLS);
//   2. brak tenanta = brak zapytania (nie pytamy bazy o tenanta `""`);
//   3. odczyt domeny w locie albo padnięty schodzi na host karty - kokpit nie
//      może zawisnąć ani wywrócić się na błędzie tej jednej, pobocznej tabeli;
//   4. TRZY STANY (`status`): padnięty odczyt NIE jest „rozstrzygnięty" - inaczej
//      sondy karty fundamentów ruszały na originie tymczasowym (pliki marki);
//   5. `is_default` odróżnia markę bez domeny od innego tenanta bez domeny.
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { waitFor } from "@testing-library/react";
import { renderHookWithQueryClient } from "@/test/renderWithQueryClient";
import { CANONICAL_SITE_ORIGIN } from "@/lib/http/host";
import { useTenantPublicOrigin, useTenantPublicOriginState } from "@/lib/seo/useTenantPublicOrigin";

const h = vi.hoisted(() => ({
  tenantId: "t-1" as string | null,
  /** Wiersz `tenants` oddawany przez `maybeSingle()`. */
  tenantRow: null as { domain: string | null; is_default?: boolean } | null,
  /** Błąd odczytu `tenants` (null = odczyt się udaje). */
  tenantError: null as Error | null,
  /** Obietnica, którą odczyt ma czekać (null = odpowiedź od razu). */
  gate: null as Promise<void> | null,
  /** Wywołania łańcucha: tabela + filtry. */
  calls: [] as Array<{ table: string; select?: string; eq?: [string, unknown] }>,
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ tenantId: h.tenantId }),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      const call: (typeof h.calls)[number] = { table };
      h.calls.push(call);
      const link = {
        select: (columns: string) => {
          call.select = columns;
          return link;
        },
        eq: (column: string, value: unknown) => {
          call.eq = [column, value];
          return link;
        },
        maybeSingle: async () => {
          if (h.gate) await h.gate;
          return { data: h.tenantError ? null : h.tenantRow, error: h.tenantError };
        },
      };
      return link;
    },
  },
}));

beforeEach(() => {
  h.tenantId = "t-1";
  h.tenantRow = null;
  h.tenantError = null;
  h.gate = null;
  h.calls = [];
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** Host karty widziany przez hook - happy-dom nie zmienia go nawigacją. */
function stubBrowserHost(host: string) {
  vi.spyOn(window, "location", "get").mockReturnValue({
    ...window.location,
    host,
  } as Location);
}

describe("useTenantPublicOrigin", () => {
  it("domena z wiersza WŁASNEGO tenanta wyznacza origin kokpitu", async () => {
    h.tenantRow = { domain: "analizy.example.org" };
    const { result } = renderHookWithQueryClient(() => useTenantPublicOrigin());
    await waitFor(() => expect(result.current).toBe("https://analizy.example.org"));
    expect(h.calls).toEqual([
      { table: "tenants", select: "domain, is_default", eq: ["id", "t-1"] },
    ]);
  });

  it("tenant domyślny z domeną marki zostaje na originie kanonicznym", async () => {
    h.tenantRow = { domain: "neweuropeanstrategies.com" };
    const { result } = renderHookWithQueryClient(() => useTenantPublicOrigin());
    await waitFor(() => expect(h.calls).toHaveLength(1));
    expect(result.current).toBe(CANONICAL_SITE_ORIGIN);
  });

  it("brak domeny w bazie: host karty na localhost/podglądzie daje origin kanoniczny", async () => {
    stubBrowserHost("localhost:3000");
    h.tenantRow = { domain: null };
    const { result } = renderHookWithQueryClient(() => useTenantPublicOrigin());
    await waitFor(() => expect(h.calls).toHaveLength(1));
    expect(result.current).toBe(CANONICAL_SITE_ORIGIN);
  });

  it("brak domeny w bazie: własny host karty zostaje originem", async () => {
    stubBrowserHost("analizy.example.org");
    h.tenantRow = { domain: null };
    const { result } = renderHookWithQueryClient(() => useTenantPublicOrigin());
    await waitFor(() => expect(h.calls).toHaveLength(1));
    expect(result.current).toBe("https://analizy.example.org");
  });

  it("w trakcie odczytu domeny origin idzie z hosta karty, po odczycie - z bazy", async () => {
    let release = () => {};
    h.gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    stubBrowserHost("localhost:3000");
    h.tenantRow = { domain: "analizy.example.org" };
    const { result } = renderHookWithQueryClient(() => useTenantPublicOrigin());
    expect(result.current).toBe(CANONICAL_SITE_ORIGIN);
    release();
    await waitFor(() => expect(result.current).toBe("https://analizy.example.org"));
  });

  it("padnięty odczyt `tenants` schodzi na host karty, zamiast wywracać kokpit", async () => {
    stubBrowserHost("analizy.example.org");
    h.tenantError = new Error("permission denied for table tenants");
    const { result, queryClient } = renderHookWithQueryClient(() => useTenantPublicOrigin());
    await waitFor(() =>
      expect(queryClient.getQueryState(["tenant-public-domain", "t-1"])?.status).toBe("error"),
    );
    expect(result.current).toBe("https://analizy.example.org");
  });

  it("`status` to `pending`, dopóki domena nie dojedzie - i `resolved` po odczycie", async () => {
    let release = () => {};
    h.gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    h.tenantRow = { domain: "analizy.example.org" };
    const { result } = renderHookWithQueryClient(() => useTenantPublicOriginState());
    expect(result.current.status).toBe("pending");
    release();
    await waitFor(() => expect(result.current.status).toBe("resolved"));
    expect(result.current.origin).toBe("https://analizy.example.org");
  });

  it("padnięty odczyt to `failed`, NIE `resolved` - sondy nie mogą ruszyć na originie tymczasowym", async () => {
    // Odwrócony przypięty stan z 1. rundy: wcześniej `settled` było `true` także
    // po błędzie, więc karta sondowała host karty (pliki marki) i trzymała ten
    // zielony wynik minutę w cache - dokładnie to, przed czym bramka miała chronić.
    h.tenantError = new Error("permission denied for table tenants");
    const { result } = renderHookWithQueryClient(() => useTenantPublicOriginState());
    await waitFor(() => expect(result.current.status).toBe("failed"));
    // Linkom zostaje wartość tymczasowa - one i tak przerysują się po ponowieniu.
    expect(result.current.origin).toBe(CANONICAL_SITE_ORIGIN);
  });

  it("`retry` po awarii ponawia odczyt i rozstrzyga origin z bazy", async () => {
    h.tenantError = new Error("timeout");
    h.tenantRow = { domain: "analizy.example.org" };
    const { result } = renderHookWithQueryClient(() => useTenantPublicOriginState());
    await waitFor(() => expect(result.current.status).toBe("failed"));
    h.tenantError = null;
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.status).toBe("resolved"));
    expect(result.current.origin).toBe("https://analizy.example.org");
    expect(h.calls).toHaveLength(2);
  });

  it("bez tenanta `resolved` od razu - nie ma na co czekać", () => {
    h.tenantId = null;
    const { result } = renderHookWithQueryClient(() => useTenantPublicOriginState());
    expect(result.current.status).toBe("resolved");
    expect(result.current.origin).toBe(CANONICAL_SITE_ORIGIN);
  });

  it("tenant NIEDOMYŚLNY bez domeny nie dostaje originu marki (null)", async () => {
    stubBrowserHost("localhost:3000");
    h.tenantRow = { domain: null, is_default: false };
    const { result } = renderHookWithQueryClient(() => useTenantPublicOriginState());
    await waitFor(() => expect(result.current.status).toBe("resolved"));
    expect(result.current.origin).toBeNull();
  });

  it("tenant DOMYŚLNY bez domeny zostaje na originie kanonicznym", async () => {
    stubBrowserHost("localhost:3000");
    h.tenantRow = { domain: null, is_default: true };
    const { result } = renderHookWithQueryClient(() => useTenantPublicOriginState());
    await waitFor(() => expect(result.current.status).toBe("resolved"));
    expect(result.current.origin).toBe(CANONICAL_SITE_ORIGIN);
  });

  it("host karty wraca w stanie - karta fundamentów ocenia nim spadek same-origin", () => {
    stubBrowserHost("analizy.example.org");
    const { result } = renderHookWithQueryClient(() => useTenantPublicOriginState());
    expect(result.current.host).toBe("analizy.example.org");
  });

  it("bez tenanta NIE pyta bazy i nie bierze domeny z poprzedniego tenanta", async () => {
    h.tenantId = null;
    h.tenantRow = { domain: "analizy.example.org" };
    const { result } = renderHookWithQueryClient(() => useTenantPublicOrigin());
    expect(result.current).toBe(CANONICAL_SITE_ORIGIN);
    expect(h.calls).toEqual([]);
  });
});
