// Warstwa danych ŚCIEŻKI REZYGNACJI - 14% linii pokrytych do 18.08.2026.
//
// Dwa odczyty, od których zależy cały ekran „zanim odejdziesz": parametry
// kontroferty i katalog powodów odejścia. Ich kontrakt decyduje o tym, ile
// pieniędzy proponujemy odchodzącemu klientowi i co on wybierze jako powód -
// a więc też o tym, co redakcja zobaczy w statystykach.
//
// Reguła najłatwiejsza do zgubienia: powody są filtrowane po `active = true`.
// Bez tego filtru wyłączony powód wracałby na ekran rezygnacji, mimo że
// redakcja świadomie go zdjęła.
import { beforeEach, describe, expect, it, vi } from "vitest";

import { waitFor } from "@testing-library/react";

import { ok, supabaseFromStub, type SupabaseFromStub } from "@/test/supabaseChain";
import { retentionReason, retentionSettings } from "@/test/billing/fixtures";
import { renderHookWithQueryClient } from "@/test/renderWithQueryClient";

let chain: SupabaseFromStub;

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: (table: string) => chain.from(table) },
}));

const {
  retentionReasonsQueryOptions,
  retentionSettingsQueryOptions,
  reasonLabel,
  useRetentionSettings,
  useRetentionReasons,
} = await import("@/lib/retention/queries");

/** Uruchamia `queryFn` opcji tak, jak zrobiłby to react-query. */
async function run<T>(options: { queryFn?: unknown }): Promise<T> {
  return (options.queryFn as () => Promise<T>)();
}

beforeEach(() => {
  chain = supabaseFromStub();
  chain.setResponse("retention_settings", ok(retentionSettings()));
  chain.setResponse("retention_reasons", ok([retentionReason()]));
});

describe("retentionSettingsQueryOptions - parametry kontroferty", () => {
  it("czyta JEDEN wiersz ustawień (tenant zawęża RLS, nie kod)", async () => {
    await run(retentionSettingsQueryOptions());

    expect(chain.lastChain("retention_settings")!.has("maybeSingle")).toBe(true);
  });

  it("zwraca zapisane wartości bez przetwarzania", async () => {
    chain.setResponse("retention_settings", ok(retentionSettings({ discount_pct: 25 })));

    const settings = await run<{ discount_pct: number }>(retentionSettingsQueryOptions());

    expect(settings.discount_pct).toBe(25);
  });

  it("BRAK wiersza daje `null` - kontrofertę wyliczy się z wartości domyślnych", async () => {
    chain.setResponse("retention_settings", ok(null));

    expect(await run(retentionSettingsQueryOptions())).toBeNull();
  });

  it("BŁĄD odczytu jest zgłaszany, nie zamieniany na brak ustawień", async () => {
    // „Brak ustawień" przy błędzie odczytu pokazałby klientowi domyślny rabat
    // 30%, także wtedy, gdy redakcja świadomie ustawiła inny albo wyłączyła
    // kontrofertę.
    chain.setResponse("retention_settings", {
      data: null,
      error: Object.assign(new Error("permission denied"), { name: "PostgrestError" }),
    });

    await expect(run(retentionSettingsQueryOptions())).rejects.toThrow("permission denied");
  });

  it("ustawienia są krótko świeże - klient nie widzi wczorajszego rabatu", () => {
    expect(retentionSettingsQueryOptions().staleTime).toBe(60_000);
    expect(retentionSettingsQueryOptions().queryKey).toEqual(["retention-settings"]);
  });
});

describe("retentionReasonsQueryOptions - katalog powodów odejścia", () => {
  it("czyta WYŁĄCZNIE powody aktywne", async () => {
    // Wyłączony powód nie może wrócić na ekran rezygnacji.
    await run(retentionReasonsQueryOptions());

    expect(chain.lastChain("retention_reasons")!.argsOf("eq")).toEqual(["active", true]);
  });

  it("czyta w kolejności redakcyjnej - pierwszy powód jest wybierany najczęściej", async () => {
    await run(retentionReasonsQueryOptions());

    expect(chain.lastChain("retention_reasons")!.argsOf("order")).toEqual([
      "sort_order",
      { ascending: true },
    ]);
  });

  it("brak powodów daje pustą listę, nie `null`", async () => {
    chain.setResponse("retention_reasons", { data: null, error: null });

    expect(await run(retentionReasonsQueryOptions())).toEqual([]);
  });

  it("BŁĄD odczytu jest zgłaszany", async () => {
    chain.setResponse("retention_reasons", {
      data: null,
      error: Object.assign(new Error("row level security"), { name: "PostgrestError" }),
    });

    await expect(run(retentionReasonsQueryOptions())).rejects.toThrow("row level security");
  });

  it("klucz zapytania jest wspólny z panelem admina (jedno unieważnienie)", () => {
    expect(retentionReasonsQueryOptions().queryKey).toEqual(["retention-reasons"]);
  });
});

describe("reasonLabel - powód w języku klienta", () => {
  it("pokazuje etykietę w języku strony", () => {
    const reason = retentionReason({ label_pl: "Za drogo", label_en: "Too expensive" });

    expect(reasonLabel(reason, "pl")).toBe("Za drogo");
    expect(reasonLabel(reason, "en")).toBe("Too expensive");
  });

  it("BRAK tłumaczenia schodzi na drugi język, nie na pustkę", () => {
    // Powód bez etykiety byłby pustym przyciskiem na ekranie rezygnacji.
    const onlyPl = retentionReason({ label_pl: "Za drogo", label_en: "" });
    const onlyEn = retentionReason({ label_pl: "", label_en: "Too expensive" });

    expect(reasonLabel(onlyPl, "en")).toBe("Za drogo");
    expect(reasonLabel(onlyEn, "pl")).toBe("Too expensive");
  });

  it("nieznany język traktujemy jak polski", () => {
    const reason = retentionReason({ label_pl: "Za drogo", label_en: "Too expensive" });

    expect(reasonLabel(reason, "de")).toBe("Za drogo");
  });
});

// ---------------------------------------------------------------------------
// HOOKI. Do 19.08.2026 obie funkcje stały na zerze, mimo że to one - a nie same
// `queryOptions` - decydują, KIEDY ekran rezygnacji sięga do bazy. Cała ich
// treść to flaga `enabled`, więc test, który jej nie sprawdza, nie sprawdza
// niczego: modal anulowania subskrypcji jest zamontowany na stronie konta
// stale, a odczyt ma ruszyć dopiero po jego otwarciu.
// ---------------------------------------------------------------------------

describe("useRetentionSettings - odczyt parametrów kontroferty", () => {
  it("WYŁĄCZONY hook nie dotyka bazy - zamknięty modal nie generuje zapytań", async () => {
    const { result } = renderHookWithQueryClient(() => useRetentionSettings(false));

    // Nie ma czego „poczekać" - dowodem jest BRAK łańcucha zapytania.
    expect(chain.lastChain("retention_settings")).toBeUndefined();
    expect(result.current.fetchStatus).toBe("idle");
  });

  it("WŁĄCZONY hook zwraca zapisane ustawienia", async () => {
    chain.setResponse("retention_settings", ok(retentionSettings({ discount_pct: 25 })));

    const { result } = renderHookWithQueryClient(() => useRetentionSettings(true));

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.discount_pct).toBe(25);
  });

  it("BRAK wiersza ustawień daje `null`, a nie błąd - kontroferta zejdzie na domyślne", async () => {
    chain.setResponse("retention_settings", ok(null));

    const { result } = renderHookWithQueryClient(() => useRetentionSettings(true));

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
  });

  it("BŁĄD odczytu ląduje w stanie błędu, nie w danych", async () => {
    chain.setResponse("retention_settings", {
      data: null,
      error: Object.assign(new Error("permission denied"), { name: "PostgrestError" }),
    });

    const { result } = renderHookWithQueryClient(() => useRetentionSettings(true));

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toBeUndefined();
  });
});

describe("useRetentionReasons - odczyt katalogu powodów", () => {
  it("WYŁĄCZONY hook nie dotyka bazy", async () => {
    const { result } = renderHookWithQueryClient(() => useRetentionReasons(false));

    expect(chain.lastChain("retention_reasons")).toBeUndefined();
    expect(result.current.fetchStatus).toBe("idle");
  });

  it("WŁĄCZONY hook czyta wyłącznie powody aktywne, w kolejności redakcyjnej", async () => {
    const { result } = renderHookWithQueryClient(() => useRetentionReasons(true));

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(chain.lastChain("retention_reasons")!.argsOf("eq")).toEqual(["active", true]);
    expect(chain.lastChain("retention_reasons")!.argsOf("order")).toEqual([
      "sort_order",
      { ascending: true },
    ]);
  });

  it("pusty katalog daje pustą listę - ekran rezygnacji renderuje się bez powodów", async () => {
    chain.setResponse("retention_reasons", { data: null, error: null });

    const { result } = renderHookWithQueryClient(() => useRetentionReasons(true));

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });

  it("BŁĄD odczytu ląduje w stanie błędu", async () => {
    chain.setResponse("retention_reasons", {
      data: null,
      error: Object.assign(new Error("row level security"), { name: "PostgrestError" }),
    });

    const { result } = renderHookWithQueryClient(() => useRetentionReasons(true));

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toBeUndefined();
  });

  it("hook i opcje dzielą KLUCZ - zapis w panelu admina unieważnia oba odczyty", async () => {
    // Gdyby hook budował własny klucz, panel admina zapisywałby powody, a
    // ekran rezygnacji pokazywałby stare aż do przeładowania strony.
    const { result, queryClient } = renderHookWithQueryClient(() => useRetentionReasons(true));

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const keys = queryClient
      .getQueryCache()
      .getAll()
      .map((q) => q.queryKey);
    expect(keys).toContainEqual(retentionReasonsQueryOptions().queryKey);
    expect(keys).toHaveLength(1);
  });
});
