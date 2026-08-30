// Atomy bramki: WYNIK SKANU i STAN ŁĄCZNOŚCI.
//
// To są dwa napisy, na które operator patrzy najczęściej - z metra, przez
// ramię, w słońcu. Panele mają własne pliki testowe; ten plik dowodzi rzeczy,
// których z poziomu panelu nie widać:
// 1. WYNIK JEST OGŁASZANY, nie tylko narysowany (`role="status"` +
//    `aria-live="assertive"`) - operator z czytnikiem nie patrzy w ekran
//    w chwili piknięcia.
// 2. KOLOR NIE JEST JEDYNYM NOŚNIKIEM. Obok koloru stoi ikona i słowo, bo
//    bramkę obsługują też osoby nierozróżniające barw.
// 3. NAJGORSZA WIADOMOŚĆ JEST NA WIERZCHU. Brak sieci przykrywa licznik
//    kolejki: jeśli nie ma zasięgu, liczba czekających skanów tylko rośnie,
//    a decyzja („nie odłączaj urządzenia") jest ta sama.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { axeViolations, summarize } from "@/test/axe";

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());

const { ScanOutcomeBanner } = await import("@/components/events/scanner/atoms/ScanOutcomeBanner");
const { ScannerStatusPill } = await import("@/components/events/scanner/atoms/ScannerStatusPill");

beforeEach(() => {
  cleanup();
});

describe("ScanOutcomeBanner - wynik skanu", () => {
  it("wynik jest OGŁASZANY natychmiast, nie tylko narysowany", () => {
    render(<ScanOutcomeBanner tone="granted" title="Wpuść" />);

    const banner = screen.getByRole("status");
    expect(banner).toHaveAttribute("aria-live", "assertive");
    expect(banner).toHaveTextContent("Wpuść");
  });

  it("każdy ton niesie słowo i ikonę, a nie sam kolor", () => {
    // Gdyby o wyniku decydował wyłącznie kolor pasa, bramka przestałaby
    // działać dla osoby nierozróżniającej barw - a to jest praca zmianowa,
    // obsadzana wolontariuszami z przypadku.
    for (const tone of ["granted", "denied", "warning", "neutral"] as const) {
      cleanup();
      const { container } = render(<ScanOutcomeBanner tone={tone} title={`wynik-${tone}`} />);

      expect(screen.getByText(`wynik-${tone}`)).toBeInTheDocument();
      const icon = container.querySelector("svg");
      expect(icon).not.toBeNull();
      expect(icon).toHaveAttribute("aria-hidden", "true");
    }
  });

  it("wpuszczenie i odmowa NIE wyglądają tak samo", () => {
    const granted = render(<ScanOutcomeBanner tone="granted" title="Wpuść" />);
    const grantedClass = granted.getByRole("status").className;
    cleanup();
    const denied = render(<ScanOutcomeBanner tone="denied" title="Brak zapisu" />);

    expect(denied.getByRole("status").className).not.toBe(grantedClass);
  });

  it("podpowiedź pojawia się tylko wtedy, gdy naprawdę coś mówi", () => {
    // `hint` bywa `null` (wynik bez powodu), `undefined` (brak propsa) i pustym
    // napisem (klucz i18n bez treści). Pusty akapit pod wielkim napisem
    // wygląda jak ucięty komunikat.
    const { rerender } = render(<ScanOutcomeBanner tone="warning" title="Powtórka" hint="hej" />);
    expect(screen.getByText("hej")).toBeInTheDocument();

    rerender(<ScanOutcomeBanner tone="warning" title="Powtórka" hint={null} />);
    expect(screen.getByRole("status").textContent).toBe("Powtórka");

    rerender(<ScanOutcomeBanner tone="warning" title="Powtórka" hint="" />);
    expect(screen.getByRole("status").textContent).toBe("Powtórka");

    rerender(<ScanOutcomeBanner tone="warning" title="Powtórka" />);
    expect(screen.getByRole("status").textContent).toBe("Powtórka");
  });

  it("pas wyniku nie ma naruszeń axe", async () => {
    const { container } = render(
      <ScanOutcomeBanner tone="denied" title="Brak zapisu" hint="Skieruj do recepcji." />,
    );

    expect(await axeViolations(container).then(summarize)).toBe("");
  });
});

describe("ScannerStatusPill - stan łączności i kolejki", () => {
  it("z siecią i pustą kolejką mówi po prostu, że jest zasięg", () => {
    render(<ScannerStatusPill online={true} pending={0} syncing={false} />);

    expect(screen.getByText("eventScanner.session.online")).toBeInTheDocument();
  });

  it("czekające skany są LICZBĄ, a nie kropką", () => {
    // Od tej liczby zależy jedna decyzja: czy wolno odłączyć urządzenie
    // na koniec zmiany. „Coś czeka" tej decyzji nie podejmuje.
    render(<ScannerStatusPill online={true} pending={3} syncing={false} />);

    expect(screen.getByText("eventScanner.outbox.pending(count=3)")).toBeInTheDocument();
  });

  it("BRAK SIECI przykrywa licznik kolejki - najgorsza wiadomość na wierzchu", () => {
    render(<ScannerStatusPill online={false} pending={7} syncing={false} />);

    expect(screen.getByText("eventScanner.session.offline")).toBeInTheDocument();
    expect(screen.queryByText(/eventScanner\.outbox\.pending/)).toBeNull();
  });

  it("wysyłka w toku jest widoczna jako ruch, a nie jako zmiana liczby", () => {
    // Liczba przy opróżnianiu kolejki zmienia się skokami; kręcąca się ikona
    // mówi „to się dzieje" w chwili, w której liczba jeszcze stoi.
    const still = render(<ScannerStatusPill online={true} pending={2} syncing={false} />);
    expect(still.container.querySelector(".animate-spin")).toBeNull();
    cleanup();

    const syncing = render(<ScannerStatusPill online={true} pending={2} syncing={true} />);
    expect(syncing.container.querySelector(".animate-spin")).not.toBeNull();
  });

  it("plakietka stanu nie ma naruszeń axe", async () => {
    const { container } = render(<ScannerStatusPill online={false} pending={2} syncing={true} />);

    expect(await axeViolations(container).then(summarize)).toBe("");
  });
});
