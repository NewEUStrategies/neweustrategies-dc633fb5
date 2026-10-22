// Karta kasy: okno porzucenia (`checkout_settings.abandon_after_minutes`, I9a).
//
// CO TEN PLIK DOWODZI.
//   1. Pole pokazuje wartość z serwera (wiersz bez kolumny = domyślne 1440),
//      ma etykietę, podpowiedź z granicami i podpowiedź-dymek, która mówi
//      o porzuceniu kasy i o rezerwacjach biletów (Z-S3-07) - PL i EN.
//   2. Wartość spoza 30-1440, ułamek albo puste pole są ODRZUCANE: komunikat
//      `role="alert"`, `aria-invalid`, zapis wyłączony i ani jednego zapytania
//      - nigdy przycięcie do najbliższej granicy (AGENTS).
//   3. Poprawna wartość jedzie istniejącym mutatorem S1: UPDATE warunkowany
//      SUROWYM tokenem `updated_at` (CAS) razem z resztą ustawień.
//
// SŁOWNIK PRAWDZIWY: asercje mierzą napis, który zobaczy admin, więc
// zniknięcie klucza oblewa test. Tłumacz wjeżdża zwykłym importem i jest
// wstrzykiwany do atrapy - fabryka `vi.mock` importująca `@/test/i18nReal`
// zakleszcza plik (wzór i uzasadnienie: `ReputationLevelChip.test.tsx`).
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ok, type RecordedChain, type SupabaseFromStub } from "@/test/supabase";

const h = vi.hoisted(() => ({ fixedT: null as null | ((lang: "pl" | "en") => unknown) }));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: h.fixedT?.("pl"), i18n: { language: "pl" }, ready: true }),
  initReactI18next: { type: "3rdParty" as const, init: () => {} },
}));
vi.mock("@/components/ui/select", async () =>
  (await import("@/test/reactStubs")).radixSelectStub(await import("react")),
);
vi.mock("@/components/ui/switch", async () =>
  (await import("@/test/reactStubs")).radixSwitchStub(await import("react")),
);
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("@/integrations/supabase/client", async () => {
  const { supabaseFromStub } = await import("@/test/supabase");
  const db = supabaseFromStub();
  return {
    supabase: {
      from: db.from,
      auth: {
        getSession: async () => ({ data: { session: { user: { id: "admin-1" } } }, error: null }),
      },
    },
    db,
  };
});

import * as client from "@/integrations/supabase/client";
import { realT } from "@/test/i18nReal";
import { CheckoutSettingsCard } from "@/components/admin/paywall/CheckoutSettingsCard";
import { DEFAULT_CHECKOUT_SETTINGS } from "@/lib/billing/checkoutSettings";
import "@/lib/i18n-admin-paywall-sync";

h.fixedT = realT;

const db: SupabaseFromStub = Reflect.get(client, "db");
const TOKEN = "2026-10-20T08:00:00.654321+00:00";
const ROW = { ...DEFAULT_CHECKOUT_SETTINGS, abandon_after_minutes: 90, updated_at: TOKEN };

/** Odczyt dostaje wiersz, zapis (UPDATE … SELECT) - tablicę z nowym tokenem. */
function respond(row: Record<string, unknown>) {
  db.setResponse("checkout_settings", (chain: RecordedChain) =>
    chain.has("update")
      ? ok([{ ...row, ...(chain.argsOf("update")?.[0] as object), updated_at: "po-zapisie" }])
      : ok(row),
  );
}

let qc: QueryClient;
beforeEach(() => {
  db.reset();
  respond(ROW);
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
afterEach(() => {
  cleanup();
  qc.clear();
});

const t = realT("pl");
const BOUNDS = { min: 30, max: 1440, fallback: 1440 };

async function mount(): Promise<HTMLInputElement> {
  render(
    <QueryClientProvider client={qc}>
      <CheckoutSettingsCard />
    </QueryClientProvider>,
  );
  return (await screen.findByLabelText(
    t("adminPaywall.checkout.abandonAfter"),
  )) as HTMLInputElement;
}

function saveButton(): HTMLElement {
  return screen.getByRole("button", { name: t("adminPaywall.checkout.save") });
}

function updates(): RecordedChain[] {
  return db.chainsFor("checkout_settings").filter((chain) => chain.has("update"));
}

describe("okno porzucenia kasy - pole w karcie ustawień kasy", () => {
  it("pokazuje wartość z serwera, granice i wyjaśnienie skutków (kasa i bilety)", async () => {
    const field = await mount();

    expect(field).toHaveValue(90);
    expect(field).toHaveAttribute("min", "30");
    expect(field).toHaveAttribute("max", "1440");
    expect(field).toHaveAttribute("aria-invalid", "false");
    // Opis pola = podpowiedź z granicami + treść dymka (czytnik dostaje oba).
    const described = (field.getAttribute("aria-describedby") ?? "")
      .split(" ")
      .map((id) => document.getElementById(id)?.textContent ?? "")
      .join(" ");
    expect(described).toContain(t("adminPaywall.checkout.abandonAfterHint", BOUNDS));
    expect(described).toContain("biletu");
    expect(described).toContain("porzucona");
    expect(
      screen.getByRole("button", { name: t("adminPaywall.checkout.abandonAfterHelp") }),
    ).toBeInTheDocument();
  });

  it("wiersz bez kolumny (najemca bez ustawień) pokazuje domyślne 1440", async () => {
    respond({ ...DEFAULT_CHECKOUT_SETTINGS, updated_at: TOKEN });
    const field = await mount();
    expect(field).toHaveValue(1440);
  });

  it.each(["20", "1441", "90.5", "", "-30"])(
    "wartość %j jest odrzucana: komunikat, aria-invalid, zapis wyłączony",
    async (typed) => {
      const field = await mount();
      fireEvent.change(field, { target: { value: typed } });

      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent(t("adminPaywall.checkout.abandonAfterInvalid", BOUNDS));
      expect(field).toHaveAttribute("aria-invalid", "true");
      expect(field.getAttribute("aria-describedby")).toContain(alert.id);
      expect(saveButton()).toBeDisabled();
      fireEvent.click(saveButton());
      expect(updates()).toHaveLength(0);
    },
  );

  it("poprawna wartość jedzie mutatorem S1 z tokenem (CAS), bez przycinania", async () => {
    const field = await mount();
    fireEvent.change(field, { target: { value: "45" } });
    expect(screen.queryByRole("alert")).toBeNull();

    fireEvent.click(saveButton());
    await waitFor(() => expect(updates()).toHaveLength(1));
    const [chain] = updates();
    expect(chain.argsOf("update")?.[0]).toMatchObject({
      ...DEFAULT_CHECKOUT_SETTINGS,
      abandon_after_minutes: 45,
      updated_by: "admin-1",
    });
    expect(chain.argsOf("eq")).toEqual(["updated_at", TOKEN]);
  });

  it("granice są wartościami poprawnymi (30 i 1440 zapisują się bez zmian)", async () => {
    const field = await mount();
    for (const minutes of ["30", "1440"]) {
      fireEvent.change(field, { target: { value: minutes } });
      expect(screen.queryByRole("alert")).toBeNull();
      expect(saveButton()).not.toBeDisabled();
    }
  });
});

describe("okno porzucenia kasy - słownik PL/EN", () => {
  it("etykieta, podpowiedź, dymek i błąd istnieją w obu językach i różnią się", () => {
    const pl = realT("pl");
    const en = realT("en");
    for (const key of [
      "adminPaywall.checkout.abandonAfter",
      "adminPaywall.checkout.abandonAfterHint",
      "adminPaywall.checkout.abandonAfterHelp",
      "adminPaywall.checkout.abandonAfterTooltip",
      "adminPaywall.checkout.abandonAfterInvalid",
    ]) {
      expect(pl(key, BOUNDS), key).not.toBe(key);
      expect(en(key, BOUNDS), key).not.toBe(key);
      expect(pl(key, BOUNDS), key).not.toBe(en(key, BOUNDS));
    }
    // Dymek mówi o obu skutkach: porzuceniu kasy i rezerwacji biletu.
    expect(en("adminPaywall.checkout.abandonAfterTooltip", BOUNDS)).toMatch(/abandoned/);
    expect(en("adminPaywall.checkout.abandonAfterTooltip", BOUNDS)).toMatch(/ticket/);
    expect(pl("adminPaywall.checkout.abandonAfterHint", BOUNDS)).toContain("30");
    expect(pl("adminPaywall.checkout.abandonAfterHint", BOUNDS)).toContain("1440");
  });
});
