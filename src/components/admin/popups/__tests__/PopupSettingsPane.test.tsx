// Ustawienia wyświetlania popupu buildera - kiedy, komu i gdzie popup się pokaże.
//
// PO CO. Te pokrętła decydują o tym, ile razy odwiedzający zobaczy modal na
// środku ekranu. Pomyłka nie wywala aplikacji, tylko zmienia doświadczenie
// KAŻDEGO odwiedzającego, a operator zobaczy skutek dopiero na produkcji:
//   * wyzwalacz „natychmiast" zamiast „po przewinięciu" to modal na powitanie;
//   * częstotliwość 0 dni to popup na KAŻDEJ odsłonie, także po zamknięciu;
//   * zdjęcie przycisku zamknięcia RAZEM z zamykaniem kliknięciem tła to
//     pułapka bez wyjścia na urządzeniu dotykowym;
//   * ścieżki wpisuje się po jednej na linię - błąd w rozbiciu tekstu znaczy
//     targetowanie, którego nikt nie ustawił.
//
// Formularz jest w pełni kontrolowany i oddaje PEŁNĄ kopię ustawień przy każdej
// zmianie, więc każdy test sprawdza też, że pozostałe pola przetrwały.
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { render } from "@testing-library/react";

import i18n from "@/lib/i18n";
import { PopupSettingsPane } from "@/components/admin/popups/PopupSettingsPane";
import { defaultPopupSettings, type PopupSettings } from "@/lib/builder/popups";

const S = (key: string) => i18n.t(`admin.popups.settings.${key}`);

const onChange = vi.fn<(next: PopupSettings) => void>();

function mount(overrides: Partial<PopupSettings> = {}) {
  const value = { ...defaultPopupSettings(), ...overrides };
  const utils = render(<PopupSettingsPane value={value} onChange={onChange} />);
  return { ...utils, value };
}

/** Ostatnie ustawienia, jakie formularz oddał rodzicowi. */
function next(): PopupSettings {
  return onChange.mock.calls.at(-1)![0];
}

/** Pole pod daną etykietą. */
function under(label: string, tag: "input" | "textarea" = "input"): HTMLElement {
  const field = screen.getByText(label).parentElement!.querySelector(tag);
  expect(field, `brak pola „${label}”`).toBeTruthy();
  return field as HTMLElement;
}

/** Lista wyboru pod daną etykietą. */
function selectUnder(label: string): HTMLElement {
  const trigger = screen.getByText(label).parentElement!.querySelector('[role="combobox"]');
  expect(trigger, `brak listy „${label}”`).toBeTruthy();
  return trigger as HTMLElement;
}

beforeAll(async () => {
  await i18n.changeLanguage("pl");
});

beforeEach(() => {
  onChange.mockReset();
});

afterEach(() => {
  cleanup();
});

// ---------------------------------------------------------------------------
describe("wyzwalacz", () => {
  it("pola wyzwalacza są widoczne TYLKO dla swojego wyzwalacza", () => {
    // Aktywne pole opóźnienia przy wyzwalaczu „exit-intent" uczy operatora
    // ustawiać coś, co nie ma żadnego skutku.
    mount({ trigger: "immediate" });
    expect(screen.queryByText(S("delaySeconds"))).toBeNull();
    expect(screen.queryByText(S("scrollPercent"))).toBeNull();
    cleanup();

    mount({ trigger: "delay" });
    expect(screen.getByText(S("delaySeconds"))).toBeTruthy();
    expect(screen.queryByText(S("scrollPercent"))).toBeNull();
  });

  it("wyzwalacz po przewinięciu odsłania próg procentowy", () => {
    mount({ trigger: "scroll" });

    expect(screen.getByText(S("scrollPercent"))).toBeTruthy();
    expect(screen.queryByText(S("delaySeconds"))).toBeNull();
  });

  it("zmiana wyzwalacza oddaje PEŁNE ustawienia", () => {
    mount({ trigger: "immediate", frequencyDays: 7 });

    fireEvent.keyDown(selectUnder(S("trigger")), { key: "Enter" });
    fireEvent.click(screen.getByRole("option", { name: S("triggerScroll") }));

    expect(next().trigger).toBe("scroll");
    expect(next().frequencyDays).toBe(7);
  });

  it("opóźnienie NIGDY nie jest ujemne - popup z minus sekundą nie ma sensu", () => {
    mount({ trigger: "delay", delaySeconds: 5 });

    fireEvent.change(under(S("delaySeconds")), { target: { value: "-10" } });

    expect(next().delaySeconds).toBe(0);
  });

  it("wyczyszczone opóźnienie schodzi na zero, nie na NaN", () => {
    mount({ trigger: "delay", delaySeconds: 5 });

    fireEvent.change(under(S("delaySeconds")), { target: { value: "" } });

    expect(next().delaySeconds).toBe(0);
    expect(Number.isNaN(next().delaySeconds)).toBe(false);
  });

  it("próg przewinięcia trzyma się zakresu 1-100", () => {
    mount({ trigger: "scroll", scrollPercent: 50 });
    const field = under(S("scrollPercent"));

    fireEvent.change(field, { target: { value: "500" } });
    expect(next().scrollPercent).toBe(100);

    fireEvent.change(field, { target: { value: "0" } });
    expect(next().scrollPercent).toBe(1);
  });
});

// ---------------------------------------------------------------------------
describe("częstotliwość", () => {
  it("wartość leci do ustawień razem z podpowiedzią na ekranie", () => {
    mount({ frequencyDays: 7 });

    fireEvent.change(under(S("frequencyDays")), { target: { value: "30" } });

    expect(next().frequencyDays).toBe(30);
    expect(screen.getByText(S("frequencyHint"))).toBeTruthy();
  });

  it("ZERO jest dozwolone - to jawne „pokazuj zawsze”", () => {
    // Zero nie jest błędem: to świadome ustawienie, więc nie wolno go „naprawiać".
    mount({ frequencyDays: 7 });

    fireEvent.change(under(S("frequencyDays")), { target: { value: "0" } });

    expect(next().frequencyDays).toBe(0);
  });

  it("wartość ujemna schodzi na zero", () => {
    mount({ frequencyDays: 7 });

    fireEvent.change(under(S("frequencyDays")), { target: { value: "-3" } });

    expect(next().frequencyDays).toBe(0);
  });
});

// ---------------------------------------------------------------------------
describe("targetowanie", () => {
  it("zmiana odbiorców oddaje pełne ustawienia", () => {
    mount({ audience: "any" });

    fireEvent.keyDown(selectUnder(S("audience")), { key: "Enter" });
    fireEvent.click(screen.getByRole("option", { name: S("audienceGuest") }));

    expect(next().audience).toBe("guest");
    expect(next().devices).toEqual(defaultPopupSettings().devices);
  });

  it("każde urządzenie ma WŁASNY przełącznik", () => {
    mount();

    expect(screen.getByText(S("deviceDesktop"))).toBeTruthy();
    expect(screen.getByText(S("deviceTablet"))).toBeTruthy();
    expect(screen.getByText(S("deviceMobile"))).toBeTruthy();
  });

  it("zdjęcie jednego urządzenia ZOSTAWIA pozostałe", () => {
    // Nadpisanie całego obiektu urządzeń wyłączyłoby popup wszędzie.
    mount({ devices: { desktop: true, tablet: true, mobile: true } });

    fireEvent.click(screen.getAllByRole("switch")[0]!);

    expect(next().devices).toEqual({ desktop: false, tablet: true, mobile: true });
  });

  it("ścieżki są rozbijane po LINIACH i przycinane", () => {
    mount();

    fireEvent.change(under(S("includePaths"), "textarea"), {
      target: { value: "  /  \n/post/*\n\n  /pricing  \n" },
    });

    expect(next().includePaths).toEqual(["/", "/post/*", "/pricing"]);
  });

  it("puste linie NIE tworzą pustych wzorców - pusty wzorzec pasuje do wszystkiego", () => {
    mount();

    fireEvent.change(under(S("includePaths"), "textarea"), { target: { value: "\n\n   \n" } });

    expect(next().includePaths).toEqual([]);
  });

  it("ścieżki wykluczone są osobną listą", () => {
    mount({ includePaths: ["/"], excludePaths: [] });

    fireEvent.change(under(S("excludePaths"), "textarea"), {
      target: { value: "/checkout/*" },
    });

    expect(next().excludePaths).toEqual(["/checkout/*"]);
    expect(next().includePaths).toEqual(["/"]);
  });

  it("istniejące ścieżki są pokazane po jednej na linię", () => {
    mount({ includePaths: ["/", "/post/*"] });

    expect((under(S("includePaths"), "textarea") as HTMLTextAreaElement).value).toBe("/\n/post/*");
  });
});

// ---------------------------------------------------------------------------
describe("wygląd", () => {
  it("szerokość i pozycja są do wyboru i oddają pełne ustawienia", () => {
    mount({ width: "md", position: "center" });

    fireEvent.keyDown(selectUnder(S("width")), { key: "Enter" });
    fireEvent.click(screen.getByRole("option", { name: S("widthXl") }));

    expect(next().width).toBe("xl");
    expect(next().position).toBe("center");
  });

  it("pozycja też jest do wyboru", () => {
    mount({ position: "center" });

    fireEvent.keyDown(selectUnder(S("position")), { key: "Enter" });
    fireEvent.click(screen.getByRole("option", { name: S("positionBottom") }));

    expect(next().position).toBe("bottom");
  });

  it("kolor przysłony jest DOWOLNYM napisem - to może być rgba albo token", () => {
    mount();

    fireEvent.change(under(S("overlayColor")), { target: { value: "rgba(1,2,3,0.4)" } });

    expect(next().overlayColor).toBe("rgba(1,2,3,0.4)");
  });

  it("zaokrąglenie nie jest ujemne i nie jest NaN", () => {
    mount({ borderRadiusPx: 12 });
    const field = under(S("borderRadius"));

    fireEvent.change(field, { target: { value: "-4" } });
    expect(next().borderRadiusPx).toBe(0);

    fireEvent.change(field, { target: { value: "" } });
    expect(next().borderRadiusPx).toBe(0);
  });

  it("przycisk zamknięcia i zamykanie tłem są NIEZALEŻNYMI przełącznikami", () => {
    // Zdjęcie obu naraz to pułapka bez wyjścia na urządzeniu dotykowym - popup
    // renderujący sam dopina wtedy przycisk, ale ustawienia muszą dać się
    // rozdzielić.
    mount({ showCloseButton: true, closeOnOverlay: true });
    const switches = screen.getAllByRole("switch");

    fireEvent.click(switches.at(-2)!);

    expect(next().showCloseButton).toBe(false);
    expect(next().closeOnOverlay).toBe(true);
  });

  it("zamykanie kliknięciem tła przełącza się osobno", () => {
    mount({ showCloseButton: true, closeOnOverlay: true });

    fireEvent.click(screen.getAllByRole("switch").at(-1)!);

    expect(next().closeOnOverlay).toBe(false);
    expect(next().showCloseButton).toBe(true);
  });
});

// ---------------------------------------------------------------------------
describe("kontrakt formularza", () => {
  it("KAŻDA zmiana oddaje komplet pól, nie sam patch", () => {
    // Rodzic zapisuje to, co dostanie - częściowy obiekt wyzerowałby resztę.
    const klucze = Object.keys(defaultPopupSettings()).sort();
    mount();

    fireEvent.change(under(S("overlayColor")), { target: { value: "rgba(0,0,0,0.2)" } });

    expect(Object.keys(next()).sort()).toEqual(klucze);
  });

  it("formularz nie zapisuje niczego, dopóki operator nic nie ruszy", () => {
    mount();

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByText(S("triggerSection"))).toBeTruthy();
  });

  it("etykiety idą za językiem interfejsu", async () => {
    await i18n.changeLanguage("en");
    try {
      mount();

      expect(screen.getByText(i18n.t("admin.popups.settings.triggerSection"))).toBeTruthy();
      expect(screen.getByText(i18n.t("admin.popups.settings.appearanceSection"))).toBeTruthy();
    } finally {
      await i18n.changeLanguage("pl");
    }
  });
});
