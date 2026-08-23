// Dwa hooki edytora treści maili transakcyjnych (`txOverrides.ts:143-167`).
//
// CZEGO PILNUJĄ. `site_settings` to JEDEN wiersz jsonb na klucz, a nadpisania
// treści są addytywne: puste pole = wraca domyślna treść z `tx-copy`/`tx-body`.
// Dwa błędy w tej parze hooków są nieodwracalne z punktu widzenia odbiorcy:
//
//   1. ODCZYT, który nie odsiewa zepsutego kształtu. `useTxOverrides` czyta
//      `site_settings` i przepuszcza wynik przez `parseTxOverrides`. Gdyby tego
//      nie robił, wiersz zapisany przez starszą wersję panelu wywróciłby
//      RENDER MAILA - a nie panel, bo z tego samego modułu czyta sender
//      (`transactional.server.ts`).
//   2. ZAPIS bez walidacji albo bez `onConflict` na kluczu najemcy. Pierwszy
//      wpuściłby do bazy kształt, którego nie da się odczytać; drugi wstawiłby
//      DRUGI wiersz zamiast nadpisać istniejący, i edytor pokazywałby stare
//      treści, a wysyłka używała nowych (albo odwrotnie).
//
// CZEGO NIE DUBLUJE. Same schematy zod, `interpolate`, `overrideFor`
// i `resolvedField` mają test jednostkowy w `txOverrides.test.ts`. Tutaj
// dowodzimy WYŁĄCZNIE tego, co robią hooki: kształtu zapytania, walidacji przed
// zapisem, unieważnienia obu cache i ścieżki błędu.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import type { SupabaseFromStub } from "@/test/supabaseChain";

const h = vi.hoisted(() => ({
  db: null as SupabaseFromStub | null,
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  /** Ostatnia wartość, jaką atrapa `useSiteSetting` ma oddać hookowi odczytu. */
  siteSetting: null as unknown,
  siteSettingCalls: [] as { key: string; defaults: unknown }[],
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      if (!h.db) throw new Error("test: atrapa bazy nieustawiona");
      return h.db.from(table);
    },
  },
}));
vi.mock("sonner", () => ({ toast: { success: h.toastSuccess, error: h.toastError } }));
vi.mock("@/lib/useSiteSetting", () => ({
  useSiteSetting: (key: string, defaults: unknown) => {
    h.siteSettingCalls.push({ key, defaults });
    return h.siteSetting;
  },
}));

import { fail, ok, supabaseFromStub } from "@/test/supabaseChain";
import {
  EMPTY_TX_COPY_OVERRIDE,
  overrideFor,
  resolvedField,
  TX_OVERRIDES_DEFAULTS,
  TX_OVERRIDES_SETTING_KEY,
  useSaveTxOverrides,
  useTxOverrides,
  type TxOverrides,
} from "../txOverrides";

function wrapper(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

function newClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

beforeEach(() => {
  h.db = supabaseFromStub();
  h.db.setResponse("site_settings", ok(null));
  h.toastSuccess.mockClear();
  h.toastError.mockClear();
  h.siteSetting = TX_OVERRIDES_DEFAULTS;
  h.siteSettingCalls.length = 0;
});

/** Nadpisanie w kształcie, jaki zapisuje panel: jeden typ, jeden język. */
function overrides(): TxOverrides {
  return {
    ...TX_OVERRIDES_DEFAULTS,
    team_seat_grace: {
      ...TX_OVERRIDES_DEFAULTS.team_seat_grace,
      pl: {
        ...TX_OVERRIDES_DEFAULTS.team_seat_grace.pl,
        subject: "Dostęp w {orgName} wygasa za {daysLeft} dni",
      },
    },
  };
}

describe("useTxOverrides - odczyt nadpisań", () => {
  it("czyta ustawienie POD WŁAŚCIWYM kluczem i z pełnymi wartościami domyślnymi", () => {
    // Literówka w kluczu dałaby edytor, który zawsze pokazuje pustkę i zawsze
    // zapisuje „od zera" - czyli po cichu kasuje wcześniejsze nadpisania.
    const client = newClient();

    renderHook(() => useTxOverrides(), { wrapper: wrapper(client) });

    expect(h.siteSettingCalls).toHaveLength(1);
    expect(h.siteSettingCalls[0].key).toBe(TX_OVERRIDES_SETTING_KEY);
    expect(h.siteSettingCalls[0].defaults).toEqual(TX_OVERRIDES_DEFAULTS);
  });

  it("oddaje zapisane nadpisanie bez zmian", () => {
    const zapisane = overrides();
    h.siteSetting = zapisane;
    const client = newClient();

    const { result } = renderHook(() => useTxOverrides(), { wrapper: wrapper(client) });

    expect(result.current.team_seat_grace.pl.subject).toBe(
      "Dostęp w {orgName} wygasa za {daysLeft} dni",
    );
  });

  it("ZEPSUTY kształt w bazie wraca jako wartości domyślne, a nie wywraca renderu maila", () => {
    // Ten sam moduł czyta sender, więc wyjątek tutaj nie zatrzymałby panelu -
    // zatrzymałby wysyłkę potwierdzeń i ostrzeżeń o utracie dostępu.
    h.siteSetting = { team_seat_grace: "to nie jest obiekt" };
    const client = newClient();

    const { result } = renderHook(() => useTxOverrides(), { wrapper: wrapper(client) });

    expect(result.current).toEqual(TX_OVERRIDES_DEFAULTS);
  });

  it("brak ustawienia (null) też daje wartości domyślne", () => {
    h.siteSetting = null;
    const client = newClient();

    const { result } = renderHook(() => useTxOverrides(), { wrapper: wrapper(client) });

    expect(result.current).toEqual(TX_OVERRIDES_DEFAULTS);
  });
});

describe("useSaveTxOverrides - zapis nadpisań", () => {
  it("zapisuje przez upsert z konfliktem na (tenant_id, key)", async () => {
    // Bez `onConflict` powstałby DRUGI wiersz dla tego samego najemcy: edytor
    // czytałby jeden, sender drugi, a rozjazd byłby niewidoczny do pierwszej
    // wysyłki z nieaktualną treścią.
    const client = newClient();
    const { result } = renderHook(() => useSaveTxOverrides(), { wrapper: wrapper(client) });

    await act(async () => {
      await result.current.mutateAsync(overrides());
    });

    const chain = h.db?.lastChain("site_settings");
    expect(chain?.has("upsert")).toBe(true);
    const [wiersz, opcje] = chain?.argsOf("upsert") ?? [];
    expect((wiersz as { key: string }).key).toBe(TX_OVERRIDES_SETTING_KEY);
    expect(opcje).toEqual({ onConflict: "tenant_id,key" });
  });

  it("zapisuje wartość PO walidacji schematem, nie surowe wejście", async () => {
    const client = newClient();
    const { result } = renderHook(() => useSaveTxOverrides(), { wrapper: wrapper(client) });

    await act(async () => {
      await result.current.mutateAsync(overrides());
    });

    const [wiersz] = h.db?.lastChain("site_settings")?.argsOf("upsert") ?? [];
    const value = (wiersz as { value: Record<string, { pl: { subject: string } }> }).value;
    expect(value.team_seat_grace.pl.subject).toBe("Dostęp w {orgName} wygasa za {daysLeft} dni");
  });

  it("unieważnia OBA cache - ustawienia i podglądy maili", async () => {
    // Podgląd w panelu czyta te same nadpisania. Bez drugiego unieważnienia
    // redaktor zapisuje zmianę i widzi w podglądzie starą treść, więc zapisuje
    // ponownie „bo nie zadziałało".
    const client = newClient();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => useSaveTxOverrides(), { wrapper: wrapper(client) });

    await act(async () => {
      await result.current.mutateAsync(overrides());
    });

    const klucze = invalidate.mock.calls.map((call) =>
      JSON.stringify((call[0] as { queryKey: unknown[] }).queryKey),
    );
    expect(klucze).toContain(JSON.stringify(["site_settings_public", "all"]));
    expect(klucze).toContain(JSON.stringify(["email-previews"]));
  });

  it("potwierdza zapis komunikatem sukcesu", async () => {
    const client = newClient();
    const { result } = renderHook(() => useSaveTxOverrides(), { wrapper: wrapper(client) });

    await act(async () => {
      await result.current.mutateAsync(overrides());
    });

    expect(h.toastSuccess).toHaveBeenCalledTimes(1);
    expect(h.toastError).not.toHaveBeenCalled();
  });

  it("błąd zapisu NIE udaje sukcesu - mutacja odrzuca i melduje", async () => {
    h.db?.setResponse("site_settings", fail("new row violates row-level security policy"));
    const client = newClient();
    const { result } = renderHook(() => useSaveTxOverrides(), { wrapper: wrapper(client) });

    await act(async () => {
      await expect(result.current.mutateAsync(overrides())).rejects.toThrow(/row-level security/);
    });

    await waitFor(() => expect(h.toastError).toHaveBeenCalledTimes(1));
    expect(h.toastSuccess).not.toHaveBeenCalled();
  });

  it("błąd bez komunikatu dostaje zastępczy tekst, a nie pusty toast", async () => {
    // Pusty dymek jest gorszy od braku dymka: użytkownik widzi, że coś mrugnęło,
    // i nie wie, czy zapis przeszedł.
    h.db?.setResponse("site_settings", fail(""));
    const client = newClient();
    const { result } = renderHook(() => useSaveTxOverrides(), { wrapper: wrapper(client) });

    await act(async () => {
      await expect(result.current.mutateAsync(overrides())).rejects.toBeTruthy();
    });

    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("Błąd zapisu"));
  });

  it("kształt niezgodny ze schematem NIE dociera do bazy", async () => {
    // Walidacja przed zapisem jest tym, co utrzymuje odczyt bezpiecznym:
    // do bazy nie może trafić nic, czego `parseTxOverrides` nie odczyta.
    const client = newClient();
    const { result } = renderHook(() => useSaveTxOverrides(), { wrapper: wrapper(client) });
    // Niezgodne wejście budowane przez `Object.assign`, a nie rzutowaniem:
    // przecięcie typów zostaje przypisywalne do `TxOverrides`, więc test nie
    // potrzebuje `as unknown as` (w tym repo pod ratchetem).
    const zly: TxOverrides = Object.assign({}, overrides(), {
      team_seat_grace: { pl: { subject: 42 } },
    });

    await act(async () => {
      await expect(result.current.mutateAsync(zly)).rejects.toBeTruthy();
    });

    expect(h.db?.chainsFor("site_settings")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Dobicie gałęzi odczytu nadpisania: przypadki, w które NIE wchodzi
// `txOverrides.test.ts`, a które decydują o TREŚCI wysłanego maila.
// ---------------------------------------------------------------------------
describe("overrideFor i resolvedField - brzegi, które widzi dopiero odbiorca", () => {
  it("typ maila SPOZA listy edytowalnych nie dostaje żadnego nadpisania", () => {
    // Panel edytuje tylko cykl miejsc zespołowych. Gdyby `overrideFor`
    // przepuszczał inne typy, potwierdzenie płatności mogłoby dostać treść
    // wpisaną dla zupełnie innego zdarzenia.
    expect(overrideFor(TX_OVERRIDES_DEFAULTS, "payment_failed", "pl")).toEqual(
      EMPTY_TX_COPY_OVERRIDE,
    );
  });

  it("brak gałęzi językowej w zapisanym nadpisaniu wraca do treści domyślnej", () => {
    // Wiersz zapisany przed dodaniem drugiego języka nie ma klucza `en`.
    // Bez tego zapasu render maila czytałby `undefined.subject`.
    const bezAngielskiego: TxOverrides = Object.assign({}, TX_OVERRIDES_DEFAULTS, {
      team_seat_grace: { pl: TX_OVERRIDES_DEFAULTS.team_seat_grace.pl },
    });

    expect(overrideFor(bezAngielskiego, "team_seat_grace", "en")).toEqual(EMPTY_TX_COPY_OVERRIDE);
  });

  it("brak pola w nadpisaniu to `null`, czyli „użyj domyślnej treści”", () => {
    const bezTematu = Object.assign({}, EMPTY_TX_COPY_OVERRIDE, { subject: undefined });

    expect(resolvedField(bezTematu, "subject", {})).toBeNull();
  });

  it("pole złożone WYŁĄCZNIE z nieznanych tokenów daje `null`, a nie pusty temat", () => {
    // Interpolacja zjada nieznane tokeny. Bez tego zapasu mail wyszedłby
    // z PUSTYM tematem - w skrzynce odbiorcy na zawsze.
    const override = { ...EMPTY_TX_COPY_OVERRIDE, subject: "{nieznanyToken}" };

    expect(resolvedField(override, "subject", {})).toBeNull();
  });

  it("pole z tokenem o wartości `null` też nie zostawia pustego tematu", () => {
    const override = { ...EMPTY_TX_COPY_OVERRIDE, subject: "{orgName}" };

    expect(resolvedField(override, "subject", { orgName: null })).toBeNull();
  });
});
