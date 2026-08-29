// Molekuła „szablon identyfikatora" - FORMAT PAPIERU, WYMIARY I KOD QR.
//
// CO TEN PLIK DOWODZI.
//   1. DROPLISTA FORMATÓW JEST ODWZOROWANIEM CHECK-A, NIE PROPOZYCJĄ. Panel
//      oferował kiedyś `cr80`, którego ograniczenie
//      `event_badge_templates_paper_format_values` NIE ZNA - wybór tego formatu
//      kończył się odmową bazy przy zapisie, a cztery formaty, które baza
//      przyjmuje, były z panelu niedostępne. Ten test pilnuje ZBIORU wartości
//      widocznych dla redaktora, nie tylko tego, że droplista istnieje.
//   2. FORMAT WŁASNY WYMAGA OBU WYMIARÓW. `a6` ma rozmiar w migracji, więc puste
//      pola mają tam sens; przy `custom` puste pole znaczy „nie wiadomo, co
//      wydrukować" i baza odmawia (`custom_dimensions_required`).
//   3. TRYB TWORZENIA I TRYB EDYCJI TO DWA RÓŻNE ŻĄDANIA: nowy szablon niesie
//      `eventId`, edytowany niesie `id` i NIE niesie `eventId`. Pomyłka tutaj
//      zakłada drugi szablon zamiast poprawić pierwszy.
//   4. OTWARCIE DLA INNEGO WIERSZA NIE NIESIE POPRZEDNIEGO. Formularz z cudzą
//      nazwą i cudzymi wymiarami wygląda jak wypełniony celowo.
//   5. NIEPEŁNY FORMULARZ NIE WOŁA WARSTWY ZAPISU - asercja na atrapie
//      `onSubmit`, nie na wyglądzie przycisku.
//   6. BŁĘDY POKAZUJĄ SIĘ DOPIERO PO PIERWSZEJ PRÓBIE ZAPISU. Czerwone pole
//      w pustym formularzu, którego nikt jeszcze nie dotknął, uczy je ignorować.
//   7. PUSTE POLE NIEOBOWIĄZKOWE JEDZIE JAKO `null`, a białe znaki są obcięte.
//   8. OKNO NIE ZAMYKA SIĘ SAMO - decyzję podejmuje panel po odpowiedzi bazy,
//      więc odmowa zostawia pracę redaktora na ekranie.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. (1) Reguł wersji roboczej (zakresy wymiarów,
// wzór koloru, wzór adresu, konwersja tekst -> liczba) - tabele przypadków są
// w `lib/events/onsiteDraft.test.ts`; tutaj dowodzimy, że okno ich UŻYWA i co
// pokazuje. (2) Zgodności listy formatów z bazą co do znaku - to bramka
// `lib/events/__tests__/dbEnumParity.test.ts`; tutaj chodzi o to, że okno
// pokazuje CAŁĄ tę listę i nic ponad nią. (3) Zapisu RPC - molekuła dostaje
// `onSubmit` w propsie i nie zna warstwy zapisu.
//
// Radix Dialog i Radix Select nie działają pod happy-dom bez pełnego pointer
// API - oba są podmienione na natywne odpowiedniki.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { BADGE_PAPER_FORMATS, type BadgeTemplateInput } from "@/lib/events/onsiteApi";
import type { BadgeTemplateRow } from "@/lib/events/onsiteApi";

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
// Klient bazy nie jest przedmiotem dowodu, a jego moduł domaga się konfiguracji
// środowiska przy imporcie - okno bierze z `onsiteApi` wyłącznie SŁOWNIKI.
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

vi.mock("@/components/ui/dialog", () => {
  const stan = { open: false };
  return {
    Dialog: ({ open, children }: { open: boolean; children?: ReactNode }) => {
      stan.open = open;
      return <div data-testid="dialog-root">{children}</div>;
    },
    DialogContent: ({ children }: { children?: ReactNode }) =>
      stan.open ? <div role="dialog">{children}</div> : null,
    DialogHeader: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    DialogFooter: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    DialogTitle: ({ children }: { children?: ReactNode }) => <h2>{children}</h2>,
    DialogDescription: ({ children }: { children?: ReactNode }) => <p>{children}</p>,
  };
});

// Radix Select nie renderuje opcji bez pointer API - droplista jest natywnym
// `<select>`, którego wartość jedzie tą samą drogą.
vi.mock("@/components/atoms/FormSelect", () => ({
  FormSelect: ({
    id,
    value,
    options,
    onValueChange,
    disabled,
    "aria-label": ariaLabel,
  }: {
    id?: string;
    value: string;
    options: readonly { value: string; label: ReactNode }[];
    onValueChange: (next: string) => void;
    disabled?: boolean;
    "aria-label"?: string;
  }) => (
    <select
      id={id}
      aria-label={ariaLabel}
      value={value}
      disabled={disabled}
      onChange={(event) => onValueChange(event.target.value)}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {String(option.label)}
        </option>
      ))}
    </select>
  ),
}));

const { BadgeTemplateDialog } =
  await import("@/components/admin/events/molecules/BadgeTemplateDialog");

const WYDARZENIE = "3f0f6c11-2222-4333-8444-555566667777";
const BLAD = "adminEventOnsite.errors.";
const D = "adminEventOnsite.badges.dialog.";

// Wiersz szablonu tak, jak oddaje go RPC listy. `width_mm`, `height_mm`
// i `last_printed_at` są w bazie NULLOWALNE (format nazwany nie ma wymiarów,
// nigdy niedrukowany szablon nie ma daty) - wygenerowany typ pokazuje je jako
// wymagane, bo kodogenerator nie zna nullowalności kolumn wyniku funkcji.
// Wersja robocza czyta je przez `typeof === "number"`, więc atrapa musi
// odwzorować STAN FAKTYCZNY, inaczej testuje przypadek, który nie istnieje.
const BAZOWY_WIERSZ: Record<string, unknown> = {
  id: "tpl-1",
  event_id: WYDARZENIE,
  name: "Identyfikator gościa",
  paper_format: "a6",
  orientation: "portrait",
  width_mm: null,
  height_mm: null,
  show_qr: true,
  qr_size_mm: 30,
  double_fold: false,
  background_color: null,
  background_image_url: null,
  is_default: false,
  elements: [],
  version: 1,
  created_at: "2026-08-01T10:00:00Z",
  updated_at: "2026-08-01T10:00:00Z",
  last_printed_at: null,
  prints_count: 0,
  printed_people_count: 0,
  stale_prints_count: 0,
};

function szablon(overrides: Partial<BadgeTemplateRow> = {}): BadgeTemplateRow {
  return { ...BAZOWY_WIERSZ, ...overrides } as BadgeTemplateRow;
}

function renderuj(props: { open?: boolean; template?: BadgeTemplateRow | null } = {}) {
  const onOpenChange = vi.fn();
  const onSubmit = vi.fn<(input: BadgeTemplateInput) => void>();
  const stan = {
    open: props.open ?? true,
    template: props.template ?? null,
    isSaving: false,
  };
  const rysuj = () =>
    render(
      <BadgeTemplateDialog
        open={stan.open}
        onOpenChange={onOpenChange}
        eventId={WYDARZENIE}
        template={stan.template}
        isSaving={stan.isSaving}
        onSubmit={onSubmit}
      />,
    );
  const wynik = rysuj();
  const przerysuj = (zmiana: Partial<typeof stan>) => {
    Object.assign(stan, zmiana);
    wynik.rerender(
      <BadgeTemplateDialog
        open={stan.open}
        onOpenChange={onOpenChange}
        eventId={WYDARZENIE}
        template={stan.template}
        isSaving={stan.isSaving}
        onSubmit={onSubmit}
      />,
    );
  };
  return { ...wynik, onOpenChange, onSubmit, przerysuj };
}

const nazwa = () => screen.getByLabelText(`${D}name`);
const format = () => screen.getByLabelText(`${D}paperFormat`);
const orientacja = () => screen.getByLabelText(`${D}orientation`);
const szerokosc = () => screen.getByLabelText(`${D}widthMm`);
const wysokosc = () => screen.getByLabelText(`${D}heightMm`);
const bokQr = () => screen.getByLabelText(`${D}qrSizeMm`);
const kolorTla = () => screen.getByLabelText(`${D}backgroundColor`);
const adresTla = () => screen.getByLabelText(`${D}backgroundImageUrl`);
const przelacznikQr = () => screen.getByRole("switch", { name: `${D}showQr` });
const zapisz = () => screen.getByRole("button", { name: "adminEventOnsite.actions.save" });
const anuluj = () => screen.getByRole("button", { name: "adminEventOnsite.actions.cancel" });

/** Formularz w stanie gotowym do zapisu - brakuje tylko nazwy szablonu. */
function wypelnijNazwe(tekst = "Identyfikator gościa") {
  fireEvent.change(nazwa(), { target: { value: tekst } });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("BadgeTemplateDialog - otwarcie, tryb i pozostałość", () => {
  it("okno ZAMKNIĘTE nie renderuje formularza", () => {
    renderuj({ open: false });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByText(`${D}createTitle`)).not.toBeInTheDocument();
  });

  it("TRYB TWORZENIA: tytuł zakładania, puste wymiary i domyślny kod QR", () => {
    renderuj();
    expect(screen.getByRole("heading", { name: `${D}createTitle` })).toBeInTheDocument();
    expect(nazwa()).toHaveValue("");
    expect(format()).toHaveValue("a6");
    expect(orientacja()).toHaveValue("portrait");
    expect(szerokosc()).toHaveValue("");
    expect(wysokosc()).toHaveValue("");
    expect(przelacznikQr()).toBeChecked();
    expect(bokQr()).toHaveValue("30");
  });

  it("TRYB EDYCJI: tytuł poprawiania i wartości z wiersza", () => {
    renderuj({
      template: szablon({
        name: "Karta VIP",
        paper_format: "custom",
        orientation: "landscape",
        width_mm: 90,
        height_mm: 54,
        show_qr: false,
        double_fold: true,
        background_color: "#112233",
        background_image_url: "/badges/tlo.png",
        is_default: true,
      }),
    });
    expect(screen.getByRole("heading", { name: `${D}editTitle` })).toBeInTheDocument();
    expect(nazwa()).toHaveValue("Karta VIP");
    expect(format()).toHaveValue("custom");
    expect(orientacja()).toHaveValue("landscape");
    expect(szerokosc()).toHaveValue("90");
    expect(wysokosc()).toHaveValue("54");
    expect(przelacznikQr()).not.toBeChecked();
    expect(kolorTla()).toHaveValue("#112233");
    expect(adresTla()).toHaveValue("/badges/tlo.png");
    expect(screen.getByRole("switch", { name: `${D}isDefault` })).toBeChecked();
    expect(screen.getByRole("switch", { name: `${D}doubleFold` })).toBeChecked();
  });

  it("OTWARCIE DLA INNEGO WIERSZA nie niesie wartości poprzedniego", () => {
    // Regresja, którą to łapie: poprawka szablonu B startuje z nazwą, formatem
    // i wymiarami szablonu A - i zapisuje je pod identyfikatorem B.
    const { przerysuj } = renderuj({
      template: szablon({ name: "Karta VIP", paper_format: "custom", width_mm: 90, height_mm: 54 }),
    });
    fireEvent.change(nazwa(), { target: { value: "Ręczna zmiana" } });

    przerysuj({ open: false });
    przerysuj({
      open: true,
      template: szablon({ id: "tpl-2", name: "Wolontariusz", paper_format: "a7" }),
    });

    expect(nazwa()).toHaveValue("Wolontariusz");
    expect(format()).toHaveValue("a7");
    expect(szerokosc()).toHaveValue("");
  });

  it("przejście z EDYCJI do ZAKŁADANIA czyści formularz do wartości domyślnych", () => {
    const { przerysuj } = renderuj({
      template: szablon({ name: "Karta VIP", paper_format: "custom", width_mm: 90 }),
    });
    przerysuj({ open: false });
    przerysuj({ open: true, template: null });

    expect(screen.getByRole("heading", { name: `${D}createTitle` })).toBeInTheDocument();
    expect(nazwa()).toHaveValue("");
    expect(format()).toHaveValue("a6");
  });

  it("ZMIANA WIERSZA PRZY ZAMKNIĘTYM OKNIE nie przestawia formularza z powrotem", () => {
    // Efekt wychodzi wcześnie, gdy okno jest zamknięte. Bez tego wyjścia każde
    // przewinięcie listy pod zamkniętym oknem kasowałoby pracę redaktora
    // w chwili, w której okno znów się otworzy z tym samym wierszem.
    const { przerysuj } = renderuj({ open: false, template: szablon({ name: "Karta VIP" }) });
    przerysuj({ open: true });
    fireEvent.change(nazwa(), { target: { value: "Karta VIP 2026" } });

    przerysuj({ open: false });
    przerysuj({ template: szablon({ name: "Karta VIP" }) });
    przerysuj({ open: true });

    expect(nazwa()).toHaveValue("Karta VIP");
  });
});

describe("BadgeTemplateDialog - format papieru", () => {
  it("droplista oferuje DOKŁADNIE formaty przyjmowane przez bazę - i nic poza nimi", () => {
    // `cr80` był w tej dropliście i kończył się odmową ograniczenia CHECK przy
    // zapisie; cztery formaty, które baza przyjmuje, były niedostępne.
    renderuj();
    const wartosci = Array.from(format().querySelectorAll("option")).map(
      (option) => (option as HTMLOptionElement).value,
    );
    expect(wartosci).toEqual([...BADGE_PAPER_FORMATS]);
    expect(wartosci).not.toContain("cr80");
    expect(wartosci).toHaveLength(7);
  });

  it("orientacja ma dwie wartości - pionową i poziomą", () => {
    renderuj();
    const wartosci = Array.from(orientacja().querySelectorAll("option")).map(
      (option) => (option as HTMLOptionElement).value,
    );
    expect(wartosci).toEqual(["portrait", "landscape"]);
  });

  it("FORMAT WŁASNY BEZ WYMIARÓW nie da się zapisać - i mówi to przy obu polach", () => {
    const { onSubmit } = renderuj();
    wypelnijNazwe();
    fireEvent.change(format(), { target: { value: "custom" } });
    fireEvent.click(zapisz());

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getAllByText(`${BLAD}customDimensionsRequired`)).toHaveLength(2);
  });

  it("format własny z SAMĄ SZEROKOŚCIĄ nadal nie przechodzi - brakuje wysokości", () => {
    const { onSubmit } = renderuj();
    wypelnijNazwe();
    fireEvent.change(format(), { target: { value: "custom" } });
    fireEvent.change(szerokosc(), { target: { value: "90" } });
    fireEvent.click(zapisz());

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getAllByText(`${BLAD}customDimensionsRequired`)).toHaveLength(1);
    expect(wysokosc()).toHaveAttribute("aria-invalid", "true");
  });

  it("format własny z OBOMA wymiarami przechodzi i niesie je w ładunku", () => {
    const { onSubmit } = renderuj();
    wypelnijNazwe();
    fireEvent.change(format(), { target: { value: "custom" } });
    fireEvent.change(szerokosc(), { target: { value: "90" } });
    fireEvent.change(wysokosc(), { target: { value: "54" } });
    fireEvent.click(zapisz());

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      paperFormat: "custom",
      widthMm: 90,
      heightMm: 54,
    });
  });

  it("wymiar spoza zakresu 20-420 mm nie przechodzi", () => {
    const { onSubmit } = renderuj();
    wypelnijNazwe();
    fireEvent.change(format(), { target: { value: "custom" } });
    fireEvent.change(szerokosc(), { target: { value: "10" } });
    fireEvent.change(wysokosc(), { target: { value: "54" } });
    fireEvent.click(zapisz());

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText(`${BLAD}invalidDimensions`)).toBeInTheDocument();
  });

  it("format nazwany BEZ wymiarów zapisuje się, a wymiary jadą jako null", () => {
    // Rozmiar `a6` jest w migracji - puste pola znaczą tu „weź rozmiar
    // formatu", a nie „zapomniałem".
    const { onSubmit } = renderuj();
    wypelnijNazwe();
    fireEvent.click(zapisz());

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      paperFormat: "a6",
      widthMm: null,
      heightMm: null,
    });
  });
});

describe("BadgeTemplateDialog - kod QR", () => {
  it("wyłączony kod QR CHOWA pole boku", () => {
    renderuj();
    expect(bokQr()).toBeInTheDocument();
    fireEvent.click(przelacznikQr());
    expect(screen.queryByLabelText(`${D}qrSizeMm`)).not.toBeInTheDocument();
  });

  it("bok kodu spoza zakresu 10-100 mm blokuje zapis, gdy kod jest WŁĄCZONY", () => {
    const { onSubmit } = renderuj();
    wypelnijNazwe();
    fireEvent.change(bokQr(), { target: { value: "5" } });
    fireEvent.click(zapisz());

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText(`${BLAD}invalidQrSize`)).toBeInTheDocument();
  });

  it("pusty bok kodu przy WŁĄCZONYM kodzie też blokuje - baza nie ma czego wydrukować", () => {
    const { onSubmit } = renderuj();
    wypelnijNazwe();
    fireEvent.change(bokQr(), { target: { value: "" } });
    fireEvent.click(zapisz());

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText(`${BLAD}invalidQrSize`)).toBeInTheDocument();
  });

  it("REGRESJA: wyłączenie kodu QR nie przepuszcza boku spoza zakresu do żądania", () => {
    // `validateBadgeTemplateDraft` sprawdza bok kodu TYLKO przy włączonym
    // kodzie, a `badgeTemplateDraftToInput` wysyłał go ZAWSZE, choć RPC
    // `admin_event_badge_template_save` ma warunek bezwarunkowy
    // (`IF v_qr_size NOT BETWEEN 10 AND 100 THEN RAISE invalid_qr_size`).
    // Zanim to naprawiono, redaktor, który wpisał `5`, zobaczył błąd i wyłączył
    // kod QR, dostawał odmowę bazy przy polu, którego NIE MA NA EKRANIE - i nie
    // miał jak jej naprawić bez ponownego włączenia kodu.
    const { onSubmit } = renderuj();
    wypelnijNazwe();
    fireEvent.change(bokQr(), { target: { value: "5" } });
    fireEvent.click(przelacznikQr());
    fireEvent.click(zapisz());

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const qr = onSubmit.mock.calls[0][0].qrSizeMm ?? 0;
    expect(qr).toBeGreaterThanOrEqual(10);
  });
});

describe("BadgeTemplateDialog - walidacja pozostałych pól", () => {
  it("nazwa krótsza niż dwa znaki nie wysyła żądania", () => {
    const { onSubmit } = renderuj();
    fireEvent.change(nazwa(), { target: { value: "A" } });
    fireEvent.click(zapisz());

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText(`${BLAD}invalidName`)).toBeInTheDocument();
  });

  it("nazwa z samych spacji też nie wysyła - obcięcie liczy się PRZED długością", () => {
    const { onSubmit } = renderuj();
    fireEvent.change(nazwa(), { target: { value: "     " } });
    fireEvent.click(zapisz());
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("BŁĘDY NIE POKAZUJĄ SIĘ przed pierwszą próbą zapisu", () => {
    // Czerwony pusty formularz przy otwarciu uczy redaktora ignorować kolor,
    // więc nie zauważy go tam, gdzie naprawdę coś jest nie tak.
    renderuj();
    expect(screen.queryByText(`${BLAD}invalidName`)).not.toBeInTheDocument();
    expect(nazwa()).not.toHaveAttribute("aria-invalid");

    fireEvent.click(zapisz());
    expect(screen.getByText(`${BLAD}invalidName`)).toBeInTheDocument();
    expect(nazwa()).toHaveAttribute("aria-invalid", "true");
  });

  it("kolor tła w innej postaci niż #rrggbb nie przechodzi", () => {
    const { onSubmit } = renderuj();
    wypelnijNazwe();
    fireEvent.change(kolorTla(), { target: { value: "czerwony" } });
    fireEvent.click(zapisz());

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText(`${BLAD}invalidBackgroundColor`)).toBeInTheDocument();
  });

  it("adres tła bez https i bez wiodącego ukośnika nie przechodzi", () => {
    const { onSubmit } = renderuj();
    wypelnijNazwe();
    fireEvent.change(adresTla(), { target: { value: "http://example.test/tlo.png" } });
    fireEvent.click(zapisz());

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText(`${BLAD}invalidBackgroundUrl`)).toBeInTheDocument();
  });

  it("ścieżka wewnętrzna jest poprawnym adresem tła", () => {
    const { onSubmit } = renderuj();
    wypelnijNazwe();
    fireEvent.change(adresTla(), { target: { value: "/storage/tlo.png" } });
    fireEvent.click(zapisz());

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0].backgroundImageUrl).toBe("/storage/tlo.png");
  });
});

describe("BadgeTemplateDialog - ładunek zapisu", () => {
  it("NOWY szablon niesie identyfikator wydarzenia, a puste pola jadą jako null", () => {
    const { onSubmit } = renderuj();
    fireEvent.change(nazwa(), { target: { value: "  Identyfikator gościa  " } });
    fireEvent.click(zapisz());

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0]).toEqual({
      id: undefined,
      eventId: WYDARZENIE,
      name: "Identyfikator gościa",
      paperFormat: "a6",
      orientation: "portrait",
      widthMm: null,
      heightMm: null,
      showQr: true,
      qrSizeMm: 30,
      doubleFold: false,
      backgroundColor: null,
      backgroundImageUrl: null,
      isDefault: false,
    });
  });

  it("EDYTOWANY szablon niesie własny identyfikator i NIE niesie wydarzenia", () => {
    // Wysłanie `eventId` przy poprawce jest w tym RPC żądaniem założenia
    // drugiego szablonu - lista rośnie zamiast się poprawiać.
    const { onSubmit } = renderuj({ template: szablon({ id: "tpl-77", name: "Karta VIP" }) });
    fireEvent.change(nazwa(), { target: { value: "Karta VIP 2026" } });
    fireEvent.click(zapisz());

    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      id: "tpl-77",
      eventId: undefined,
      name: "Karta VIP 2026",
    });
  });

  it("wszystkie decyzje z formularza dochodzą do ładunku", () => {
    const { onSubmit } = renderuj();
    wypelnijNazwe("Karta prasowa");
    fireEvent.change(format(), { target: { value: "badge_100x150" } });
    fireEvent.change(orientacja(), { target: { value: "landscape" } });
    fireEvent.change(bokQr(), { target: { value: "40" } });
    fireEvent.change(kolorTla(), { target: { value: "  #aabbcc  " } });
    fireEvent.click(screen.getByRole("switch", { name: `${D}doubleFold` }));
    fireEvent.click(screen.getByRole("switch", { name: `${D}isDefault` }));
    fireEvent.click(zapisz());

    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      name: "Karta prasowa",
      paperFormat: "badge_100x150",
      orientation: "landscape",
      qrSizeMm: 40,
      backgroundColor: "#aabbcc",
      doubleFold: true,
      isDefault: true,
    });
  });
});

describe("BadgeTemplateDialog - zapis w locie i wyjście", () => {
  it("trwający zapis odcina OBA przyciski i nie przepuszcza drugiego żądania", () => {
    const { onSubmit, onOpenChange, przerysuj } = renderuj();
    wypelnijNazwe();
    fireEvent.click(zapisz());
    expect(onSubmit).toHaveBeenCalledTimes(1);

    przerysuj({ isSaving: true });
    fireEvent.click(zapisz());
    fireEvent.click(anuluj());

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("okno NIE zamyka się samo po wysłaniu - odmowa zostawia pracę na ekranie", () => {
    // Molekuła nie zna wyniku zapisu; zamknięcie należy do panelu. Gdyby
    // zamykała się sama, odmowa bazy kasowałaby wypełniony formularz.
    const { onOpenChange } = renderuj();
    wypelnijNazwe("Karta prasowa");
    fireEvent.change(kolorTla(), { target: { value: "#aabbcc" } });
    fireEvent.click(zapisz());

    expect(onOpenChange).not.toHaveBeenCalled();
    expect(nazwa()).toHaveValue("Karta prasowa");
    expect(kolorTla()).toHaveValue("#aabbcc");
  });

  it("anulowanie zamyka okno BEZ żądania zapisu", () => {
    const { onOpenChange, onSubmit } = renderuj();
    wypelnijNazwe();
    fireEvent.click(anuluj());

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
