// Atom „Wybór biletu" na publicznym formularzu zapisu - karty biletów jako
// natywne radio, pole kodu dostępu i odsłanianie biletów ukrytych.
//
// CO TEN PLIK DOWODZI.
//   1. KARTA MÓWI JĘZYKIEM WIDZA: nazwa, opis i korzyści po polsku albo po
//      angielsku, a bilet bez nazwy w danym języku mówi kluczem, nie pustką.
//   2. CENA MÓWI PRAWDĘ O TYM, CO ZAPŁACISZ TERAZ: „bezpłatny" przy zerze,
//      kwota w walucie biletu, przekreślona cena bazowa WYŁĄCZNIE przy realnej
//      obniżce, własna etykieta organizatora zamiast kwoty, a wyłączona
//      etykieta - brak ceny.
//   3. PRÓG CENOWY MÓWI, DO KIEDY: własna nazwa progu z terminem, „wczesna
//      rejestracja" dla progu bez nazwy, a próg standardowy bez nazwy - nic.
//      Terminy liczą się z zamrożonego zegara.
//   4. OGRANICZENIA SĄ PODPISANE, a bilet niedostępny zostaje widoczny, ale nie
//      da się go wybrać: dostępność, liczba miejsc, akceptacja organizatora,
//      kod dostępu (z podpowiedzią albo bez), blokada poziomu członkostwa.
//   5. BILET UKRYTY WIDAĆ TYLKO Z LINKU (`?ticket=klucz`) albo PO KODZIE.
//      Pole kodu pojawia się wyłącznie, gdy jest co odsłaniać; kod idzie do
//      bazy znormalizowany, zostaje zapamiętany dla kasy, a wynik jest
//      ogłoszony zdaniem. Kod z linku (`?code=`) działa bez klikania.
//      Bilet z linku, który kod też odsłania, nie pojawia się dwa razy.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. Reguł wyboru (`isTicketSelectable`,
// `visibleTickets`, `customPriceLabel`) - mają je testy
// `lib/events/registrationFormSurface`; tutaj jadą PRAWDZIWE. Drogi wybranego
// biletu do `event_register` - ma ją `PublicRegistrationFormBehaviour.test.tsx`.
//
// ATRAPUJEMY WYŁĄCZNIE GRANICĘ: `supabase.rpc` (odsłanianie kodem). Pamięć kodu
// (`sessionStorage`) jest prawdziwa i czytamy ją tym, czym czyta ją kasa.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";

import type { RegistrationFormTicket } from "@/lib/events/registrationFormSurface";
import { recallEventCode } from "@/lib/events/eventCodeMemory";
import { supabaseRpcStub, type SupabaseRpcStub } from "@/test/supabase/rpc";
import { DZIEN, freezeClock, relativeIso } from "@/test/time";

const h = vi.hoisted(() => ({
  lang: "pl" as "pl" | "en",
  rpc: null as SupabaseRpcStub | null,
  onChange: vi.fn<(ticketId: string) => void>(),
}));

vi.mock("react-i18next", async () =>
  (await import("@/test/i18nStub")).reactI18nextStub(() => h.lang),
);

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (name: string, args?: Record<string, unknown>) => {
      if (h.rpc === null) throw new Error("test: atrapa RPC nie zostala ustawiona");
      return h.rpc.rpc(name, args);
    },
  },
}));

import { RegistrationTicketPicker } from "@/components/events/registration/RegistrationTicketPicker";

// Termin progu cenowego formatuje się z daty - liczymy go od `FIXED_NOW`
// (15.06.2099, południe UTC).
freezeClock();

const L = "eventRegistration.labels";
const P = "eventRegistration.payment";
const REVEAL_RPC = "event_coupon_revealed_tickets";
const EVENT_ID = "11111111-1111-1111-1111-111111111111";

function bilet(patch: Partial<RegistrationFormTicket> = {}): RegistrationFormTicket {
  return {
    id: "t-standard",
    key: "standard",
    namePl: "Bilet standardowy",
    nameEn: "Standard pass",
    descriptionPl: "",
    descriptionEn: "",
    priceCents: 0,
    effectivePriceCents: 0,
    phase: null,
    benefitsPl: [],
    benefitsEn: [],
    currency: "PLN",
    requiresApproval: false,
    minTierRank: 0,
    salesFrom: null,
    salesTo: null,
    seatsLeft: 10,
    availability: "on_sale",
    tierLocked: false,
    requiresAccessCode: false,
    accessCodeHint: "",
    ...patch,
  };
}

const UKRYTY = bilet({
  id: "t-vip",
  key: "vip",
  namePl: "Bilet VIP",
  nameEn: "VIP pass",
  isHidden: true,
});

function wybor({
  tickets = [bilet()],
  value = null,
  invalid = false,
  eventId,
}: {
  tickets?: RegistrationFormTicket[];
  value?: string | null;
  invalid?: boolean;
  eventId?: string;
} = {}) {
  return render(
    <RegistrationTicketPicker
      tickets={tickets}
      value={value}
      lang={h.lang}
      invalid={invalid}
      eventId={eventId}
      onChange={h.onChange}
    />,
  );
}

/** Karta biletu (etykieta radia) po nazwie widocznej dla uczestnika. */
function karta(name: string): HTMLElement {
  const radio = screen.getByRole("radio", { name: new RegExp(name) });
  const found = radio.closest("label");
  if (found === null) throw new Error(`brak karty biletu ${name}`);
  return found;
}

function naAdresie(search: string): void {
  window.history.replaceState(null, "", `/events/kongres/register${search}`);
}

const poleKodu = (): HTMLElement => screen.getByPlaceholderText(`${P}.promoPlaceholder`);

beforeEach(() => {
  h.lang = "pl";
  h.rpc = supabaseRpcStub();
  h.rpc.setData(REVEAL_RPC, ["t-vip"]);
  h.onChange.mockReset();
  window.sessionStorage.clear();
  naAdresie("");
});

afterEach(() => {
  naAdresie("");
});

describe("karta biletu w języku widza", () => {
  const pelny = bilet({
    descriptionPl: "Wstęp na wszystkie panele",
    descriptionEn: "Entry to all panels",
    benefitsPl: ["Obiad", "Materiały konferencyjne"],
    benefitsEn: ["Lunch"],
  });

  it("po polsku: nazwa, opis i korzyści z polskich pól", () => {
    wybor({ tickets: [pelny] });

    const k = within(karta("Bilet standardowy"));
    expect(k.getByText("Wstęp na wszystkie panele")).toBeInTheDocument();
    expect(k.getByText(`${L}.benefitsTitle`)).toBeInTheDocument();
    expect(k.getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "Obiad",
      "Materiały konferencyjne",
    ]);
    expect(screen.queryByText("Lunch")).not.toBeInTheDocument();
  });

  it("po angielsku: nazwa, opis i korzyści z angielskich pól", () => {
    h.lang = "en";
    wybor({ tickets: [pelny] });

    const k = within(karta("Standard pass"));
    expect(k.getByText("Entry to all panels")).toBeInTheDocument();
    expect(k.getAllByRole("listitem").map((li) => li.textContent)).toEqual(["Lunch"]);
    expect(screen.queryByText("Bilet standardowy")).not.toBeInTheDocument();
  });

  it("bilet bez nazwy w języku widza mówi swoim kluczem", () => {
    h.lang = "en";
    wybor({ tickets: [bilet({ nameEn: "" })] });

    expect(screen.getByRole("radio", { name: /standard/ })).toBeInTheDocument();
    expect(screen.queryByText("Bilet standardowy")).not.toBeInTheDocument();
  });

  it("bilet bez opisu i korzyści nie rysuje pustych bloków", () => {
    wybor();

    expect(screen.queryByText(`${L}.benefitsTitle`)).not.toBeInTheDocument();
    expect(within(karta("Bilet standardowy")).queryByRole("list")).not.toBeInTheDocument();
  });
});

describe("cena na karcie", () => {
  it("zero złotych to „bezpłatny”, a nie kwota zero", () => {
    wybor();

    expect(within(karta("Bilet standardowy")).getByText(`${L}.free`)).toBeInTheDocument();
  });

  it("płatny bilet pokazuje kwotę w walucie biletu i w formacie języka widza", () => {
    wybor({ tickets: [bilet({ priceCents: 15000, effectivePriceCents: 15000 })] });
    expect(within(karta("Bilet standardowy")).getByText(/150,00\s*zł/)).toBeInTheDocument();
    expect(screen.queryByText(`${L}.free`)).not.toBeInTheDocument();
  });

  it("po angielsku kwota ma angielski zapis", () => {
    h.lang = "en";
    wybor({ tickets: [bilet({ priceCents: 15000, effectivePriceCents: 15000 })] });

    expect(within(karta("Standard pass")).getByText(/150\.00/)).toBeInTheDocument();
  });

  it("realna obniżka pokazuje przekreśloną cenę bazową obok obowiązującej", () => {
    wybor({ tickets: [bilet({ priceCents: 20000, effectivePriceCents: 15000 })] });

    const k = within(karta("Bilet standardowy"));
    expect(k.getByText(/150,00\s*zł/)).toBeInTheDocument();
    expect(k.getByText(/200,00\s*zł/).className).toContain("line-through");
  });

  it("ta sama cena nie udaje promocji - bez przekreślenia", () => {
    wybor({ tickets: [bilet({ priceCents: 15000, effectivePriceCents: 15000 })] });

    expect(within(karta("Bilet standardowy")).getAllByText(/150,00\s*zł/)).toHaveLength(1);
  });

  it.each<["pl" | "en", string, string]>([
    ["pl", "Bilet standardowy", "Od 150 zł za osobę"],
    ["en", "Standard pass", "From 150 PLN per person"],
  ])("własna etykieta organizatora (%s) zastępuje kwotę", (lang, nazwa, etykieta) => {
    h.lang = lang;
    wybor({
      tickets: [
        bilet({
          priceCents: 15000,
          effectivePriceCents: 15000,
          priceLabelPl: "Od 150 zł za osobę",
          priceLabelEn: "From 150 PLN per person",
        }),
      ],
    });

    const k = within(karta(nazwa));
    expect(k.getByText(etykieta)).toBeInTheDocument();
    expect(k.queryByText(/150[,.]00/)).not.toBeInTheDocument();
  });

  it("wyłączona etykieta ceny nie pokazuje ani kwoty, ani „bezpłatny”", () => {
    wybor({
      tickets: [
        bilet({ showPriceLabel: false }),
        bilet({
          id: "t-paid",
          key: "paid",
          namePl: "Bilet płatny",
          priceCents: 15000,
          effectivePriceCents: 15000,
          showPriceLabel: false,
        }),
      ],
    });

    expect(screen.queryByText(`${L}.free`)).not.toBeInTheDocument();
    expect(screen.queryByText(/150,00/)).not.toBeInTheDocument();
  });
});

describe("próg cenowy", () => {
  it("nazwany próg z terminem mówi, do kiedy obowiązuje", () => {
    wybor({
      tickets: [
        bilet({
          phase: {
            source: "schedule",
            priceCents: 0,
            labelPl: "Wczesna rejestracja",
            labelEn: "Early registration",
            endsAt: relativeIso(5 * DZIEN),
          },
        }),
      ],
    });

    expect(
      within(karta("Bilet standardowy")).getByText(
        /^Wczesna rejestracja - eventRegistration\.labels\.phaseEndsAt\(date=20 czerwca 2099/,
      ),
    ).toBeInTheDocument();
  });

  it("po angielsku próg ma angielską nazwę i angielski termin", () => {
    h.lang = "en";
    wybor({
      tickets: [
        bilet({
          phase: {
            source: "schedule",
            priceCents: 0,
            labelPl: "Wczesna rejestracja",
            labelEn: "Early registration",
            endsAt: relativeIso(5 * DZIEN),
          },
        }),
      ],
    });

    expect(
      within(karta("Standard pass")).getByText(
        /^Early registration - eventRegistration\.labels\.phaseEndsAt\(date=20 June 2099/,
      ),
    ).toBeInTheDocument();
  });

  it("próg bez nazwy i bez terminu to „wczesna rejestracja” bez doklejonego myślnika", () => {
    wybor({
      tickets: [
        bilet({
          phase: { source: "early_bird", priceCents: 0, labelPl: "", labelEn: "", endsAt: null },
        }),
      ],
    });

    expect(within(karta("Bilet standardowy")).getByText(`${L}.phaseEarlyBird`).textContent).toBe(
      `${L}.phaseEarlyBird`,
    );
  });

  it("próg standardowy bez nazwy nie rysuje żadnej plakietki, nawet z terminem", () => {
    wybor({
      tickets: [
        bilet({
          phase: {
            source: "standard",
            priceCents: 0,
            labelPl: "",
            labelEn: "",
            endsAt: relativeIso(5 * DZIEN),
          },
        }),
      ],
    });

    expect(screen.queryByText(new RegExp(`${L}.phaseEndsAt`))).not.toBeInTheDocument();
    expect(screen.queryByText(`${L}.phaseEarlyBird`)).not.toBeInTheDocument();
  });
});

describe("ograniczenia biletu", () => {
  it("zwykły bilet mówi dostępność i liczbę wolnych miejsc - nic więcej", () => {
    wybor({ tickets: [bilet({ seatsLeft: 3 })] });

    const k = within(karta("Bilet standardowy"));
    expect(k.getByText("eventRegistration.availability.on_sale")).toBeInTheDocument();
    expect(k.getByText(`${L}.seatsLeft(count=3)`)).toBeInTheDocument();
    expect(k.queryByText(`${L}.requiresApproval`)).not.toBeInTheDocument();
    expect(k.queryByText(`${L}.accessCodeRequired`)).not.toBeInTheDocument();
    expect(k.queryByText(`${L}.tierLocked`)).not.toBeInTheDocument();
  });

  it("bilet bez limitu miejsc mówi „bez limitu”, a nie liczbę", () => {
    wybor({ tickets: [bilet({ seatsLeft: null })] });

    expect(screen.getByText(`${L}.seatsUnlimited`)).toBeInTheDocument();
  });

  it("akceptacja organizatora i kod dostępu bez podpowiedzi mają własne podpisy", () => {
    wybor({ tickets: [bilet({ requiresApproval: true, requiresAccessCode: true })] });

    const k = within(karta("Bilet standardowy"));
    expect(k.getByText(`${L}.requiresApproval`)).toBeInTheDocument();
    expect(k.getByText(`${L}.accessCodeRequired`)).toBeInTheDocument();
  });

  it("podpowiedź organizatora do kodu zastępuje ogólne zdanie", () => {
    wybor({
      tickets: [bilet({ requiresAccessCode: true, accessCodeHint: "Kod jest w zaproszeniu" })],
    });

    expect(screen.getByText("Kod jest w zaproszeniu")).toBeInTheDocument();
    expect(screen.queryByText(`${L}.accessCodeRequired`)).not.toBeInTheDocument();
  });

  it("blokada poziomu członkostwa jest podpisana, a biletu nie da się wybrać", () => {
    wybor({ tickets: [bilet({ tierLocked: true })] });

    expect(screen.getByText(`${L}.tierLocked`)).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /Bilet standardowy/ })).toBeDisabled();
  });

  it("wyprzedany bilet zostaje widoczny, ale nie da się go wybrać", () => {
    wybor({ tickets: [bilet({ availability: "sold_out" })] });

    expect(screen.getByText("eventRegistration.availability.sold_out")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /Bilet standardowy/ })).toBeDisabled();
    expect(karta("Bilet standardowy").className).toContain("cursor-not-allowed");
  });
});

describe("wybór biletu", () => {
  const dwa = [bilet(), bilet({ id: "t-student", key: "student", namePl: "Bilet studencki" })];

  it("kliknięcie karty oddaje identyfikator biletu", () => {
    wybor({ tickets: dwa });

    fireEvent.click(screen.getByRole("radio", { name: /Bilet studencki/ }));
    expect(h.onChange).toHaveBeenCalledWith("t-student");
  });

  it("wybrany bilet jest zaznaczony, pozostałe nie", () => {
    wybor({ tickets: dwa, value: "t-student" });

    expect(screen.getByRole("radio", { name: /Bilet studencki/ })).toBeChecked();
    expect(screen.getByRole("radio", { name: /Bilet standardowy/ })).not.toBeChecked();
  });

  it("błąd wyboru oznacza całą grupę, a brak błędu nie zostawia atrybutu", () => {
    const { unmount } = wybor({ tickets: dwa, invalid: true });
    expect(screen.getByRole("radiogroup")).toHaveAttribute("aria-invalid", "true");
    unmount();

    wybor({ tickets: dwa });
    expect(screen.getByRole("radiogroup")).not.toHaveAttribute("aria-invalid");
  });
});

describe("bilety ukryte i kod dostępu", () => {
  it("ukrytego biletu nie widać bez linku, a bez wydarzenia nie ma pola kodu", () => {
    wybor({ tickets: [bilet(), UKRYTY] });

    expect(screen.queryByRole("radio", { name: /Bilet VIP/ })).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText(`${P}.promoPlaceholder`)).not.toBeInTheDocument();
  });

  it("bez ukrytych biletów pole kodu się nie pojawia - nie ma czego odsłaniać", () => {
    wybor({ tickets: [bilet()], eventId: EVENT_ID });

    expect(screen.queryByPlaceholderText(`${P}.promoPlaceholder`)).not.toBeInTheDocument();
  });

  it("link z kluczem biletu (?ticket=) pokazuje bilet ukryty", () => {
    naAdresie("?ticket=vip");
    wybor({ tickets: [bilet(), UKRYTY] });

    expect(screen.getByRole("radio", { name: /Bilet VIP/ })).toBeInTheDocument();
  });

  it("kod wpisany ręcznie idzie do bazy wielkimi literami, odsłania bilet i zostaje dla kasy", async () => {
    wybor({ tickets: [bilet(), UKRYTY], eventId: EVENT_ID });

    fireEvent.change(poleKodu(), { target: { value: "vip10" } });
    expect(poleKodu()).toHaveValue("VIP10");
    fireEvent.click(screen.getByRole("button", { name: `${P}.revealApply` }));

    expect(await screen.findByRole("status")).toHaveTextContent(`${P}.revealFound(count=1)`);
    expect(screen.getByRole("radio", { name: /Bilet VIP/ })).toBeInTheDocument();
    const call = h.rpc?.lastCall(REVEAL_RPC);
    expect(call?.arg("p_event_id")).toBe(EVENT_ID);
    expect(call?.arg("p_code")).toBe("VIP10");
    expect(recallEventCode(EVENT_ID)).toBe("VIP10");
  });

  it("kod, który niczego nie odsłania, mówi to zdaniem, a bilet zostaje ukryty", async () => {
    h.rpc?.setData(REVEAL_RPC, []);
    wybor({ tickets: [bilet(), UKRYTY], eventId: EVENT_ID });

    fireEvent.change(poleKodu(), { target: { value: "zly" } });
    fireEvent.click(screen.getByRole("button", { name: `${P}.revealApply` }));

    expect(await screen.findByRole("status")).toHaveTextContent(`${P}.revealNone`);
    expect(screen.queryByRole("radio", { name: /Bilet VIP/ })).not.toBeInTheDocument();
  });

  it("pusty kod nie odpytuje bazy i niczego nie ogłasza", () => {
    wybor({ tickets: [bilet(), UKRYTY], eventId: EVENT_ID });

    fireEvent.change(poleKodu(), { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: `${P}.revealApply` }));

    expect(h.rpc?.callsFor(REVEAL_RPC)).toHaveLength(0);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(recallEventCode(EVENT_ID)).toBe("");
  });

  it("kod z linku (?code=) wypełnia pole i odsłania bilet bez klikania", async () => {
    naAdresie("?code=vip10");
    wybor({ tickets: [bilet(), UKRYTY], eventId: EVENT_ID });

    expect(await screen.findByRole("radio", { name: /Bilet VIP/ })).toBeInTheDocument();
    expect(poleKodu()).toHaveValue("VIP10");
    expect(h.rpc?.lastCall(REVEAL_RPC)?.arg("p_code")).toBe("VIP10");
  });

  it("kod z linku bez znanego wydarzenia niczego nie odpytuje", () => {
    naAdresie("?code=vip10");
    wybor({ tickets: [bilet(), UKRYTY] });

    expect(h.rpc?.callsFor(REVEAL_RPC)).toHaveLength(0);
    expect(screen.queryByRole("radio", { name: /Bilet VIP/ })).not.toBeInTheDocument();
  });

  it("bilet z linku, który kod też odsłania, nie pojawia się dwa razy", async () => {
    naAdresie("?ticket=vip&code=vip10");
    wybor({ tickets: [bilet(), UKRYTY], eventId: EVENT_ID });

    expect(await screen.findByRole("status")).toHaveTextContent(`${P}.revealFound(count=1)`);
    expect(screen.getAllByRole("radio", { name: /Bilet VIP/ })).toHaveLength(1);
  });
});
