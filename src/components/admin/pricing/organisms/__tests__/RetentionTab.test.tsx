// Zakładka „Retencja odchodzących" wraz z jej czterema molekułami - 0 z 14
// funkcji pokrytych do 18.08.2026 (mieszkała w pliku trasy `/admin/pricing`).
//
// Tu ustawia się, ILE PIENIĘDZY oddajemy klientowi, który chce odejść: procent
// rabatu, liczba okresów z rabatem, ważność kodu. Trzy rzeczy są sprawdzane
// twardo, bo każda z nich mogłaby cicho zmienić kwotę albo wprowadzić redakcję
// w błąd:
//   - liczby z pól tekstowych są PRZYCINANE do zakresu przy zapisie,
//   - skuteczność liczy się od POKAZANYCH ofert, nie od wszystkich rezygnacji,
//   - odrzucona kontroferta i „oferty nie było" to DWA różne stany na liście.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";

import {
  ADMIN_NOW,
  isoDaysAgo,
  ok,
  radixSwitchStub,
  reactI18nextStub,
  retentionFeedback,
  supabaseFromStub,
  type SupabaseFromStub,
} from "@/test/admin/pricingFixtures";
import { retentionReason, retentionSettings } from "@/test/billing/fixtures";
import { freezeClock } from "@/test/time";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";

// ZAMROŻENIE ZEGARA NA KOTWICY FIXTURE'ÓW.
//
// Ten plik nie niesie ANI JEDNEGO literału daty - i mimo to był bombą.
// Literał siedzi piętro niżej, w WSPÓŁDZIELONEJ fabryce:
// `ADMIN_NOW = Date.parse("2026-08-18T10:00:00.000Z")`
// (`src/test/admin/pricingFixtures.ts:46`), z której `isoDaysAgo()` liczy
// wszystkie daty wierszy. Komponent liczy swoje okno z PRAWDZIWEGO zegara, więc
// z każdą dobą dane fixture'ów oddalały się od tego okna. Zmierzone przy
// CLOCK_SHIFT=1y: 2 czerwone z 27, obie na odsetku wyliczanym z wierszy, które
// wypadły z okna.
//
// Zamrożenie na `ADMIN_NOW` zrównuje „teraz" komponentu z kotwicą fabryki, więc
// odległość danych do „teraz" przestaje zależeć od dnia przebiegu.
//
// UWAGA NA PRZYSZŁOŚĆ: tej klasy bomby NIE WIDZI bramka `check:clock-freeze` -
// szuka literałów w PLIKU TESTOWYM, a ten leży w module fabryk. Ta sama kotwica
// karmi kilkanaście innych plików testowych.
freezeClock(ADMIN_NOW);

let chain: SupabaseFromStub;

vi.mock("react-i18next", () => reactI18nextStub());
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: (table: string) => chain.from(table) },
}));
vi.mock("@/components/ui/switch", async () => radixSwitchStub(await import("react")));

const toastSuccess = vi.fn();
const toastError = vi.fn();
const confirmStub = vi.fn(() => true);
vi.mock("sonner", () => ({ toast: { success: toastSuccess, error: toastError } }));

const { RetentionTab } = await import("@/components/admin/pricing/organisms/RetentionTab");

/** Pole liczbowe ustawień w kolejności: rabat, okresy, ważność kodu. */
function numberField(index: number): HTMLElement {
  return screen.getAllByRole("spinbutton")[index];
}

/**
 * Czeka, aż ustawienia Z BAZY zastąpią wartości domyślne. Bez tego test
 * klikałby „zapisz" przed przyjściem wiersza, a wtedy panel nie zna jeszcze
 * tenanta i słusznie odmawia zapisu - i test mierzyłby coś innego, niż opisuje.
 */
async function settingsLoaded(discountPct: number): Promise<void> {
  await waitFor(() => expect(numberField(0)).toHaveValue(discountPct));
}

/**
 * Wysłany `upsert` ustawień. Szukamy PO METODZIE, nie „ostatniego" łańcucha:
 * po udanym zapisie panel unieważnia zapytanie, więc ostatnim wywołaniem bywa
 * ponowny ODCZYT, a nie zapis.
 */
function settingsUpsert(): { payload: Record<string, unknown>; options: unknown } {
  const call = chain.chainsFor("retention_settings").find((c) => c.has("upsert"))!;
  const args = call.argsOf("upsert")!;
  return { payload: args[0] as Record<string, unknown>, options: args[1] };
}

beforeEach(() => {
  chain = supabaseFromStub();
  chain.setResponse("retention_settings", ok(retentionSettings()));
  chain.setResponse("retention_reasons", ok([]));
  chain.setResponse("retention_feedback", ok([]));
  toastSuccess.mockClear();
  toastError.mockClear();
  confirmStub.mockReturnValue(true);
  vi.stubGlobal("confirm", confirmStub);
});

describe("RetentionTab - ustawienia kontroferty", () => {
  it("wczytuje zapisane wartości do pól", async () => {
    chain.setResponse(
      "retention_settings",
      ok(retentionSettings({ discount_pct: 25, discount_periods: 2, coupon_valid_days: 10 })),
    );
    renderWithQueryClient(<RetentionTab />);

    await waitFor(() => expect(numberField(0)).toHaveValue(25));
    expect(numberField(1)).toHaveValue(2);
    expect(numberField(2)).toHaveValue(10);
  });

  it("BRAK wiersza ustawień nie wyłącza kontroferty - pokazuje domyślne 30/3/14", async () => {
    chain.setResponse("retention_settings", ok(null));
    renderWithQueryClient(<RetentionTab />);

    await waitFor(() => expect(numberField(0)).toHaveValue(30));
    expect(numberField(2)).toHaveValue(14);
  });

  it("RABAT 900% jest PRZYCINANY do maksimum, a nie zapisywany", async () => {
    chain.setResponse("retention_settings", ok(retentionSettings({ discount_pct: 25 })));
    renderWithQueryClient(<RetentionTab />);
    await settingsLoaded(25);

    fireEvent.change(numberField(0), { target: { value: "900" } });
    fireEvent.click(screen.getByRole("button", { name: /retention\.save/ }));

    await waitFor(() =>
      expect(chain.chainsFor("retention_settings").some((c) => c.has("upsert"))).toBe(true),
    );
    expect(settingsUpsert().payload.discount_pct).toBe(90);
  });

  it("rabat ujemny schodzi do minimum (rabat -30% to podwyżka)", async () => {
    chain.setResponse("retention_settings", ok(retentionSettings({ discount_pct: 25 })));
    renderWithQueryClient(<RetentionTab />);
    await settingsLoaded(25);

    fireEvent.change(numberField(0), { target: { value: "-30" } });
    fireEvent.click(screen.getByRole("button", { name: /retention\.save/ }));

    await waitFor(() =>
      expect(chain.chainsFor("retention_settings").some((c) => c.has("upsert"))).toBe(true),
    );
    expect(settingsUpsert().payload.discount_pct).toBe(1);
  });

  it("zapis idzie przez `upsert` po tenancie (jeden wiersz ustawień, nie kolejny)", async () => {
    chain.setResponse("retention_settings", ok(retentionSettings({ discount_pct: 25 })));
    renderWithQueryClient(<RetentionTab />);
    await settingsLoaded(25);

    fireEvent.click(screen.getByRole("button", { name: /retention\.save/ }));

    await waitFor(() =>
      expect(chain.chainsFor("retention_settings").some((c) => c.has("upsert"))).toBe(true),
    );
    expect(settingsUpsert().options).toEqual({ onConflict: "tenant_id" });
    expect(settingsUpsert().payload.tenant_id).toBeDefined();
  });

  it("WYŁĄCZENIE kontroferty zapisuje się jako `false`", async () => {
    chain.setResponse("retention_settings", ok(retentionSettings({ discount_pct: 25 })));
    renderWithQueryClient(<RetentionTab />);
    await settingsLoaded(25);

    fireEvent.click(screen.getAllByRole("switch")[0]);
    fireEvent.click(screen.getByRole("button", { name: /retention\.save/ }));

    await waitFor(() =>
      expect(chain.chainsFor("retention_settings").some((c) => c.has("upsert"))).toBe(true),
    );
    expect(settingsUpsert().payload.enabled).toBe(false);
  });

  it("liczba okresów i ważność kodu też są przycinane do zakresu", async () => {
    chain.setResponse("retention_settings", ok(retentionSettings({ discount_pct: 25 })));
    renderWithQueryClient(<RetentionTab />);
    await settingsLoaded(25);

    fireEvent.change(numberField(1), { target: { value: "99" } });
    fireEvent.change(numberField(2), { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: /retention\.save/ }));

    await waitFor(() =>
      expect(chain.chainsFor("retention_settings").some((c) => c.has("upsert"))).toBe(true),
    );
    expect(settingsUpsert().payload.discount_periods).toBe(24);
    expect(settingsUpsert().payload.coupon_valid_days).toBe(1);
  });

  it("BŁĄD zapisu ustawień trafia do komunikatu, a szkic zostaje na ekranie", async () => {
    chain.setResponse("retention_settings", ok(retentionSettings({ discount_pct: 25 })));
    renderWithQueryClient(<RetentionTab />);
    await settingsLoaded(25);
    chain.setResponse("retention_settings", {
      data: null,
      error: Object.assign(new Error("permission denied"), { name: "PostgrestError" }),
    });

    fireEvent.change(numberField(0), { target: { value: "40" } });
    fireEvent.click(screen.getByRole("button", { name: /retention\.save/ }));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith("permission denied"));
    expect(numberField(0)).toHaveValue(40);
  });

  it("bez tenanta (pusta baza) zapis odmawia zamiast wysłać wiersz bez właściciela", async () => {
    chain.setResponse("retention_settings", ok(null));
    renderWithQueryClient(<RetentionTab />);
    await settingsLoaded(30);

    fireEvent.click(screen.getByRole("button", { name: /retention\.save/ }));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith("adminPricing.toast.noTenant"));
  });
});

describe("RetentionTab - skuteczność kontroferty", () => {
  it("liczy odsetek przyjęć od POKAZANYCH ofert", async () => {
    chain.setResponse(
      "retention_feedback",
      ok([
        retentionFeedback({ id: "a", offer_shown: true, offer_accepted: true }),
        retentionFeedback({ id: "b", offer_shown: true, offer_accepted: false }),
        retentionFeedback({ id: "c", offer_shown: false, offer_accepted: false }),
      ]),
    );
    renderWithQueryClient(<RetentionTab />);

    await waitFor(() => expect(screen.getByText("(50%)")).toBeInTheDocument());
    // Przyjęta jedna z dwóch pokazanych - liczba przyjęć stoi obok odsetka.
    expect(screen.getByText("(50%)").parentElement).toHaveTextContent("1");
  });

  it("BRAK pokazanych ofert nie pokazuje „0%” - brak próby nie jest porażką", async () => {
    chain.setResponse(
      "retention_feedback",
      ok([retentionFeedback({ offer_shown: false, offer_accepted: false })]),
    );
    renderWithQueryClient(<RetentionTab />);

    await waitFor(() =>
      expect(screen.getByText("adminPricing.retention.stats.total")).toBeVisible(),
    );
    expect(screen.queryByText("(0%)")).not.toBeInTheDocument();
  });

  it("odpowiedzi starsze niż 90 dni nie wchodzą do statystyk", async () => {
    chain.setResponse(
      "retention_feedback",
      ok([retentionFeedback({ id: "stara", created_at: isoDaysAgo(200) })]),
    );
    renderWithQueryClient(<RetentionTab />);

    await waitFor(() =>
      expect(screen.getByText("adminPricing.retention.stats.total")).toBeVisible(),
    );
    expect(screen.getAllByText("0").length).toBeGreaterThan(0);
  });

  it("pokazuje najczęstsze powody odejścia z liczbami", async () => {
    chain.setResponse(
      "retention_feedback",
      ok([
        retentionFeedback({ id: "1", reason_label: "Za drogo" }),
        retentionFeedback({ id: "2", reason_label: "Za drogo" }),
        retentionFeedback({ id: "3", reason_label: "Brak czasu" }),
      ]),
    );
    renderWithQueryClient(<RetentionTab />);

    await waitFor(() => expect(screen.getAllByText("Za drogo").length).toBeGreaterThan(0));
    // Powód pojawia się i w rankingu, i na liście odpowiedzi - stąd `getAll`.
    const ranking = screen.getByText("adminPricing.retention.stats.topReasons").parentElement!;
    expect(ranking).toHaveTextContent("Za drogo");
    expect(ranking).toHaveTextContent("Brak czasu");
  });
});

describe("RetentionTab - katalog powodów rezygnacji", () => {
  it("nowy powód wymaga etykiety w OBU językach", async () => {
    renderWithQueryClient(<RetentionTab />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /retention\.addReason/ })).toBeDisabled(),
    );

    const [pl, en] = screen.getAllByRole("textbox");
    fireEvent.change(pl, { target: { value: "Za drogo" } });
    expect(screen.getByRole("button", { name: /retention\.addReason/ })).toBeDisabled();

    fireEvent.change(en, { target: { value: "Too expensive" } });
    expect(screen.getByRole("button", { name: /retention\.addReason/ })).toBeEnabled();
  });

  it("dodany powód idzie na koniec listy i czyści pola po UDANYM zapisie", async () => {
    chain.setResponse("retention_reasons", ok([retentionReason({ sort_order: 20 })]));
    renderWithQueryClient(<RetentionTab />);
    await waitFor(() => expect(screen.getByDisplayValue("Za drogo")).toBeInTheDocument());

    const [pl, en] = screen.getAllByRole("textbox");
    fireEvent.change(pl, { target: { value: "Nowy powód" } });
    fireEvent.change(en, { target: { value: "New reason" } });
    fireEvent.click(screen.getByRole("button", { name: /retention\.addReason/ }));

    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith("adminPricing.toast.reasonAdded"),
    );
    const inserted = chain
      .chainsFor("retention_reasons")
      .map((c) => c.argsOf("insert")?.[0] as { sort_order: number } | undefined)
      .find(Boolean);
    expect(inserted?.sort_order).toBe(30);
    await waitFor(() => expect(screen.getAllByRole("textbox")[0]).toHaveValue(""));
  });

  it("NIEUDANY zapis NIE czyści wpisanego tekstu", async () => {
    // Redakcja ma poprawić literówkę, nie pisać powód od nowa.
    chain.setResponse("retention_reasons", {
      data: null,
      error: Object.assign(new Error("permission denied"), { name: "PostgrestError" }),
    });
    chain.setResponse("retention_settings", ok(retentionSettings({ discount_pct: 25 })));
    renderWithQueryClient(<RetentionTab />);
    await settingsLoaded(25);

    const [pl, en] = screen.getAllByRole("textbox");
    fireEvent.change(pl, { target: { value: "Nowy powód" } });
    fireEvent.change(en, { target: { value: "New reason" } });
    fireEvent.click(screen.getByRole("button", { name: /retention\.addReason/ }));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith("permission denied"));
    expect(screen.getAllByRole("textbox")[0]).toHaveValue("Nowy powód");
  });

  it("zapis istniejącego powodu wymaga obu etykiet", async () => {
    chain.setResponse("retention_reasons", ok([retentionReason({ id: "r1" })]));
    renderWithQueryClient(<RetentionTab />);
    await waitFor(() => expect(screen.getByDisplayValue("Too expensive")).toBeInTheDocument());

    fireEvent.change(screen.getByDisplayValue("Too expensive"), { target: { value: "" } });

    // Zapis USTAWIEŃ i zapis WIERSZA mają ten sam klucz tłumaczenia, więc
    // szukamy w obrębie wiersza, a nie po nazwie w całym dokumencie.
    const row = screen.getByDisplayValue("Za drogo").closest("div.grid") as HTMLElement;
    expect(within(row).getByRole("button", { name: /retention\.save/ })).toBeDisabled();
    expect(screen.getByDisplayValue("Za drogo")).toBeInTheDocument();
  });

  it("usunięcie powodu pyta o potwierdzenie", async () => {
    confirmStub.mockReturnValue(false);
    chain.setResponse("retention_reasons", ok([retentionReason({ id: "r1" })]));
    renderWithQueryClient(<RetentionTab />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /retention\.reasonDelete/ })).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole("button", { name: /retention\.reasonDelete/ }));

    await waitFor(() => expect(confirmStub).toHaveBeenCalled());
    const deletes = chain.chainsFor("retention_reasons").filter((c) => c.has("delete"));
    expect(deletes).toHaveLength(0);
  });

  it("zapis powodu wysyła PRZYCIĘTE etykiety i stan aktywności", async () => {
    chain.setResponse("retention_reasons", ok([retentionReason({ id: "r1" })]));
    renderWithQueryClient(<RetentionTab />);
    await waitFor(() => expect(screen.getByDisplayValue("Za drogo")).toBeInTheDocument());

    const label = screen.getByDisplayValue("Za drogo");
    const row = label.closest("div.grid") as HTMLElement;
    fireEvent.change(label, { target: { value: "  Cena  " } });
    fireEvent.click(within(row).getByRole("button", { name: /retention\.save/ }));

    await waitFor(() =>
      expect(chain.chainsFor("retention_reasons").some((c) => c.has("update"))).toBe(true),
    );
    const patch = chain
      .chainsFor("retention_reasons")
      .find((c) => c.has("update"))!
      .argsOf("update")?.[0] as Record<string, unknown>;
    expect(patch).toMatchObject({ label_pl: "Cena", active: true });
  });

  it("WYŁĄCZONY powód przestaje się pokazywać klientowi, ale zostaje w katalogu", async () => {
    chain.setResponse("retention_reasons", ok([retentionReason({ id: "r1", active: true })]));
    renderWithQueryClient(<RetentionTab />);
    await waitFor(() => expect(screen.getByDisplayValue("Za drogo")).toBeInTheDocument());

    const row = screen.getByDisplayValue("Za drogo").closest("div.grid") as HTMLElement;
    fireEvent.click(within(row).getByRole("switch"));
    fireEvent.click(within(row).getByRole("button", { name: /retention\.save/ }));

    await waitFor(() =>
      expect(chain.chainsFor("retention_reasons").some((c) => c.has("update"))).toBe(true),
    );
    const patch = chain
      .chainsFor("retention_reasons")
      .find((c) => c.has("update"))!
      .argsOf("update")?.[0] as Record<string, unknown>;
    expect(patch.active).toBe(false);
    expect(screen.getByDisplayValue("Za drogo")).toBeInTheDocument();
  });

  it("usunięcie powodu po potwierdzeniu wysyła DELETE", async () => {
    chain.setResponse("retention_reasons", ok([retentionReason({ id: "r1" })]));
    renderWithQueryClient(<RetentionTab />);
    await waitFor(() => expect(screen.getByDisplayValue("Za drogo")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /retention\.reasonDelete/ }));

    await waitFor(() =>
      expect(chain.chainsFor("retention_reasons").some((c) => c.has("delete"))).toBe(true),
    );
    expect(toastSuccess).toHaveBeenCalledWith("adminPricing.toast.reasonDeleted");
  });

  it("przesunięcie powodu zapisuje nową kolejność", async () => {
    chain.setResponse(
      "retention_reasons",
      ok([
        retentionReason({ id: "r1", sort_order: 0 }),
        retentionReason({ id: "r2", sort_order: 10, label_pl: "Brak czasu" }),
      ]),
    );
    renderWithQueryClient(<RetentionTab />);
    await waitFor(() => expect(screen.getByDisplayValue("Brak czasu")).toBeInTheDocument());

    fireEvent.click(screen.getAllByRole("button", { name: /retention\.moveDown/ })[0]);

    await waitFor(() =>
      expect(chain.chainsFor("retention_reasons").some((c) => c.has("update"))).toBe(true),
    );
    expect(toastSuccess).toHaveBeenCalledWith("adminPricing.toast.reordered");
  });

  it("pierwszy powód nie może iść w górę", async () => {
    chain.setResponse(
      "retention_reasons",
      ok([retentionReason({ id: "r1" }), retentionReason({ id: "r2", label_pl: "Inne" })]),
    );
    renderWithQueryClient(<RetentionTab />);
    await waitFor(() =>
      expect(screen.getAllByRole("button", { name: /retention\.moveUp/ })).toHaveLength(2),
    );

    expect(screen.getAllByRole("button", { name: /retention\.moveUp/ })[0]).toBeDisabled();
    expect(screen.getAllByRole("button", { name: /retention\.moveDown/ })[0]).toBeEnabled();
  });
});

describe("RetentionTab - przegląd odpowiedzi", () => {
  it("PRZYJĘTA kontroferta pokazuje kod kuponu", async () => {
    chain.setResponse(
      "retention_feedback",
      ok([retentionFeedback({ offer_accepted: true, coupon_code: "ZOSTAN30" })]),
    );
    renderWithQueryClient(<RetentionTab />);

    await waitFor(() => expect(screen.getByText(/ZOSTAN30/)).toBeInTheDocument());
    expect(screen.getByText(/adminPricing\.retention\.offerAccepted/)).toBeInTheDocument();
  });

  it("ODRZUCONA kontroferta to inny stan niż „oferty nie było”", async () => {
    // Bez tego rozróżnienia nie da się odczytać, czy rabat nie działa, czy po
    // prostu nie doszedł do klienta.
    chain.setResponse(
      "retention_feedback",
      ok([
        retentionFeedback({ id: "odrzucona", offer_shown: true, offer_accepted: false }),
        retentionFeedback({ id: "bez-oferty", offer_shown: false, offer_accepted: false }),
      ]),
    );
    renderWithQueryClient(<RetentionTab />);

    await waitFor(() =>
      expect(screen.getByText("adminPricing.retention.offerDeclined")).toBeInTheDocument(),
    );
    expect(screen.getAllByText("-").length).toBeGreaterThan(0);
  });

  it("komentarz klienta pokazuje się pod powodem", async () => {
    chain.setResponse(
      "retention_feedback",
      ok([retentionFeedback({ comment: "Zbyt mało treści o Bałkanach" })]),
    );
    renderWithQueryClient(<RetentionTab />);

    await waitFor(() =>
      expect(screen.getByText("Zbyt mało treści o Bałkanach")).toBeInTheDocument(),
    );
  });

  it("brak odpowiedzi daje komunikat, nie pustą kartę", async () => {
    renderWithQueryClient(<RetentionTab />);

    await waitFor(() =>
      expect(screen.getByText("adminPricing.retention.feedbackEmpty")).toBeInTheDocument(),
    );
  });
});
