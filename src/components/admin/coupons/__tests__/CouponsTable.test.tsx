// Organizm: tabela kuponów B2B - siedem kolumn, dwie akcje i trzy stany widoku.
//
// CO TEN PLIK DOWODZI.
//   1. STAN WCZYTYWANIA, STAN PUSTY I LISTA WYKLUCZAJĄ SIĘ WZAJEMNIE. Tabela,
//      która pokazuje „Brak wyników” nad wierszami (albo odwrotnie), każe
//      operatorowi zgadywać, czy dane są kompletne.
//   2. TABELA NIE FILTRUJE I NIE LICZY - dostaje wiersze już przefiltrowane.
//      Gdyby filtrowała sama, definicja „wygasłego” istniałaby w dwóch
//      miejscach i rozjechałaby się przy pierwszej poprawce.
//   3. AKCJE ODDAJĄ CAŁY WIERSZ, NIE IDENTYFIKATOR: mutacja przełączenia
//      potrzebuje bieżącej wartości `active` z tego samego wiersza, na którym
//      kliknięto - inaczej wysyła zaprzeczenie stanu, którego nikt nie widział.
//   4. KOMÓRKI SKŁADAJĄ SIĘ Z ATOMÓW, więc wartości brzegowe (brak kwoty, brak
//      limitu, uszkodzona data) trafiają na ekran tak samo jak w ich testach -
//      tu sprawdzamy WYŁĄCZNIE, że tabela podaje im właściwe pola wiersza.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. (1) Formatowania komórek - `couponAtoms.test.tsx`.
// (2) Reguł filtra i kafli - `lib/billing/__tests__/couponAdminList.test.ts`.
// (3) Zapytań, mutacji i potwierdzenia usunięcia - `adminCouponsIndexRoute.test.tsx`
// (tam mieszka sklejenie z Supabase; tabela nie zna ani klienta, ani react-query).
//
// Radix `Switch` jest podmieniony na natywne pole wyboru - pod happy-dom nie
// ma pełnego API wskaźnika.
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
// Prawdziwa nakładka robi `addResourceBundle` przy imporcie i wciąga CAŁY
// i18next aplikacji - atrapa zostawia sam kontrakt „loader jest wołany".
vi.mock("@/lib/i18n-admin-coupons", () => ({ ensureI18n: () => undefined }));

vi.mock("@/components/ui/switch", () => ({
  Switch: ({
    checked,
    onCheckedChange,
    "aria-label": ariaLabel,
  }: {
    checked: boolean;
    onCheckedChange: (v: boolean) => void;
    "aria-label"?: string;
  }) => (
    <input
      type="checkbox"
      aria-label={ariaLabel}
      checked={checked}
      onChange={() => onCheckedChange(!checked)}
    />
  ),
}));

import { CouponsTable, type CouponAdminRow } from "../organisms/CouponsTable";

function kupon(overrides: Partial<CouponAdminRow> = {}): CouponAdminRow {
  return {
    id: "c-1",
    code: "NES-B2B-10",
    name: null,
    description: null,
    discount_kind: "percent",
    discount_percent: 10,
    discount_cents: null,
    currency: null,
    active: true,
    max_redemptions: null,
    redemptions_count: 0,
    valid_from: null,
    valid_until: null,
    plan_ids: [],
    organization_id: null,
    metadata: {},
    created_at: "2026-08-01T10:00:00.000Z",
    updated_at: "2026-08-01T10:00:00.000Z",
    campaign_id: null,
    grants_tier_key: null,
    grants_duration_days: null,
    assigned_company_id: null,
    assigned_lead_id: null,
    ...overrides,
  };
}

function renderTabele(overrides: Partial<Parameters<typeof CouponsTable>[0]> = {}) {
  const props = {
    rows: [kupon()],
    loading: false,
    lang: "pl",
    onCopy: vi.fn(),
    onToggle: vi.fn(),
    onDelete: vi.fn(),
    ...overrides,
  };
  return { ...render(<CouponsTable {...props} />), props };
}

describe("trzy stany widoku wykluczają się wzajemnie", () => {
  it("w trakcie wczytywania NIE MA ani tabeli, ani komunikatu o braku wyników", () => {
    renderTabele({ loading: true, rows: [] });
    expect(screen.getByText("adminCoupons.loading")).toBeInTheDocument();
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.queryByText("adminCoupons.results")).toBeNull();
  });

  it("pusty zbiór pokazuje jeden komunikat i ani jednego wiersza", () => {
    renderTabele({ rows: [] });
    expect(screen.getByText("adminCoupons.results")).toBeInTheDocument();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("lista z wierszami nie pokazuje już ani wskaźnika, ani komunikatu pustki", () => {
    renderTabele();
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.queryByText("adminCoupons.loading")).toBeNull();
    expect(screen.queryByText("adminCoupons.results")).toBeNull();
  });
});

describe("kolumny tabeli", () => {
  it("nagłówki są dokładnie te siedem, w tej kolejności", () => {
    renderTabele();
    const naglowki = screen.getAllByRole("columnheader").map((th) => th.textContent);
    expect(naglowki).toEqual([
      "adminCoupons.code",
      "adminCoupons.discount",
      "adminCoupons.uses",
      "adminCoupons.validity",
      "adminCoupons.planSubscription",
      "adminCoupons.status",
      "adminCoupons.actions",
    ]);
  });

  it("NIE MA kolumny firmy ani leada - przypisania CRM są w bazie, ale nie w panelu", () => {
    // `assigned_company_id` i `assigned_lead_id` są pobierane przez zapytanie
    // listy i deklarowane w typie wiersza, a mimo to nigdzie nie widać ich
    // wartości. Ten test jest dowodem, że „powiązania CRM” nie istnieją.
    renderTabele({ rows: [kupon({ assigned_company_id: "firma-1", assigned_lead_id: "lead-1" })] });
    expect(screen.queryByText(/firma-1|lead-1/)).toBeNull();
  });

  it("wiersz składa komórki z pól TEGO wiersza, nie z pierwszego lepszego", () => {
    renderTabele({
      rows: [
        kupon({
          id: "c-2",
          discount_kind: "fixed",
          discount_percent: null,
          discount_cents: 2500,
          currency: "PLN",
          redemptions_count: 3,
          max_redemptions: 10,
          grants_tier_key: "gold",
          grants_duration_days: 30,
        }),
      ],
    });
    const wiersz = screen.getAllByRole("row")[1];
    expect(within(wiersz).getByText("25.00 PLN")).toBeInTheDocument();
    expect(within(wiersz).getByText("3 / 10")).toBeInTheDocument();
    expect(within(wiersz).getByText("gold")).toBeInTheDocument();
    expect(within(wiersz).getByText("30d")).toBeInTheDocument();
  });

  it("każdy kupon dostaje własny wiersz - dwa kupony to dwa wiersze danych", () => {
    renderTabele({ rows: [kupon({ id: "c-1" }), kupon({ id: "c-2", code: "NES-VIP" })] });
    expect(screen.getAllByRole("row")).toHaveLength(3);
  });
});

describe("akcje wiersza", () => {
  it("kopiowanie oddaje KOD kuponu, nie jego identyfikator", () => {
    const { props } = renderTabele({ rows: [kupon({ id: "c-9", code: "NES-VIP" })] });
    fireEvent.click(screen.getByLabelText("Kopiuj"));
    expect(props.onCopy).toHaveBeenCalledWith("NES-VIP");
  });

  it("przełączenie oddaje CAŁY WIERSZ - mutacja potrzebuje jego bieżącej aktywności", () => {
    const wiersz = kupon({ id: "c-9", active: false });
    const { props } = renderTabele({ rows: [wiersz] });
    fireEvent.click(screen.getByLabelText("toggle-active"));
    expect(props.onToggle).toHaveBeenCalledWith(wiersz);
  });

  it("usunięcie oddaje wiersz, bo potwierdzenie musi wymienić KOD w treści pytania", () => {
    const wiersz = kupon({ id: "c-9", code: "NES-VIP" });
    const { props } = renderTabele({ rows: [wiersz] });
    fireEvent.click(screen.getByLabelText("delete"));
    expect(props.onDelete).toHaveBeenCalledWith(wiersz);
  });

  it("przełącznik pokazuje stan z danych, a nie stan kliknięcia", () => {
    renderTabele({ rows: [kupon({ active: false })] });
    const przelacznik = screen.getByLabelText("toggle-active") as HTMLInputElement;
    expect(przelacznik.checked).toBe(false);
    fireEvent.click(przelacznik);
    // Bez odświeżenia danych wiersz zostaje taki, jaki był - to jest właśnie
    // brak stanu optymistycznego (i dlatego odmowa zapisu niczego nie cofa).
    expect((screen.getByLabelText("toggle-active") as HTMLInputElement).checked).toBe(false);
  });
});

describe("etykiety dostępności są zaszyte w kodzie", () => {
  it("trzy nazwy dla czytnika ekranu NIE przechodzą przez słownik", () => {
    // „Kopiuj” jest po polsku także w interfejsie angielskim, a „toggle-active”
    // i „delete” to nazwy techniczne. To dług zapisany, nie naprawiany tutaj.
    renderTabele();
    expect(screen.getByLabelText("Kopiuj")).toBeInTheDocument();
    expect(screen.getByLabelText("toggle-active")).toBeInTheDocument();
    expect(screen.getByLabelText("delete")).toBeInTheDocument();
  });
});
