// Organizm „Nowy kupon B2B” - SKLEJENIE formularza z regułami i zapisem.
// TU LEŻĄ PIENIĄDZE: to jedyne miejsce w panelu, które tworzy rabat.
//
// CO TEN PLIK DOWODZI.
//   1. ODMOWA WALIDACJI NIE DOTYKA BAZY. Procent poza zakresem, kwota
//      niedodatnia i pusty kod kończą się KLUCZEM i18n w komunikacie i ZEREM
//      łańcuchów zapisu. Baza ma te same CHECK-i, ale odpowiada po angielsku
//      i bez wskazania pola - dlatego cała wartość tej bramki to komunikat.
//   2. ZAPIS IDZIE PROSTO DO TABELI `b2b_coupons` - żadnego RPC, żadnej funkcji
//      serwerowej. Jedynym strażnikiem po drodze są RLS i CHECK-i.
//   3. ŁADUNEK JEST ASERTOWANY NA OBIEKCIE, NIE NA DOM-IE: kod znormalizowany,
//      dokładnie jedno pole rabatu niepuste, waluta tylko przy kwocie.
//   4. ODMOWA BAZY ZOSTAWIA DIALOG OTWARTY Z WPISANĄ TREŚCIĄ, pokazuje SUROWY
//      komunikat Postgresa i oddaje przycisk do ponownego użycia. Utrata
//      wpisanej treści przy kolizji kodu byłaby najgorszym możliwym skutkiem.
//   5. SUKCES melduje się kluczem i oddaje sterowanie wołającemu (`onCreated`),
//      który zamyka dialog i unieważnia listę.
//   6. DEFEKTY, KTÓRE PRZEŻYŁY EKSTRAKCJĘ: wartość nieliczbowa w polu procentu
//      przechodzi walidację, a liczba dni subskrypcji wychodzi do bazy bez
//      warstwy. Obie zgłoszone parą `it.fails` + sąsiedni `it`.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. (1) Tabel reguł (granice zakresu, konwersje,
// `NaN`, daty) - `lib/billing/__tests__/couponAdminForm.test.ts`; tutaj
// dowodzimy, że organizm ich UŻYWA i co robi z werdyktem. (2) Molekuł formularza
// - `couponFormMolecules.test.tsx`. (3) Autoryzacji dostępu do `/admin` -
// `routes/__tests__/adminRouteAuthority.gate.test.ts` i RLS.
//
// Radix (Dialog, Select, Checkbox) jest podmieniony na natywne odpowiedniki -
// pod happy-dom nie ma pełnego API wskaźnika. `DatePickerField` jest atrapą,
// bo tylko tak da się wstrzyknąć konkretną `Date` bez klikania w kalendarz.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { SupabaseFromStub, SupabaseResult } from "@/test/supabase";

const h = vi.hoisted(() => ({
  db: undefined as unknown,
  rpcCalls: [] as string[],
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
// Prawdziwa nakładka robi `addResourceBundle` przy imporcie i wciąga CAŁY
// i18next aplikacji - atrapa zostawia sam kontrakt „loader jest wołany".
vi.mock("@/lib/i18n-admin-coupons", () => ({ ensureI18n: () => undefined }));
vi.mock("sonner", () => ({
  toast: { success: h.toastSuccess, error: h.toastError },
  Toaster: () => null,
}));

vi.mock("@/integrations/supabase/client", async () => {
  const { supabaseFromStub } = await import("@/test/supabase");
  const db = supabaseFromStub();
  h.db = db;
  return {
    supabase: {
      from: (table: string) => db.from(table),
      rpc: (name: string) => {
        h.rpcCalls.push(name);
        return Promise.resolve({ data: null, error: null });
      },
    },
  };
});

vi.mock("@/components/ui/dialog", () => ({
  DialogContent: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  DialogFooter: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children?: ReactNode }) => <h2>{children}</h2>,
}));

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
    <select value={value} onChange={(event) => onValueChange?.(event.target.value)}>
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

vi.mock("@/components/ui/checkbox", () => ({
  Checkbox: ({
    checked,
    onCheckedChange,
  }: {
    checked: boolean;
    onCheckedChange: (v: boolean) => void;
  }) => (
    <input
      type="checkbox"
      checked={checked}
      onChange={(event) => onCheckedChange(event.target.checked)}
    />
  ),
}));

// Pole daty oddaje `Date` z wpisanego ISO - inaczej nie da się w teście
// rozróżnić „brak daty” od konkretnej chwili bez klikania w kalendarz.
vi.mock("@/components/admin/coupons/DatePickerField", () => ({
  DatePickerField: ({
    value,
    onChange,
    label,
  }: {
    value: Date | undefined;
    onChange: (d: Date | undefined) => void;
    label?: string;
  }) => (
    <input
      aria-label={label}
      value={value ? value.toISOString() : ""}
      onChange={(event) => onChange(event.target.value ? new Date(event.target.value) : undefined)}
    />
  ),
}));

import { CouponCreateDialog } from "../organisms/CouponCreateDialog";
import { fail, ok } from "@/test/supabase";

const TABELA = "b2b_coupons";

/** STRAŻNIK zamiast rzutowania stanu z `vi.hoisted`. */
function db(): SupabaseFromStub {
  const value = h.db;
  if (!value) throw new Error("test: atrapa klienta Supabase nie została zainicjowana");
  return value as SupabaseFromStub;
}

const PLANY = [{ id: "p-1", name_pl: "Roczny", name_en: "Annual", active: true }];
const WARSTWY = [{ key: "gold", name_pl: "Złoty", name_en: "Gold", active: true }];

function renderDialog(odpowiedz: SupabaseResult = ok(null)) {
  const onCreated = vi.fn();
  db().setResponse(TABELA, odpowiedz);
  render(<CouponCreateDialog plans={PLANY} tiers={WARSTWY} onCreated={onCreated} />);
  return { onCreated };
}

/** Pola formularza po etykietach ze słownika (stub echuje klucz). */
function pole(klucz: string): HTMLElement {
  const etykieta = screen.getByText(klucz);
  const kontener = etykieta.parentElement;
  const input = kontener?.querySelector("input, textarea");
  if (!input) throw new Error(`test: nie ma pola dla etykiety ${klucz}`);
  return input as HTMLElement;
}

function zapisz(): void {
  fireEvent.click(screen.getByRole("button", { name: "adminCoupons.createCoupon" }));
}

/** Ładunek ostatniego `insert` na tabeli kuponów. */
function ostatniLadunek(): Record<string, unknown> {
  const chain = db().lastChain(TABELA);
  if (!chain?.has("insert")) throw new Error("test: nie było zapisu na b2b_coupons");
  return chain.argsOf("insert")?.[0] as Record<string, unknown>;
}

function liczbaZapisow(): number {
  return db()
    .chainsFor(TABELA)
    .filter((c) => c.has("insert")).length;
}

beforeEach(() => {
  db().reset();
  h.rpcCalls = [];
  h.toastSuccess.mockClear();
  h.toastError.mockClear();
});

describe("odmowa walidacji nie dotyka bazy", () => {
  it("pusty kod kończy się kluczem adminCoupons.enterCode i ZEREM zapisów", () => {
    renderDialog();
    fireEvent.change(pole("adminCoupons.code"), { target: { value: "   " } });
    zapisz();
    expect(h.toastError).toHaveBeenCalledWith("adminCoupons.enterCode");
    expect(liczbaZapisow()).toBe(0);
  });

  it.each([
    ["zero", "0"],
    ["ponad sto", "101"],
  ])("procent %s kończy się kluczem adminCoupons.percent1100 i ZEREM zapisów", (_opis, wartosc) => {
    renderDialog();
    fireEvent.change(pole("adminCoupons.code"), { target: { value: "NES-1" } });
    fireEvent.change(pole("adminCoupons.percent"), { target: { value: wartosc } });
    zapisz();
    expect(h.toastError).toHaveBeenCalledWith("adminCoupons.percent1100");
    expect(liczbaZapisow()).toBe(0);
  });

  it("kwota zerowa kończy się kluczem adminCoupons.amount0 i ZEREM zapisów", () => {
    renderDialog();
    fireEvent.change(pole("adminCoupons.code"), { target: { value: "NES-1" } });
    fireEvent.change(screen.getAllByRole("combobox")[0], { target: { value: "fixed" } });
    fireEvent.change(pole("adminCoupons.amountCents"), { target: { value: "0" } });
    zapisz();
    expect(h.toastError).toHaveBeenCalledWith("adminCoupons.amount0");
    expect(liczbaZapisow()).toBe(0);
  });
});

describe("ładunek zapisu", () => {
  it("kupon procentowy zapisuje się PROSTO do tabeli b2b_coupons, bez RPC", async () => {
    renderDialog();
    fireEvent.change(pole("adminCoupons.code"), { target: { value: "  nes-b2b-10 " } });
    zapisz();
    await waitFor(() => expect(liczbaZapisow()).toBe(1));
    expect(h.rpcCalls).toEqual([]);
    expect(ostatniLadunek()).toMatchObject({
      code: "NES-B2B-10",
      discount_kind: "percent",
      discount_percent: 10,
      discount_cents: null,
      currency: null,
    });
  });

  it("kupon kwotowy niesie kwotę i walutę wielkimi literami, a procentu nie niesie", async () => {
    renderDialog();
    fireEvent.change(pole("adminCoupons.code"), { target: { value: "NES-FIX" } });
    fireEvent.change(screen.getAllByRole("combobox")[0], { target: { value: "fixed" } });
    fireEvent.change(pole("adminCoupons.amountCents"), { target: { value: "2500" } });
    fireEvent.change(pole("adminCoupons.currency"), { target: { value: "eur" } });
    zapisz();
    await waitFor(() => expect(liczbaZapisow()).toBe(1));
    expect(ostatniLadunek()).toMatchObject({
      discount_kind: "fixed",
      discount_cents: 2500,
      currency: "EUR",
      discount_percent: null,
    });
  });

  it("przełączenie rodzaju PO wpisaniu kwoty nie zostawia sieroty w discount_cents", async () => {
    renderDialog();
    fireEvent.change(pole("adminCoupons.code"), { target: { value: "NES-1" } });
    fireEvent.change(screen.getAllByRole("combobox")[0], { target: { value: "fixed" } });
    fireEvent.change(pole("adminCoupons.amountCents"), { target: { value: "5000" } });
    fireEvent.change(screen.getAllByRole("combobox")[0], { target: { value: "percent" } });
    zapisz();
    await waitFor(() => expect(liczbaZapisow()).toBe(1));
    expect(ostatniLadunek()).toMatchObject({ discount_cents: null, discount_percent: 10 });
  });

  it("wybrana data ważności jedzie jako ISO, a niewypełniona jako null", async () => {
    renderDialog();
    fireEvent.change(pole("adminCoupons.code"), { target: { value: "NES-1" } });
    fireEvent.change(screen.getByLabelText("adminCoupons.validUntil"), {
      target: { value: "2026-12-31T00:00:00.000Z" },
    });
    zapisz();
    await waitFor(() => expect(liczbaZapisow()).toBe(1));
    expect(ostatniLadunek()).toMatchObject({
      valid_from: null,
      valid_until: "2026-12-31T00:00:00.000Z",
    });
  });

  it("zaznaczony plan trafia do plan_ids; ponowne kliknięcie go STAMTĄD USUWA", async () => {
    // Hipoteza o zdublowanym identyfikatorze jest OBALONA przez sterowane pole
    // wyboru: drugie kliknięcie zgłasza `false`, a nie drugi raz `true`.
    renderDialog();
    fireEvent.change(pole("adminCoupons.code"), { target: { value: "NES-1" } });
    const plan = screen.getByRole("checkbox");
    fireEvent.click(plan);
    fireEvent.click(plan);
    zapisz();
    await waitFor(() => expect(liczbaZapisow()).toBe(1));
    expect(ostatniLadunek().plan_ids).toEqual([]);
  });

  it("nazwa i opis wewnętrzny jadą do ładunku, a puste pola jako NULL", async () => {
    renderDialog();
    fireEvent.change(pole("adminCoupons.code"), { target: { value: "NES-1" } });
    fireEvent.change(pole("adminCoupons.nameOptional"), { target: { value: "Kampania VIP" } });
    fireEvent.change(pole("adminCoupons.internalDescription"), {
      target: { value: "   " },
    });
    zapisz();
    await waitFor(() => expect(liczbaZapisow()).toBe(1));
    expect(ostatniLadunek()).toMatchObject({ name: "Kampania VIP", description: null });
  });

  it("limit użyć wpisany w polu jedzie jako liczba, a puste pole jako brak limitu", async () => {
    renderDialog();
    fireEvent.change(pole("adminCoupons.code"), { target: { value: "NES-1" } });
    fireEvent.change(pole("adminCoupons.maxRedemptions"), { target: { value: "25" } });
    zapisz();
    await waitFor(() => expect(liczbaZapisow()).toBe(1));
    expect(ostatniLadunek().max_redemptions).toBe(25);
  });
});

describe("DEFEKT: wartość nieliczbowa w polu procentu", () => {
  it.fails("procent „12abc” powinien zostać odrzucony przed zapisem", async () => {
    renderDialog();
    fireEvent.change(pole("adminCoupons.code"), { target: { value: "NES-1" } });
    fireEvent.change(pole("adminCoupons.percent"), { target: { value: "12abc" } });
    zapisz();
    await waitFor(() => expect(h.toastError).toHaveBeenCalled());
    expect(liczbaZapisow()).toBe(0);
  });

  it("STAN FAKTYCZNY: zapis LECI, a kolumna rabatu niesie NaN", async () => {
    // Para do usunięcia RAZEM po naprawie. UWAGA NA ŚRODOWISKO: happy-dom
    // sanityzuje `input[type=number]` łagodniej niż przeglądarka, więc dowód
    // przez DOM jest wierny wobec KODU, nie wobec Chrome - kanoniczna wersja
    // stoi na `buildCouponInsert` w `couponAdminForm.test.ts`.
    renderDialog();
    fireEvent.change(pole("adminCoupons.code"), { target: { value: "NES-1" } });
    fireEvent.change(pole("adminCoupons.percent"), { target: { value: "12abc" } });
    zapisz();
    await waitFor(() => expect(liczbaZapisow()).toBe(1));
    expect(Number.isNaN(ostatniLadunek().discount_percent)).toBe(true);
    expect(h.toastError).not.toHaveBeenCalled();
  });
});

describe("DEFEKT: liczba dni subskrypcji bez warstwy", () => {
  it.fails("powrót do „Brak” powinien wyczyścić grants_duration_days w ładunku", async () => {
    renderDialog();
    fireEvent.change(pole("adminCoupons.code"), { target: { value: "NES-1" } });
    const warstwa = screen.getAllByRole("combobox")[1];
    fireEvent.change(warstwa, { target: { value: "gold" } });
    fireEvent.change(pole("adminCoupons.durationDays"), { target: { value: "30" } });
    fireEvent.change(warstwa, { target: { value: "none" } });
    zapisz();
    await waitFor(() => expect(liczbaZapisow()).toBe(1));
    expect(ostatniLadunek()).toMatchObject({
      grants_tier_key: null,
      grants_duration_days: null,
    });
  });

  it("STAN FAKTYCZNY: do bazy idzie 30 dni subskrypcji bez wskazanej warstwy", async () => {
    renderDialog();
    fireEvent.change(pole("adminCoupons.code"), { target: { value: "NES-1" } });
    const warstwa = screen.getAllByRole("combobox")[1];
    fireEvent.change(warstwa, { target: { value: "gold" } });
    fireEvent.change(pole("adminCoupons.durationDays"), { target: { value: "30" } });
    fireEvent.change(warstwa, { target: { value: "none" } });
    zapisz();
    await waitFor(() => expect(liczbaZapisow()).toBe(1));
    expect(ostatniLadunek()).toMatchObject({
      grants_tier_key: null,
      grants_duration_days: 30,
    });
  });
});

describe("odmowa bazy", () => {
  const KOLIZJA = 'duplicate key value violates unique constraint "b2b_coupons_code_unique"';

  it("kolizja kodu pokazuje SUROWY komunikat Postgresa, nie klucz i18n", async () => {
    renderDialog(fail(KOLIZJA));
    fireEvent.change(pole("adminCoupons.code"), { target: { value: "NES-1" } });
    zapisz();
    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith(KOLIZJA));
    expect(h.toastSuccess).not.toHaveBeenCalled();
  });

  it("po odmowie dialog ZOSTAJE z wpisaną treścią i nie melduje utworzenia", async () => {
    const { onCreated } = renderDialog(fail(KOLIZJA));
    fireEvent.change(pole("adminCoupons.code"), { target: { value: "NES-1" } });
    zapisz();
    await waitFor(() => expect(h.toastError).toHaveBeenCalled());
    expect(onCreated).not.toHaveBeenCalled();
    expect((pole("adminCoupons.code") as HTMLInputElement).value).toBe("NES-1");
  });

  it("po odmowie przycisk wraca do użycia - drugi zapis JEST możliwy", async () => {
    renderDialog(fail(KOLIZJA));
    fireEvent.change(pole("adminCoupons.code"), { target: { value: "NES-1" } });
    zapisz();
    await waitFor(() => expect(liczbaZapisow()).toBe(1));
    expect(screen.getByRole("button", { name: "adminCoupons.createCoupon" })).toBeEnabled();
    zapisz();
    await waitFor(() => expect(liczbaZapisow()).toBe(2));
  });
});

describe("sukces", () => {
  it("melduje się kluczem adminCoupons.couponCreated i oddaje sterowanie wołającemu", async () => {
    const { onCreated } = renderDialog();
    fireEvent.change(pole("adminCoupons.code"), { target: { value: "NES-1" } });
    zapisz();
    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
    expect(h.toastSuccess).toHaveBeenCalledWith("adminCoupons.couponCreated");
    expect(h.toastError).not.toHaveBeenCalled();
  });
});
