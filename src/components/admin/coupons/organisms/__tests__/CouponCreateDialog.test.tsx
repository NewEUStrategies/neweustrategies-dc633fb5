// Dialog tworzenia kuponu B2B.
//
// PO CO TEN PLIK ISTNIEJE. To jest formularz, ktory ZAKLADA ZOBOWIAZANIE:
// kazdy zapisany wiersz obniza przyszla fakture albo przyznaje abonament.
// Panel listy pokazuje juz tylko skutek, wiec caly ciezar poprawnosci lezy tutaj:
//   1. KOD NORMALIZUJE SIE PRZED ZAPISEM. Kasa porownuje kody po wersji
//      wielkimi literami i bez spacji. Kod zapisany jako „ nes-b2b-10 " nie
//      zadziala nigdy, a redakcja bedzie widziala go na liscie jako istniejacy.
//   2. RABAT MA GRANICE. Procent poza 1-100 i kwota niedodatnia to wiersze,
//      ktore albo nic nie daja, albo daja rabat wiekszy niz cena.
//   3. POLA OPCJONALNE ZAPISUJA SIE JAKO NULL, NIE JAKO PUSTY NAPIS. Pusty
//      napis w kolumnie `name` przechodzi walidacje bazy i pozniej wyglada na
//      liscie jak kupon bez nazwy, ktorego nie da sie odroznic od innych.
//   4. ODMOWA BAZY NIE ZAMYKA DIALOGU. Zamkniecie kasuje caly wypelniony
//      formularz razem z komunikatem o przyczynie.
//   5. POLA ZALEZNE OD RODZAJU RABATU. `discount_percent` i `discount_cents`
//      musza sie WYKLUCZAC - wiersz z obiema wartosciami jest niejednoznaczny
//      dla kasy.
//
// GRANICE vs SASIEDZI. `DatePickerField` (`@/components/admin/coupons/*`) i
// `normalizeCouponCode` (`@/lib/billing/coupons`) biegna PRAWDZIWE. Atrapowane
// sa: klient Supabase, toasty, i18n, Radiksowy Select (nie otwiera listy pod
// happy-dom) i Radiksowy Checkbox.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { render } from "@testing-library/react";
import type { ReactNode } from "react";
import { fail, ok, type SupabaseFromStub } from "@/test/supabaseChain";
import { axeViolations, summarize } from "@/test/axe";

const h = vi.hoisted(() => ({
  from: null as unknown,
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("sonner", () => ({ toast: { success: h.toastSuccess, error: h.toastError } }));

vi.mock("@/integrations/supabase/client", async () => {
  const { supabaseFromStub } = await import("@/test/supabaseChain");
  const from = supabaseFromStub();
  h.from = from;
  return { supabase: { from: from.from } };
});

vi.mock("@/components/ui/select", async () =>
  (await import("@/test/reactStubs")).radixSelectStub(await import("react")),
);
vi.mock("@/components/ui/checkbox", async () => {
  const React = await import("react");
  return {
    Checkbox: ({
      checked,
      onCheckedChange,
    }: {
      checked?: boolean;
      onCheckedChange?: (next: boolean) => void;
    }) =>
      React.createElement("input", {
        type: "checkbox",
        checked: !!checked,
        onChange: (event: { target: { checked: boolean } }) =>
          onCheckedChange?.(event.target.checked),
      }),
  };
});

// Dialog Radiksa montuje tresc w portalu; tutaj testujemy SAMA TRESC, wiec
// atrapa jest przezroczysta - `DialogContent` zawsze renderuje dzieci.
vi.mock("@/components/ui/dialog", async () => {
  const React = await import("react");
  return {
    DialogContent: ({ children }: { children?: ReactNode }) =>
      React.createElement("div", { role: "dialog" }, children as never),
    DialogHeader: ({ children }: { children?: ReactNode }) =>
      React.createElement("div", null, children as never),
    DialogFooter: ({ children }: { children?: ReactNode }) =>
      React.createElement("div", null, children as never),
    DialogTitle: ({ children }: { children?: ReactNode }) =>
      React.createElement("h2", null, children as never),
  };
});

import { CouponCreateDialog } from "../CouponCreateDialog";

const db = () => h.from as SupabaseFromStub;

/** Ustawiona przez test, ktory planuje odmowe zapisu przed renderem. */
let zaplanowanaOdmowa = false;

const PLANY = [
  { id: "plan-a", name_pl: "Plan roczny", name_en: "Annual plan", active: true },
  { id: "plan-b", name_pl: "Plan archiwalny", name_en: "Archived plan", active: false },
];
const POZIOMY = [
  { key: "premium", name_pl: "Premium", name_en: "Premium", active: true },
  { key: "vip", name_pl: "VIP", name_en: "VIP", active: true },
];

function renderDialog(onCreated = vi.fn()) {
  // Odpowiedz ustawiamy tylko wtedy, gdy test sam jej nie zaplanowal - inaczej
  // pomocnik nadpisywalby zaplanowana ODMOWE zapisu.
  if (!zaplanowanaOdmowa) db().setResponse("b2b_coupons", ok(null));
  const utils = render(<CouponCreateDialog plans={PLANY} tiers={POZIOMY} onCreated={onCreated} />);
  return { ...utils, onCreated };
}

function pole(etykieta: string): HTMLElement {
  // Po naprawie kazda etykieta wskazuje swoje pole przez `htmlFor`/`id`, wiec
  // test siega po kontrolke DOKLADNIE tak, jak zrobi to czytnik ekranu.
  return screen.getByLabelText(etykieta);
}

/** Pierwsza lista wyboru w dialogu to RODZAJ RABATU (druga - poziom). */
function listaRodzajuRabatu(): HTMLElement {
  return screen.getAllByRole("combobox")[0];
}

function zapisz(): HTMLElement {
  return screen.getByRole("button", { name: "adminCoupons.createCoupon" });
}

function insertPayload(): Record<string, unknown> {
  return db()
    .chainsFor("b2b_coupons")
    .find((c) => c.has("insert"))
    ?.argsOf("insert")?.[0] as Record<string, unknown>;
}

beforeEach(() => {
  db().reset();
  zaplanowanaOdmowa = false;
  h.toastSuccess.mockReset();
  h.toastError.mockReset();
});

describe("CouponCreateDialog - walidacja", () => {
  it("PUSTY kod blokuje zapis", async () => {
    renderDialog();
    fireEvent.click(zapisz());
    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("adminCoupons.enterCode"));
    expect(db().chainsFor("b2b_coupons")).toHaveLength(0);
  });

  it("kod z samych SPACJI to nadal pusty kod", async () => {
    // `normalizeCouponCode` przycina biale znaki - straznik musi patrzec na
    // wynik normalizacji, a nie na surowa zawartosc pola.
    renderDialog();
    fireEvent.change(pole("adminCoupons.code"), { target: { value: "   " } });
    fireEvent.click(zapisz());
    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("adminCoupons.enterCode"));
    expect(db().chainsFor("b2b_coupons")).toHaveLength(0);
  });

  it("PROCENT ponizej 1 blokuje zapis", async () => {
    // Rabat 0% to kupon, ktory nic nie robi, a klient dostal go jako obietnice.
    renderDialog();
    fireEvent.change(pole("adminCoupons.code"), { target: { value: "NES-0" } });
    fireEvent.change(pole("adminCoupons.percent"), { target: { value: "0" } });
    fireEvent.click(zapisz());
    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("adminCoupons.percent1100"));
    expect(db().chainsFor("b2b_coupons")).toHaveLength(0);
  });

  it("PROCENT powyzej 100 blokuje zapis", async () => {
    // Rabat 150% oznaczalby doplate do klienta.
    renderDialog();
    fireEvent.change(pole("adminCoupons.code"), { target: { value: "NES-150" } });
    fireEvent.change(pole("adminCoupons.percent"), { target: { value: "150" } });
    fireEvent.click(zapisz());
    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("adminCoupons.percent1100"));
    expect(db().chainsFor("b2b_coupons")).toHaveLength(0);
  });

  it("granice 1 i 100 sa DOPUSZCZALNE", async () => {
    // Straznik ma odcinac wartosci POZA zakresem, a nie same krance -
    // „100%" to normalny kupon dla partnera medialnego.
    renderDialog();
    fireEvent.change(pole("adminCoupons.code"), { target: { value: "NES-100" } });
    fireEvent.change(pole("adminCoupons.percent"), { target: { value: "100" } });
    fireEvent.click(zapisz());
    await waitFor(() => expect(insertPayload()).toBeDefined());
    expect(insertPayload().discount_percent).toBe(100);
  });

  it("KWOTA niedodatnia blokuje zapis", async () => {
    renderDialog();
    fireEvent.change(pole("adminCoupons.code"), { target: { value: "NES-KWOTA" } });
    fireEvent.change(listaRodzajuRabatu(), { target: { value: "fixed" } });
    fireEvent.change(pole("adminCoupons.amountCents"), { target: { value: "0" } });
    fireEvent.click(zapisz());
    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("adminCoupons.amount0"));
    expect(db().chainsFor("b2b_coupons")).toHaveLength(0);
  });

  it("zakres PROCENTU nie blokuje kuponu KWOTOWEGO", async () => {
    // Straznik procentu musi patrzec na wybrany rodzaj rabatu - inaczej
    // domyslne 10% (albo cokolwiek zostalo w polu) blokuje formularz kwotowy.
    renderDialog();
    fireEvent.change(pole("adminCoupons.code"), { target: { value: "NES-KWOTA" } });
    fireEvent.change(pole("adminCoupons.percent"), { target: { value: "999" } });
    fireEvent.change(listaRodzajuRabatu(), { target: { value: "fixed" } });
    fireEvent.change(pole("adminCoupons.amountCents"), { target: { value: "5000" } });
    fireEvent.click(zapisz());
    await waitFor(() => expect(insertPayload()).toBeDefined());
    expect(h.toastError).not.toHaveBeenCalled();
  });
});

describe("CouponCreateDialog - ladunek zapisu", () => {
  it("KOD normalizuje sie do wielkich liter i bez spacji", async () => {
    // Bez tego kod z listy nigdy nie zgodzi sie z tym, co wpisze klient.
    renderDialog();
    fireEvent.change(pole("adminCoupons.code"), { target: { value: "  nes-b2b-10 " } });
    fireEvent.click(zapisz());
    await waitFor(() => expect(insertPayload()).toBeDefined());
    expect(insertPayload().code).toBe("NES-B2B-10");
  });

  it("kupon PROCENTOWY nie niesie kwoty ani waluty", async () => {
    // Wiersz z obiema wartosciami rabatu jest dla kasy niejednoznaczny.
    renderDialog();
    fireEvent.change(pole("adminCoupons.code"), { target: { value: "NES-P" } });
    fireEvent.change(pole("adminCoupons.percent"), { target: { value: "25" } });
    fireEvent.click(zapisz());
    await waitFor(() => expect(insertPayload()).toBeDefined());
    expect(insertPayload()).toMatchObject({
      discount_kind: "percent",
      discount_percent: 25,
      discount_cents: null,
      currency: null,
    });
  });

  it("kupon KWOTOWY nie niesie procentu, a waluta idzie WIELKIMI literami", async () => {
    // Kolumna `currency` jest porownywana z waluta planu bez normalizacji -
    // „pln" nie zgodzi sie z „PLN" i kupon zostanie odrzucony przy kasie.
    renderDialog();
    fireEvent.change(pole("adminCoupons.code"), { target: { value: "NES-F" } });
    fireEvent.change(listaRodzajuRabatu(), { target: { value: "fixed" } });
    fireEvent.change(pole("adminCoupons.amountCents"), { target: { value: "2500" } });
    fireEvent.change(pole("adminCoupons.currency"), { target: { value: "eur" } });
    fireEvent.click(zapisz());
    await waitFor(() => expect(insertPayload()).toBeDefined());
    expect(insertPayload()).toMatchObject({
      discount_kind: "fixed",
      discount_percent: null,
      discount_cents: 2500,
      currency: "EUR",
    });
  });

  it("puste pola opcjonalne zapisuja sie jako NULL, nie jako pusty napis", async () => {
    renderDialog();
    fireEvent.change(pole("adminCoupons.code"), { target: { value: "NES-MIN" } });
    fireEvent.click(zapisz());
    await waitFor(() => expect(insertPayload()).toBeDefined());
    expect(insertPayload()).toMatchObject({
      name: null,
      description: null,
      max_redemptions: null,
      valid_from: null,
      valid_until: null,
      grants_tier_key: null,
      grants_duration_days: null,
    });
  });

  it("nazwa i opis sa PRZYCINANE z bialych znakow", async () => {
    renderDialog();
    fireEvent.change(pole("adminCoupons.code"), { target: { value: "NES-N" } });
    fireEvent.change(pole("adminCoupons.nameOptional"), { target: { value: "  Partner  " } });
    fireEvent.change(pole("adminCoupons.internalDescription"), {
      target: { value: "  umowa 2026  " },
    });
    fireEvent.click(zapisz());
    await waitFor(() => expect(insertPayload()).toBeDefined());
    expect(insertPayload()).toMatchObject({ name: "Partner", description: "umowa 2026" });
  });

  it("limit wykorzystan zapisuje sie jako LICZBA", async () => {
    renderDialog();
    fireEvent.change(pole("adminCoupons.code"), { target: { value: "NES-L" } });
    fireEvent.change(pole("adminCoupons.maxRedemptions"), { target: { value: "50" } });
    fireEvent.click(zapisz());
    await waitFor(() => expect(insertPayload()).toBeDefined());
    expect(insertPayload().max_redemptions).toBe(50);
  });

  it("wybrany POZIOM abonamentu i liczba dni trafiaja do ladunku", async () => {
    // To jest sciezka, ktora przyznaje platny dostep za darmo - musi dojechac
    // do kolumn dokladnie tak, jak wybrano w formularzu.
    renderDialog();
    fireEvent.change(pole("adminCoupons.code"), { target: { value: "NES-T" } });
    const listy = screen.getAllByRole("combobox");
    fireEvent.change(listy[1], { target: { value: "vip" } });
    fireEvent.change(pole("adminCoupons.durationDays"), { target: { value: "30" } });
    fireEvent.click(zapisz());
    await waitFor(() => expect(insertPayload()).toBeDefined());
    expect(insertPayload()).toMatchObject({ grants_tier_key: "vip", grants_duration_days: 30 });
  });

  it("wybor `brak poziomu` zapisuje NULL, a nie napis `none`", async () => {
    // „none" jest wartoscia TECHNICZNA listy (Radix nie przyjmuje pustego
    // napisu jako wartosci opcji). Zapisana do bazy byłaby nieistniejacym
    // kluczem poziomu.
    renderDialog();
    fireEvent.change(pole("adminCoupons.code"), { target: { value: "NES-NONE" } });
    const listy = screen.getAllByRole("combobox");
    fireEvent.change(listy[1], { target: { value: "vip" } });
    fireEvent.change(listy[1], { target: { value: "none" } });
    fireEvent.click(zapisz());
    await waitFor(() => expect(insertPayload()).toBeDefined());
    expect(insertPayload().grants_tier_key).toBeNull();
  });

  it("pole `liczba dni` jest ZABLOKOWANE dopoki nie wybrano poziomu", async () => {
    // Liczba dni bez poziomu nic nie znaczy; blokada jest tanszym hamulcem niz
    // walidacja po fakcie.
    renderDialog();
    expect(pole("adminCoupons.durationDays")).toBeDisabled();
    fireEvent.change(screen.getAllByRole("combobox")[1], { target: { value: "premium" } });
    expect(pole("adminCoupons.durationDays")).not.toBeDisabled();
  });

  it("zaznaczone PLANY trafiaja do `plan_ids`, odznaczenie je usuwa", async () => {
    // `plan_ids` zaweza kupon do konkretnych planow. Zgubione zaznaczenie robi
    // z kuponu partnerskiego kupon na wszystko.
    renderDialog();
    fireEvent.change(pole("adminCoupons.code"), { target: { value: "NES-PLAN" } });
    const checkboxy = screen.getAllByRole("checkbox");
    fireEvent.click(checkboxy[0]);
    fireEvent.click(checkboxy[1]);
    fireEvent.click(checkboxy[1]);
    fireEvent.click(zapisz());
    await waitFor(() => expect(insertPayload()).toBeDefined());
    expect(insertPayload().plan_ids).toEqual(["plan-a"]);
  });

  it("plan NIEAKTYWNY jest widoczny, ale wizualnie przekreslony", async () => {
    // Kupon moze celowo dotyczyc planu wycofanego (przedluzenie dla obecnych
    // klientow), wiec plan nie znika z listy - ma tylko wygladac inaczej.
    renderDialog();
    const archiwalny = screen.getByText("Plan archiwalny");
    expect(archiwalny.className).toContain("line-through");
    expect(screen.getByText("Plan roczny").className).not.toContain("line-through");
  });

  it("pusty katalog planow konczy sie komunikatem, a nie pusta ramka", async () => {
    render(<CouponCreateDialog plans={[]} tiers={POZIOMY} onCreated={vi.fn()} />);
    expect(screen.getByText("adminCoupons.plansAvailable")).toBeInTheDocument();
  });

  it("wybrana DATA waznosci zapisuje sie jako ISO", async () => {
    // `DatePickerField` biegnie prawdziwy (sasiad), wiec razem z nim testujemy
    // realny kalendarz: wybor dnia ma dac znacznik czasu, a nie `undefined`.
    renderDialog();
    fireEvent.change(pole("adminCoupons.code"), { target: { value: "NES-DATA" } });
    const wyzwalacze = screen.getAllByRole("button", { name: /Wybierz dat/ });
    fireEvent.click(wyzwalacze[0]);
    const komorka = await screen.findByRole("gridcell", { name: "15" });
    // Kalendarz `react-day-picker` trzyma klikalny przycisk WEWNATRZ komorki
    // siatki; klikniecie samej komorki nie wybiera dnia.
    fireEvent.click(komorka.querySelector("button") ?? komorka);
    fireEvent.click(zapisz());
    await waitFor(() => expect(insertPayload()).toBeDefined());
    const iso = insertPayload().valid_from;
    expect(typeof iso).toBe("string");
    expect(new Date(String(iso)).getDate()).toBe(15);
  });
});

describe("CouponCreateDialog - wynik zapisu", () => {
  it("SUKCES melduje sie toastem i zamyka dialog przez `onCreated`", async () => {
    const { onCreated } = renderDialog();
    fireEvent.change(pole("adminCoupons.code"), { target: { value: "NES-OK" } });
    fireEvent.click(zapisz());
    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
    expect(h.toastSuccess).toHaveBeenCalledWith("adminCoupons.couponCreated");
  });

  it("ODMOWA bazy pokazuje komunikat i NIE zamyka dialogu", async () => {
    // Zamkniecie skasowaloby caly wypelniony formularz razem z przyczyna
    // odmowy - najczestsza z nich to duplikat kodu, ktory trzeba poprawic
    // w miejscu.
    db().setResponse(
      "b2b_coupons",
      fail("duplicate key value violates unique constraint", "23505"),
    );
    zaplanowanaOdmowa = true;
    const { onCreated } = renderDialog();
    fireEvent.change(pole("adminCoupons.code"), { target: { value: "NES-DUP" } });
    fireEvent.click(zapisz());
    await waitFor(() =>
      expect(h.toastError).toHaveBeenCalledWith("duplicate key value violates unique constraint"),
    );
    expect(onCreated).not.toHaveBeenCalled();
    expect(h.toastSuccess).not.toHaveBeenCalled();
    expect(pole("adminCoupons.code")).toHaveValue("NES-DUP");
  });

  it("po ODMOWIE przycisk zapisu WRACA do stanu klikalnego", async () => {
    // Blokada „w locie" zdjeta tylko na sciezce sukcesu zamienialaby jedna
    // odmowe w trwale martwy formularz.
    db().setResponse("b2b_coupons", fail("nie udalo sie zapisac", "XX000"));
    zaplanowanaOdmowa = true;
    renderDialog();
    fireEvent.change(pole("adminCoupons.code"), { target: { value: "NES-X" } });
    fireEvent.click(zapisz());
    await waitFor(() => expect(h.toastError).toHaveBeenCalled());
    expect(zapisz()).not.toBeDisabled();
  });

  it("zapis idzie do tabeli `b2b_coupons`", async () => {
    renderDialog();
    fireEvent.change(pole("adminCoupons.code"), { target: { value: "NES-TBL" } });
    fireEvent.click(zapisz());
    await waitFor(() => expect(insertPayload()).toBeDefined());
    expect(db().chainsFor("b2b_coupons")).toHaveLength(1);
  });
});

describe("CouponCreateDialog - dostepnosc", () => {
  it("formularz nie ma strukturalnych naruszen dostepnosci", async () => {
    const { container } = renderDialog();
    const naruszenia = await axeViolations(container, {
      // Atrapa Radiksowego Selecta renderuje natywny `<select>` bez nazwy -
      // to artefakt atrapy, nie produkcyjnego DOM.
      "select-name": { enabled: false },
      // Brak powiazania etykiet z polami jest zarejestrowany nizej jako defekt.
      label: { enabled: false },
      "form-field-multiple-labels": { enabled: false },
      // Atrapa `DialogContent` nadaje role `dialog` bez powiazania z tytulem;
      // w produkcji Radix wiaze je przez `aria-labelledby`. To artefakt atrapy.
      "aria-dialog-name": { enabled: false },
    });
    expect(naruszenia, summarize(naruszenia)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// DEFEKTY NAPRAWIONE (dawne `it.fails`).
// ---------------------------------------------------------------------------
describe("CouponCreateDialog - dawne defekty", () => {
  it("etykiety pol sa POWIAZANE z kontrolkami", async () => {
    // CO BYLO ZLE. Formularz uzywal `<Label>{t(...)}</Label>` bez `htmlFor`
    // i bez `id` na polach. Zaden `<label>` nie wskazywal wiec swojego pola -
    // axe-core zglaszal regule `label`, a `getByLabelText` nie znajdowal w tym
    // dialogu ani jednej kontrolki (dlatego pomocnik `pole()` w tym pliku
    // szukal po strukturze DOM, a nie po etykiecie).
    //
    // JAKIE TO BYLO RYZYKO. (a) Czytnik ekranu odczytywal pola jako bezimienne
    // („pole edycji"), a jest ich w tym dialogu jedenascie - w tym KOD KUPONU
    // i KWOTA RABATU. (b) Klikniecie w etykiete nie ustawialo fokusu w polu,
    // co przy polach wysokosci 40 px i gestym ukladzie dwukolumnowym bylo
    // realnym utrudnieniem takze dla osoby widzacej.
    //
    // JAK NAPRAWIONE. Kazde pole ma `id`, a jego `<Label>` - `htmlFor`
    // (`coupon-code`, `coupon-name`, `coupon-description`, `coupon-percent`,
    // `coupon-cents`, `coupon-currency`, `coupon-max-redemptions`,
    // `coupon-duration-days` oraz obie listy wyboru). Pomocnik `pole()` pyta
    // teraz o kontrolke po etykiecie.
    const { container } = renderDialog();
    const naruszenia = await axeViolations(container, { "select-name": { enabled: false } });
    expect(naruszenia.map((v) => v.id)).not.toContain("label");
  });

  it("kod kuponu jest normalizowany takze W POLU, nie tylko przy zapisie", async () => {
    // CO BYLO ZLE. Pole kodu ma klase `uppercase` - CSS pokazywal wielkie
    // litery, ale WARTOSC pola zostawala taka, jak wpisano. Normalizacja
    // (`normalizeCouponCode`) dzialala dopiero w `submit`.
    //
    // JAKIE TO BYLO RYZYKO. Redaktor widzial „NES-B2B-10", a schowek,
    // zaznaczenie i wklejenie do wiadomosci dla klienta dawaly „nes-b2b-10".
    // Roznica byla niewidoczna na ekranie i ujawniala sie dopiero przy kasie,
    // gdzie kod porownuje sie po wersji znormalizowanej. To jest dokladnie ten
    // rodzaj bledu, ktory trafia do maila do partnera.
    //
    // JAK NAPRAWIONE. `onChange` pola kodu wola `normalizeCouponCode`, wiec
    // stan komponentu i schowek niosa dokladnie to, co widac na ekranie.
    renderDialog();
    const kod = pole("adminCoupons.code");
    fireEvent.change(kod, { target: { value: "nes-b2b-10" } });
    expect(kod).toHaveValue("NES-B2B-10");
  });
});
