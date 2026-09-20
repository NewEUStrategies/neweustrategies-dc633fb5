// IKONA CHROME NIE MA PRAWA DOCIĄGNĄĆ PEŁNEGO REJESTRU.
//
// DLACZEGO TEN TEST WYGLĄDA INACZEJ NIŻ `DynamicIcon.test.tsx`. Tamten
// podmienia pełny rejestr na znacznik i pokazuje, że znacznik się POJAWIŁ.
// Tutaj dowodzimy czegoś, czego nie widać na ekranie: że modułu pełnego
// rejestru NIKT NIE ZAŻĄDAŁ. Dlatego atrapa LICZY swoje wywołania - jedno
// żądanie modułu to jedno pobranie chunka w przeglądarce.
//
// Licznik ma własną KONTROLĘ POZYTYWNĄ na końcu pliku: ostatni test dowodzi,
// że przy domyślnym `allowFull` licznik ROŚNIE. Bez niej „zero żądań" mogłoby
// znaczyć po prostu „przyrząd nie działa" - a to jest tryb awarii, w którym
// test jest zielony zawsze i niczego nie pilnuje. (Wariant z atrapą rzucającą
// wyjątek sprawdzono i ODRZUCONO: React łapie błąd leniwego modułu w granicy
// Suspense, więc test przechodził MIMO pobrania chunka.)
//
// STAWKA. Nazwy ikon menu przychodzą z konfiguracji w bazie (`site_settings`,
// `menu_items`), którą wypełnia człowiek w panelu. Przy zachowaniu domyślnym
// jedna literówka - albo jedna nazwa, której zestaw nie pokrywa - każe
// przeglądarce KAŻDEGO ANONIMA pobrać `lucideIconNodes.generated`
// (473 KB źródeł, 109 KB gzip) na ścieżce renderu nagłówka. `MenuIcon` zamienia
// ten koszt na neutralne kółko i ostrzeżenie w konsoli dewelopera.
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

/** Licznik żądań modułu pełnego rejestru - dzielony z atrapą (hoisted). */
const rejestr = vi.hoisted(() => ({ zazadany: 0 }));

vi.mock("../DynamicIconFull", () => {
  rejestr.zazadany += 1;
  return {
    default: ({ iconKey }: { iconKey: string }) => <span data-testid="pelny">{iconKey}</span>,
  };
});

import { DynamicIcon, MenuIcon } from "../DynamicIcon";

const svg = () => document.querySelector("svg");

afterEach(() => {
  vi.restoreAllMocks();
});

describe("MenuIcon - nazwa spoza zestawu", () => {
  it("renderuje ikonę zastępczą i NIE żąda modułu pełnego rejestru", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const przed = rejestr.zazadany;
    const { container } = render(<MenuIcon name="alarm-clock-check" />);
    // Dwa niezależne dowody, bo każdy zawodzi w innych warunkach: licznik
    // pokazuje ŻĄDANIE modułu (ale tylko przy pierwszym żądaniu w tym pliku),
    // a brak rezerwującego `<span>` Suspense'a pokazuje, że render nie poszedł
    // ścieżką leniwą W OGÓLE - niezależnie od kolejności testów.
    expect(svg()).toBeTruthy();
    expect(container.querySelector('span[aria-hidden="true"]')).toBeNull();
    expect(screen.queryByTestId("pelny")).toBeNull();
    expect(rejestr.zazadany).toBe(przed);
  });

  it("zastępnik zajmuje miejsce ikony, więc wiersz menu się nie przesuwa", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const przed = rejestr.zazadany;
    const { container } = render(<MenuIcon name="pencil-ruler" size={14} />);
    const rendered = container.querySelector("svg");
    expect(rendered?.getAttribute("width")).toBe("14");
    expect(rendered?.getAttribute("height")).toBe("14");
    expect(rejestr.zazadany).toBe(przed);
  });

  it("ostrzega w trybie deweloperskim RAZ na nazwę, a nie na render", () => {
    // Menu renderuje się przy każdym żądaniu; ostrzeżenie bez pamięci zalałoby
    // log workera tą samą linijką i przestałoby cokolwiek znaczyć.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    render(<MenuIcon name="waves-ladder" />);
    render(<MenuIcon name="waves-ladder" />);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain("waves-ladder");
  });
});

describe("MenuIcon - nazwy, które zestaw pokrywa", () => {
  it("renderuje ikonę kuratorowaną normalnie i bez ostrzeżenia", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    render(<MenuIcon name="graduation-cap" />);
    expect(svg()).toBeTruthy();
    expect(warn).not.toHaveBeenCalled();
  });

  it("dla pustej nazwy zachowuje się jak dotąd - rysuje zastępnik, nie pustkę", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    render(<MenuIcon name="" />);
    expect(svg()).toBeTruthy();
    expect(warn).not.toHaveBeenCalled();
  });

  it("przekazuje właściwości dalej", () => {
    render(<MenuIcon name="search" className="h-4 w-4" aria-label="szukaj" />);
    expect(screen.getByLabelText("szukaj")).toBeTruthy();
  });
});

describe("DynamicIcon bez `allowFull` - zachowanie dotychczasowych wywołań", () => {
  it("dla nazwy nieznanej NADAL dociąga pełny rejestr (kontrola pozytywna licznika)", async () => {
    // Ten test pilnuje DWÓCH rzeczy naraz: że treść i panel nie straciły
    // dostępu do pełnego rejestru (zmiana miała dotknąć wyłącznie chrome)
    // oraz że licznik użyty wyżej naprawdę reaguje na pobranie modułu.
    const przed = rejestr.zazadany;
    render(<DynamicIcon name="alarm-clock-check" />);
    expect(await screen.findByTestId("pelny")).toHaveTextContent("AlarmClockCheck");
    expect(rejestr.zazadany).toBeGreaterThan(przed);
  });
});
