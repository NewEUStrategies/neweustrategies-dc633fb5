// Organizm: okno zakładania kampanii kuponowej - JEDYNE miejsce, z którego
// powstaje żądanie masowego wygenerowania kodów rabatowych.
//
// CO TEN PLIK DOWODZI.
//   1. CO DOKŁADNIE LECI DO `b2b_coupon_campaigns` - pole po polu, z wartościami
//      wpisanymi przez interfejs, a nie podanymi funkcji wprost. Asercja stoi
//      na ZAPISANYM argumencie insertu, nie na DOM-ie.
//   2. Pusta nazwa NIE WYCHODZI: zero łańcuchów do bazy, komunikat z klucza i18n.
//   3. Wartość spoza kontraktu bazy (procent 200) WYCHODZI - panel nie ma
//      takiej bramki, a operator dowiaduje się o odmowie surowym komunikatem
//      Postgresa. To jest stan faktyczny, nie postulat.
//   4. Powrót do „brak warstwy" po wpisaniu liczby dni NIE zostawia sieroty
//      w ładunku - w kampanii bramka istnieje (kontrast z listą kuponów).
//   5. ODMOWA BAZY nie zamyka okna i nie czyści pól - operator nie traci
//      wpisanej konfiguracji razem z informacją, co poprawić.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. Kształtu ładunku liczonego z gotowego stanu
// (`couponCampaignForm.test.ts`) ani zachowania pól (`campaignFormFields`).
// Tutaj chodzi o DROGĘ: interfejs -> stan -> reguła -> baza -> odpowiedź.
//
// CZEGO NIE MOCKUJĘ: reguł, które mam udowodnić (`validateCampaignForm`
// i `buildCampaignInsert` są prawdziwe). Atrapami są wyłącznie Radix (Dialog,
// Select), kalendarz i klient bazy.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import type { RecordedChain, SupabaseFromStub, SupabaseResult } from "@/test/supabase";

const h = vi.hoisted(() => ({
  db: null as SupabaseFromStub | null,
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("sonner", () => ({
  toast: { success: h.toastSuccess, error: h.toastError },
  Toaster: () => null,
}));
vi.mock("@/integrations/supabase/client", async () => {
  const { supabaseFromStub } = await import("@/test/supabase");
  const db = supabaseFromStub();
  h.db = db;
  return { supabase: { from: (table: string) => db.from(table) } };
});
// Radix Dialog: organizm renderuje samą `DialogContent` (rodzic `Dialog` stoi
// w trasie), więc atrapa musi ją zawsze rozwinąć - inaczej nie ma czego kliknąć.
vi.mock("@/components/ui/dialog", () => ({
  DialogContent: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  DialogFooter: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children?: ReactNode }) => <h2>{children}</h2>,
}));
// Radix Select -> natywny `<select>`: pod happy-dom nie ma pełnego API
// wskaźnika, więc lista rozwijana nigdy nie oddałaby pozycji do DOM.
vi.mock("@/components/ui/select", () => ({
  Select: ({
    value,
    onValueChange,
    children,
  }: {
    value?: string;
    onValueChange?: (v: string) => void;
    children?: ReactNode;
  }) => (
    <select
      aria-label={value === "percent" || value === "fixed" ? "rodzaj-rabatu" : "warstwa"}
      value={value}
      onChange={(event) => onValueChange?.(event.target.value)}
    >
      {children}
    </select>
  ),
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }: { children?: ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string; children?: ReactNode }) => (
    <option value={value}>{children}</option>
  ),
}));
// Kalendarz -> natywne pole tekstowe: tylko tak da się wstrzyknąć konkretną
// datę i wyczyszczenie pola (prawdziwy `DatePickerField` ma własny popover).
vi.mock("@/components/admin/coupons/DatePickerField", () => ({
  DatePickerField: ({
    value,
    onChange,
    label,
  }: {
    value: Date | undefined;
    onChange: (value: Date | undefined) => void;
    label: string;
  }) => (
    <label>
      {label}
      <input
        aria-label={label}
        value={value ? value.toISOString() : ""}
        onChange={(e) => onChange(e.target.value ? new Date(e.target.value) : undefined)}
      />
    </label>
  ),
}));

import { CampaignCreateDialog } from "@/components/admin/coupons/organisms/CampaignCreateDialog";

const TABELA = "b2b_coupon_campaigns";

const TIERS = [
  { key: "gold", name_pl: "Złoty", name_en: "Gold" },
  { key: "silver", name_pl: "Srebrny", name_en: "Silver" },
];

function db(): SupabaseFromStub {
  if (!h.db) throw new Error("test: atrapa klienta Supabase nie została zainicjowana");
  return h.db;
}

let odpowiedz: SupabaseResult;

beforeEach(() => {
  db().reset();
  h.toastSuccess.mockReset();
  h.toastError.mockReset();
  odpowiedz = { data: null, error: null };
  db().setResponse(TABELA, () => odpowiedz);
});

afterEach(cleanup);

function renderDialog() {
  const onCreated = vi.fn();
  render(<CampaignCreateDialog tiers={TIERS} onCreated={onCreated} />);
  return { onCreated };
}

/** Ładunek ostatniego insertu - to on jest przedmiotem większości asercji. */
function ladunek(): Record<string, unknown> {
  const chain: RecordedChain | undefined = db().lastChain(TABELA);
  if (!chain) throw new Error("test: nie było żadnego zapytania do kampanii");
  const args = chain.argsOf("insert");
  if (!args) throw new Error("test: łańcuch nie zawiera ogniwa insert");
  return args[0] as Record<string, unknown>;
}

function wpisz(etykieta: string, wartosc: string) {
  fireEvent.change(screen.getByLabelText(etykieta), { target: { value: wartosc } });
}

function zapisz() {
  fireEvent.click(screen.getByRole("button", { name: "adminCoupons.createCampaign" }));
}

describe("bramka zapisu", () => {
  it("pusta nazwa NIE wysyła ani jednego zapytania - komunikat idzie z klucza i18n", async () => {
    renderDialog();
    zapisz();
    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("adminCoupons.enterName"));
    expect(db().chainsFor(TABELA)).toHaveLength(0);
  });

  it("nazwa z samych spacji jest traktowana jak pusta", async () => {
    renderDialog();
    wpisz("adminCoupons.name", "    ");
    zapisz();
    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("adminCoupons.enterName"));
    expect(db().chainsFor(TABELA)).toHaveLength(0);
  });

  it("PROCENT 200 wychodzi do bazy - panel nie ma bramki zakresu, ma ją dopiero CHECK", async () => {
    renderDialog();
    wpisz("adminCoupons.name", "Kampania");
    wpisz("adminCoupons.percent", "200");
    zapisz();
    await waitFor(() => expect(db().chainsFor(TABELA)).toHaveLength(1));
    expect(ladunek().discount_percent).toBe(200);
    expect(h.toastError).not.toHaveBeenCalled();
  });

  it("wartość nieliczbowa w polu procentu wchodzi do ładunku jako NaN", async () => {
    // UWAGA: happy-dom sanityzuje `<input type="number">` łagodniej niż
    // przeglądarka (`parseFloat("12abc")` przechodzi), więc ten dowód jest
    // wierny KODOWI, nie Chrome. Kanoniczny dowód na wejściu liczbowym stoi
    // w `couponCampaignForm.test.ts`.
    renderDialog();
    wpisz("adminCoupons.name", "Kampania");
    wpisz("adminCoupons.percent", "12abc");
    zapisz();
    await waitFor(() => expect(db().chainsFor(TABELA)).toHaveLength(1));
    expect(Number.isNaN(ladunek().discount_percent as number)).toBe(true);
  });
});

describe("ładunek insertu z interfejsu", () => {
  it("wartości domyślne formularza dają kampanię procentową na 100 kodów", async () => {
    renderDialog();
    wpisz("adminCoupons.name", "  Q1 2026 VIP  ");
    zapisz();
    await waitFor(() => expect(db().chainsFor(TABELA)).toHaveLength(1));
    expect(ladunek()).toEqual({
      name: "Q1 2026 VIP",
      description: null,
      prefix: "",
      code_length: 8,
      code_count: 100,
      discount_kind: "percent",
      discount_percent: 20,
      discount_cents: null,
      currency: null,
      valid_until: null,
      grants_tier_key: null,
      grants_duration_days: null,
      newsletter_segment: null,
    });
  });

  it("przełączenie na rabat kwotowy zamienia pole procentu na kwotę z walutą", async () => {
    renderDialog();
    wpisz("adminCoupons.name", "Kampania");
    fireEvent.change(screen.getByLabelText("rodzaj-rabatu"), { target: { value: "fixed" } });
    wpisz("adminCoupons.amountCents2", "4990");
    wpisz("adminCoupons.currency", "eur");
    zapisz();
    await waitFor(() => expect(db().chainsFor(TABELA)).toHaveLength(1));
    expect(ladunek()).toMatchObject({
      discount_kind: "fixed",
      discount_percent: null,
      discount_cents: 4990,
      currency: "EUR",
    });
  });

  it("data ważności z kalendarza wychodzi jako ISO, a jej brak jako NULL", async () => {
    renderDialog();
    wpisz("adminCoupons.name", "Kampania");
    wpisz("adminCoupons.validUntil2", "2026-03-31T00:00:00.000Z");
    zapisz();
    await waitFor(() => expect(db().chainsFor(TABELA)).toHaveLength(1));
    expect(ladunek().valid_until).toBe("2026-03-31T00:00:00.000Z");
  });

  it("wybór warstwy wysyła jej KLUCZ, a lista pokazuje NAZWĘ w języku interfejsu", async () => {
    renderDialog();
    expect(screen.getByRole("option", { name: "Złoty" })).toBeInTheDocument();
    wpisz("adminCoupons.name", "Kampania");
    fireEvent.change(screen.getByLabelText("warstwa"), { target: { value: "gold" } });
    zapisz();
    await waitFor(() => expect(db().chainsFor(TABELA)).toHaveLength(1));
    expect(ladunek()).toMatchObject({ grants_tier_key: "gold", grants_duration_days: 30 });
  });

  it("POWRÓT do 'brak warstwy' po wpisaniu dni NIE zostawia sieroty w ładunku", async () => {
    renderDialog();
    wpisz("adminCoupons.name", "Kampania");
    fireEvent.change(screen.getByLabelText("warstwa"), { target: { value: "gold" } });
    wpisz("adminCoupons.durationDays", "90");
    fireEvent.change(screen.getByLabelText("warstwa"), { target: { value: "none" } });
    zapisz();
    await waitFor(() => expect(db().chainsFor(TABELA)).toHaveLength(1));
    expect(ladunek()).toMatchObject({ grants_tier_key: null, grants_duration_days: null });
  });

  it("warstwa BEZ liczby dni daje subskrypcję bezterminową, nie odmowę", async () => {
    renderDialog();
    wpisz("adminCoupons.name", "Kampania");
    fireEvent.change(screen.getByLabelText("warstwa"), { target: { value: "silver" } });
    wpisz("adminCoupons.durationDays", "");
    zapisz();
    await waitFor(() => expect(db().chainsFor(TABELA)).toHaveLength(1));
    expect(ladunek()).toMatchObject({ grants_tier_key: "silver", grants_duration_days: null });
  });

  it("segment newslettera i opis idą jako NULL, gdy zostały puste", async () => {
    renderDialog();
    wpisz("adminCoupons.name", "Kampania");
    wpisz("adminCoupons.newsletterSegmentTag", "  ");
    zapisz();
    await waitFor(() => expect(db().chainsFor(TABELA)).toHaveLength(1));
    expect(ladunek()).toMatchObject({ newsletter_segment: null, description: null });
  });

  it("insert idzie PROSTO do tabeli - żadnego RPC pośredniczącego", async () => {
    renderDialog();
    wpisz("adminCoupons.name", "Kampania");
    zapisz();
    await waitFor(() => expect(db().chainsFor(TABELA)).toHaveLength(1));
    expect(db().lastChain(TABELA)?.has("insert")).toBe(true);
    expect(db().chains.map((c) => c.table)).toEqual([TABELA]);
  });
});

describe("odpowiedź bazy", () => {
  it("SUKCES melduje kluczem i18n i zamyka okno przez zdarzenie wołającego", async () => {
    const { onCreated } = renderDialog();
    wpisz("adminCoupons.name", "Kampania");
    zapisz();
    await waitFor(() =>
      expect(h.toastSuccess).toHaveBeenCalledWith("adminCoupons.campaignCreatedDraft"),
    );
    expect(onCreated).toHaveBeenCalledTimes(1);
  });

  it("ODMOWA pokazuje SUROWY komunikat Postgresa, nie klucz i18n", async () => {
    const { onCreated } = renderDialog();
    odpowiedz = {
      data: null,
      error: Object.assign(new Error('new row violates check constraint "code_count_range"'), {
        name: "PostgrestError",
      }),
    };
    wpisz("adminCoupons.name", "Kampania");
    zapisz();
    await waitFor(() =>
      expect(h.toastError).toHaveBeenCalledWith(
        'new row violates check constraint "code_count_range"',
      ),
    );
    expect(onCreated).not.toHaveBeenCalled();
    expect(h.toastSuccess).not.toHaveBeenCalled();
  });

  it("po odmowie okno ZOSTAJE z wpisaną treścią, a przycisk znów jest aktywny", async () => {
    renderDialog();
    odpowiedz = {
      data: null,
      error: Object.assign(new Error("permission denied"), { name: "PostgrestError" }),
    };
    wpisz("adminCoupons.name", "Kampania kwartalna");
    zapisz();
    await waitFor(() => expect(h.toastError).toHaveBeenCalled());
    expect(screen.getByLabelText("adminCoupons.name")).toHaveValue("Kampania kwartalna");
    expect(screen.getByRole("button", { name: "adminCoupons.createCampaign" })).not.toBeDisabled();
  });

  it("po odmowie POWTÓRNY zapis jest możliwy i wysyła drugie zapytanie", async () => {
    renderDialog();
    odpowiedz = {
      data: null,
      error: Object.assign(new Error("permission denied"), { name: "PostgrestError" }),
    };
    wpisz("adminCoupons.name", "Kampania");
    zapisz();
    await waitFor(() => expect(db().chainsFor(TABELA)).toHaveLength(1));
    odpowiedz = { data: null, error: null };
    zapisz();
    await waitFor(() => expect(db().chainsFor(TABELA)).toHaveLength(2));
    expect(h.toastSuccess).toHaveBeenCalledWith("adminCoupons.campaignCreatedDraft");
  });
});
