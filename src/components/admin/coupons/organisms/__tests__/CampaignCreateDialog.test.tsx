// Dialog tworzenia kampanii kuponowej.
//
// PO CO TEN PLIK ISTNIEJE. Ten formularz nie zaklada jednego kuponu - zaklada
// PRZEPIS na masowe wygenerowanie do 10 000 dzialajacych kodow. Wszystko, co
// tu zle wpisane, zwielokrotnia sie przy pierwszym kliknieciu „Generuj" na
// stronie kampanii, a kodow nie da sie potem wycofac pojedynczo.
//   1. RABAT MUSI BYC JEDNOZNACZNY. `discount_percent` i `discount_cents`
//      wykluczaja sie - wiersz z obiema wartosciami jest dla kasy niejasny,
//      a przepis rozniesie te niejasnosc na kazdy kod.
//   2. CZAS TRWANIA ABONAMENTU BEZ POZIOMU NIC NIE ZNACZY. Zapisany mimo
//      braku poziomu zostaje w bazie jako liczba dni dostepu do niczego.
//   3. POLA OPCJONALNE ZAPISUJA SIE JAKO NULL. Pusty napis w `newsletter_segment`
//      to segment o nazwie „" - wysylka trafia wtedy albo do nikogo, albo do
//      wszystkich, zaleznie od interpretacji filtru.
//   4. ODMOWA BAZY NIE ZAMYKA DIALOGU - inaczej ginie caly wypelniony przepis.
//
// GRANICE vs SASIEDZI: `DatePickerField` (`@/components/admin/coupons/*`)
// i `pickLocalized` biegna PRAWDZIWE; atrapowane sa klient Supabase, toasty,
// i18n oraz Radiksowe Select i Dialog.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { fail, ok, type SupabaseFromStub } from "@/test/supabaseChain";

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

vi.mock("@/components/ui/dialog", async () => {
  const React = await import("react");
  return {
    DialogContent: ({ children }: { children?: ReactNode }) =>
      React.createElement("div", null, children as never),
    DialogHeader: ({ children }: { children?: ReactNode }) =>
      React.createElement("div", null, children as never),
    DialogFooter: ({ children }: { children?: ReactNode }) =>
      React.createElement("div", null, children as never),
    DialogTitle: ({ children }: { children?: ReactNode }) =>
      React.createElement("h2", null, children as never),
  };
});

import { CampaignCreateDialog } from "../CampaignCreateDialog";

const db = () => h.from as SupabaseFromStub;

const POZIOMY = [
  { key: "premium", name_pl: "Premium", name_en: "Premium" },
  { key: "vip", name_pl: "VIP", name_en: "VIP" },
];

/** Ustawiona przez test, ktory planuje odmowe zapisu przed renderem. */
let zaplanowanaOdmowa = false;

function renderDialog(onCreated = vi.fn()) {
  if (!zaplanowanaOdmowa) db().setResponse("b2b_coupon_campaigns", ok(null));
  const utils = render(<CampaignCreateDialog tiers={POZIOMY} onCreated={onCreated} />);
  return { ...utils, onCreated };
}

function pole(etykieta: string): HTMLElement {
  // Etykiety nie sa zwiazane z polami przez `htmlFor` (ten sam brak, co
  // w dialogu kuponu), wiec szukamy kontrolki w kontenerze etykiety.
  const label = screen.getByText(etykieta);
  const control = label.parentElement?.querySelector("input, textarea, select");
  if (!control) throw new Error(`brak kontrolki dla etykiety ${etykieta}`);
  return control as HTMLElement;
}

function zapisz(): HTMLElement {
  return screen.getByRole("button", { name: "adminCoupons.createCampaign" });
}

function insertPayload(): Record<string, unknown> {
  return db()
    .chainsFor("b2b_coupon_campaigns")
    .find((c) => c.has("insert"))
    ?.argsOf("insert")?.[0] as Record<string, unknown>;
}

beforeEach(() => {
  db().reset();
  zaplanowanaOdmowa = false;
  h.toastSuccess.mockReset();
  h.toastError.mockReset();
});

describe("CampaignCreateDialog - walidacja", () => {
  it("PUSTA nazwa blokuje zapis", async () => {
    // Nazwa jest jedynym identyfikatorem kampanii w panelu i w nazwie pliku
    // CSV - kampania bez nazwy jest nieodnajdywalna.
    renderDialog();
    fireEvent.click(zapisz());
    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("adminCoupons.enterName"));
    expect(db().chainsFor("b2b_coupon_campaigns")).toHaveLength(0);
  });

  it("sama SPACJA to nadal pusta nazwa", async () => {
    renderDialog();
    fireEvent.change(pole("adminCoupons.name"), { target: { value: "   " } });
    fireEvent.click(zapisz());
    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("adminCoupons.enterName"));
    expect(db().chainsFor("b2b_coupon_campaigns")).toHaveLength(0);
  });
});

describe("CampaignCreateDialog - ladunek zapisu", () => {
  it("wartosci domyslne przepisu ida do bazy tak, jak je widzi redaktor", async () => {
    // Redaktor moze kliknac „Utworz" nie dotykajac zadnego pola poza nazwa.
    // Wtedy to WLASNIE te liczby zostana przepisem na kody, wiec musza byc
    // tym, co pokazuje formularz: 8 znakow, 100 kodow, 20%.
    renderDialog();
    fireEvent.change(pole("adminCoupons.name"), { target: { value: "Q1 2026 VIP" } });
    fireEvent.click(zapisz());
    await waitFor(() => expect(insertPayload()).toBeDefined());
    expect(insertPayload()).toMatchObject({
      name: "Q1 2026 VIP",
      code_length: 8,
      code_count: 100,
      discount_kind: "percent",
      discount_percent: 20,
    });
  });

  it("PREFIKS jest podnoszony do wielkich liter JUZ W POLU", async () => {
    // Kontrast z dialogiem pojedynczego kuponu, gdzie wielkie litery robi samo
    // CSS: tutaj wartosc pola faktycznie sie zmienia, wiec to, co widzi
    // redaktor, jest tym, co pojdzie do kazdego kodu kampanii.
    renderDialog();
    const prefiks = pole("adminCoupons.prefix");
    fireEvent.change(prefiks, { target: { value: "nes-" } });
    expect(prefiks).toHaveValue("NES-");
  });

  it("kampania PROCENTOWA nie niesie kwoty ani waluty", async () => {
    renderDialog();
    fireEvent.change(pole("adminCoupons.name"), { target: { value: "Procentowa" } });
    fireEvent.change(pole("adminCoupons.percent"), { target: { value: "35" } });
    fireEvent.click(zapisz());
    await waitFor(() => expect(insertPayload()).toBeDefined());
    expect(insertPayload()).toMatchObject({
      discount_kind: "percent",
      discount_percent: 35,
      discount_cents: null,
      currency: null,
    });
  });

  it("kampania KWOTOWA nie niesie procentu, a waluta idzie WIELKIMI literami", async () => {
    renderDialog();
    fireEvent.change(pole("adminCoupons.name"), { target: { value: "Kwotowa" } });
    fireEvent.change(screen.getAllByRole("combobox")[0], { target: { value: "fixed" } });
    fireEvent.change(pole("adminCoupons.amountCents2"), { target: { value: "4500" } });
    fireEvent.change(pole("adminCoupons.currency"), { target: { value: "eur" } });
    fireEvent.click(zapisz());
    await waitFor(() => expect(insertPayload()).toBeDefined());
    expect(insertPayload()).toMatchObject({
      discount_kind: "fixed",
      discount_percent: null,
      discount_cents: 4500,
      currency: "EUR",
    });
  });

  it("opis i segment sa PRZYCINANE, a puste zapisuja sie jako NULL", async () => {
    renderDialog();
    fireEvent.change(pole("adminCoupons.name"), { target: { value: "Kampania" } });
    fireEvent.change(pole("adminCoupons.descriptionOptional"), { target: { value: "   " } });
    fireEvent.change(pole("adminCoupons.newsletterSegmentTag"), { target: { value: "  vip  " } });
    fireEvent.click(zapisz());
    await waitFor(() => expect(insertPayload()).toBeDefined());
    expect(insertPayload()).toMatchObject({ description: null, newsletter_segment: "vip" });
  });

  it("liczba dni abonamentu zapisuje sie TYLKO razem z poziomem", async () => {
    // Pole startuje z wartoscia „30" i jest zablokowane. Bez tego warunku
    // kazda kampania bez abonamentu zapisywalaby 30 dni dostepu do niczego.
    renderDialog();
    fireEvent.change(pole("adminCoupons.name"), { target: { value: "Bez abonamentu" } });
    fireEvent.click(zapisz());
    await waitFor(() => expect(insertPayload()).toBeDefined());
    expect(insertPayload()).toMatchObject({
      grants_tier_key: null,
      grants_duration_days: null,
    });
  });

  it("wybrany POZIOM odblokowuje pole dni i oba trafiaja do ladunku", async () => {
    renderDialog();
    fireEvent.change(pole("adminCoupons.name"), { target: { value: "Z abonamentem" } });
    expect(pole("adminCoupons.durationDays")).toBeDisabled();
    fireEvent.change(screen.getAllByRole("combobox")[1], { target: { value: "premium" } });
    expect(pole("adminCoupons.durationDays")).not.toBeDisabled();
    fireEvent.change(pole("adminCoupons.durationDays"), { target: { value: "90" } });
    fireEvent.click(zapisz());
    await waitFor(() => expect(insertPayload()).toBeDefined());
    expect(insertPayload()).toMatchObject({
      grants_tier_key: "premium",
      grants_duration_days: 90,
    });
  });

  it("wybor `brak poziomu` zapisuje NULL, a nie techniczne `none`", async () => {
    renderDialog();
    fireEvent.change(pole("adminCoupons.name"), { target: { value: "Bez poziomu" } });
    const listy = screen.getAllByRole("combobox");
    fireEvent.change(listy[1], { target: { value: "vip" } });
    fireEvent.change(listy[1], { target: { value: "none" } });
    fireEvent.click(zapisz());
    await waitFor(() => expect(insertPayload()).toBeDefined());
    expect(insertPayload().grants_tier_key).toBeNull();
  });

  it("lista poziomow pokazuje nazwy z katalogu w jezyku interfejsu", async () => {
    renderDialog();
    expect(screen.getByRole("option", { name: "Premium" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "VIP" })).toBeInTheDocument();
  });

  it("wybrana DATA waznosci zapisuje sie jako ISO", async () => {
    // `DatePickerField` biegnie prawdziwy - razem z nim sprawdzamy, ze wybor
    // dnia w kalendarzu daje znacznik czasu, a nie `undefined`.
    renderDialog();
    fireEvent.change(pole("adminCoupons.name"), { target: { value: "Z data" } });
    fireEvent.click(screen.getByRole("button", { name: /Wybierz dat/ }));
    const komorka = await screen.findByRole("gridcell", { name: "15" });
    fireEvent.click(komorka.querySelector("button") ?? komorka);
    fireEvent.click(zapisz());
    await waitFor(() => expect(insertPayload()).toBeDefined());
    const iso = insertPayload().valid_until;
    expect(typeof iso).toBe("string");
    expect(new Date(String(iso)).getDate()).toBe(15);
  });

  it("BEZ wybranej daty `valid_until` zapisuje sie jako NULL", async () => {
    renderDialog();
    fireEvent.change(pole("adminCoupons.name"), { target: { value: "Bezterminowa" } });
    fireEvent.click(zapisz());
    await waitFor(() => expect(insertPayload()).toBeDefined());
    expect(insertPayload().valid_until).toBeNull();
  });
});

describe("CampaignCreateDialog - wynik zapisu", () => {
  it("SUKCES melduje sie toastem i zamyka dialog przez `onCreated`", async () => {
    const { onCreated } = renderDialog();
    fireEvent.change(pole("adminCoupons.name"), { target: { value: "Kampania OK" } });
    fireEvent.click(zapisz());
    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
    expect(h.toastSuccess).toHaveBeenCalledWith("adminCoupons.campaignCreatedDraft");
  });

  it("ODMOWA bazy pokazuje komunikat i NIE zamyka dialogu", async () => {
    db().setResponse("b2b_coupon_campaigns", fail("permission denied", "42501"));
    zaplanowanaOdmowa = true;
    const { onCreated } = renderDialog();
    fireEvent.change(pole("adminCoupons.name"), { target: { value: "Kampania odrzucona" } });
    fireEvent.click(zapisz());
    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("permission denied"));
    expect(onCreated).not.toHaveBeenCalled();
    expect(pole("adminCoupons.name")).toHaveValue("Kampania odrzucona");
  });

  it("po ODMOWIE przycisk zapisu WRACA do stanu klikalnego", async () => {
    db().setResponse("b2b_coupon_campaigns", fail("nie udalo sie zapisac", "XX000"));
    zaplanowanaOdmowa = true;
    renderDialog();
    fireEvent.change(pole("adminCoupons.name"), { target: { value: "Kampania" } });
    fireEvent.click(zapisz());
    await waitFor(() => expect(h.toastError).toHaveBeenCalled());
    expect(zapisz()).not.toBeDisabled();
  });

  it("kampania powstaje jako SZKIC - status ustawia baza, nie formularz", async () => {
    // Formularz swiadomie NIE wysyla `status`: kampania ma sie zaczac od
    // szkicu (domyslka kolumny), zeby zadne pole formularza nie moglo jej
    // od razu oznaczyc jako wygenerowanej albo wyslanej.
    renderDialog();
    fireEvent.change(pole("adminCoupons.name"), { target: { value: "Nowa" } });
    fireEvent.click(zapisz());
    await waitFor(() => expect(insertPayload()).toBeDefined());
    expect(Object.keys(insertPayload())).not.toContain("status");
    expect(Object.keys(insertPayload())).not.toContain("generated_count");
  });
});
