// Molekuły bramki: KARTA OSOBY, WEJŚCIE KODU i KOLEJKA SKANÓW.
//
// Panele mają własne pliki testowe, ale przechodzą przez te molekuły jedną
// ścieżką i nie dotykają ich brzegów. Ten plik dowodzi tego, co widać dopiero
// z bliska:
// 1. KARTA OSOBY POKAZUJE TYLE, ILE TRZEBA DO DECYZJI - i nie zostawia
//    wiszących separatorów, gdy baza odda pole puste. „CTO · " wygląda jak
//    ucięte dane i każe operatorowi szukać reszty.
// 2. KOLOR GRUPY JEST OBRAMOWANIEM, NIE TŁEM. Grupy bywają pomalowane
//    wartościami spoza palety serwisu; jako tło zjadają kontrast tekstu.
// 3. POLE KODU CZYŚCI SIĘ SAMO. Bez tego drugi skan doklei się do pierwszego
//    i powstanie kod, którego nie ma na żadnym bilecie.
// 4. KOLEJKA LICZY OSOBNO TO, CO CZEKA, I TO, CO WYMAGA UWAGI. Pozycja po
//    ośmiu nieudanych próbach nie jest już ponawiana; udawanie, że „czeka",
//    byłoby kłamstwem wobec operatora kończącego zmianę.
//
// i18n jest zamockowane kluczami, z jednym wyjątkiem: powód porażki pozycji
// w kolejce powstaje POZA Reactem (`scannerErrorMessage` -> prawdziwa
// instancja i18next), więc tam asercja czyta zdanie dla człowieka.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

import type { ScanPerson } from "@/lib/events/scannerApi";
import type { OutboxItem } from "@/lib/events/scannerOutbox";
import type { BarcodeScanner } from "@/hooks/useBarcodeScanner";
import { axeViolations, summarize } from "@/test/axe";

const h = vi.hoisted(() => ({
  camera: {
    support: "unsupported",
    active: false,
    starting: false,
    error: null,
    torchAvailable: false,
    torchOn: false,
  } as Pick<
    BarcodeScanner,
    "support" | "active" | "starting" | "error" | "torchAvailable" | "torchOn"
  >,
  start: vi.fn(),
  stop: vi.fn(),
  toggleTorch: vi.fn(),
  /** Wywolanie zwrotne, ktore molekula podaje aparatowi - patrz atrapa nizej. */
  wykryty: null as ((code: string) => void) | null,
}));

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());

// Aparat nie istnieje w happy-dom - a i tak nie jest gwarancją: gwarancją są
// czytnik sprzętowy i klawiatura. Stan aparatu ustawia każdy test u siebie.
// Atrapa PRZECHWYTUJE `onCode`, bo to jedyna droga, ktora aparat ma do reszty
// aplikacji: bez tego kod odczytany z obrazu nie miałby jak dojsc do bramki,
// a test aparatu sprawdzalby wylacznie napisy na przyciskach.
vi.mock("@/hooks/useBarcodeScanner", () => ({
  useBarcodeScanner: (options: { onCode: (code: string) => void }) => {
    h.wykryty = options.onCode;
    return {
      ...h.camera,
      videoRef: { current: null },
      start: h.start,
      stop: h.stop,
      toggleTorch: h.toggleTorch,
    };
  },
}));

const { ScanPersonCard } = await import("@/components/events/scanner/molecules/ScanPersonCard");
const { ScannerCodeInput } = await import("@/components/events/scanner/molecules/ScannerCodeInput");
const { ScannerOutboxPanel } =
  await import("@/components/events/scanner/molecules/ScannerOutboxPanel");

function person(over: Partial<ScanPerson> = {}): ScanPerson {
  return {
    personId: "p1",
    firstName: "Anna",
    lastName: "Kowalska",
    company: "Acme Energy",
    jobTitle: "CTO",
    registrationId: "r1",
    registrationStatus: "confirmed",
    ticketNamePl: "Bilet dwudniowy",
    ticketNameEn: "Two-day pass",
    groupNamePl: "Prelegenci",
    groupNameEn: "Speakers",
    groupColor: null,
    badgePrinted: false,
    badgePrintedAt: null,
    badgePrintedVersion: null,
    ...over,
  };
}

function outboxItem(over: Partial<OutboxItem> = {}): OutboxItem {
  return {
    id: "o1",
    kind: "checkin",
    code: "TICKET-1",
    checkpointId: "c1",
    direction: "in",
    note: null,
    interestRating: null,
    deviceScannedAt: "2026-09-01T08:00:00.000Z",
    attempts: 1,
    nextAttemptAt: "2026-09-01T08:00:10.000Z",
    lastError: null,
    ...over,
  };
}

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  h.wykryty = null;
  h.camera = {
    support: "unsupported",
    active: false,
    starting: false,
    error: null,
    torchAvailable: false,
    torchOn: false,
  };
});

describe("ScanPersonCard - tyle, ile potrzeba do decyzji", () => {
  it("niesie nazwisko, stanowisko z firmą, bilet, grupę i stan identyfikatora", () => {
    render(<ScanPersonCard person={person()} timezone="Europe/Warsaw" />);

    expect(screen.getByText("Anna Kowalska")).toBeInTheDocument();
    expect(screen.getByText("CTO · Acme Energy")).toBeInTheDocument();
    expect(screen.getByText("eventScanner.person.ticket: Bilet dwudniowy")).toBeInTheDocument();
    expect(screen.getByText("eventScanner.person.group: Prelegenci")).toBeInTheDocument();
    expect(screen.getByText("confirmed")).toBeInTheDocument();
    expect(screen.getByText("eventScanner.person.badgeNotPrinted")).toBeInTheDocument();
  });

  it("osoba bez nazwy dostaje nazwę zastępczą, a nie pusty wiersz", () => {
    // Pusty nagłówek karty wygląda jak awaria odczytu i każe skanować drugi raz.
    render(
      <ScanPersonCard person={person({ firstName: null, lastName: "   " })} timezone={null} />,
    );

    expect(screen.getByText("eventScanner.person.unnamed")).toBeInTheDocument();
  });

  it("puste pola NIE zostawiają wiszącego separatora", () => {
    // `company_text` bywa puste, a stanowisko opcjonalne. „CTO · " wygląda jak
    // ucięte dane - operator szuka reszty zamiast wpuścić człowieka.
    render(<ScanPersonCard person={person({ company: "   " })} timezone={null} />);

    expect(screen.getByText("CTO")).toBeInTheDocument();
    expect(screen.queryByText(/·/)).toBeNull();
  });

  it("bez stanowiska i bez firmy nie ma pustego wiersza pod nazwiskiem", () => {
    const { container } = render(
      <ScanPersonCard person={person({ jobTitle: null, company: null })} timezone={null} />,
    );

    expect(container.textContent).not.toContain("·");
    expect(screen.getByText("Anna Kowalska")).toBeInTheDocument();
  });

  it("brak biletu i brak grupy to brak plakietek, a nie plakietki z dwukropkiem", () => {
    render(
      <ScanPersonCard
        person={person({
          ticketNamePl: null,
          ticketNameEn: null,
          groupNamePl: null,
          groupNameEn: null,
          registrationStatus: null,
        })}
        timezone={null}
      />,
    );

    expect(screen.queryByText(/eventScanner\.person\.ticket/)).toBeNull();
    expect(screen.queryByText(/eventScanner\.person\.group/)).toBeNull();
  });

  it("kolor grupy jest OBRAMOWANIEM, nie tłem", () => {
    // Kolory grup przychodzą z panelu organizatora i bywają spoza palety
    // serwisu. Użyte jako tło potrafią zjeść kontrast tekstu na karcie,
    // czyli dokładnie to, co operator ma przeczytać w dwie sekundy.
    const { container } = render(
      <ScanPersonCard person={person({ groupColor: "#ff0055" })} timezone={null} />,
    );

    const card = container.firstElementChild as HTMLElement;
    expect(card.style.borderLeftWidth).toBe("4px");
    expect(card.style.borderLeftColor).not.toBe("");
    expect(card.style.backgroundColor).toBe("");
  });

  it("data wydania identyfikatora pojawia się TYLKO przy wydanym identyfikatorze", () => {
    const { rerender } = render(
      <ScanPersonCard
        person={person({ badgePrinted: true, badgePrintedAt: "2026-09-01T08:00:00Z" })}
        timezone="Europe/Warsaw"
      />,
    );
    expect(screen.getByText(/eventScanner\.person\.badgePrintedAt\(when=.+\)/)).toBeInTheDocument();

    rerender(
      <ScanPersonCard
        person={person({ badgePrinted: false, badgePrintedAt: "2026-09-01T08:00:00Z" })}
        timezone="Europe/Warsaw"
      />,
    );
    expect(screen.queryByText(/eventScanner\.person\.badgePrintedAt/)).toBeNull();
  });

  it("karta osoby nie ma naruszeń axe", async () => {
    const { container } = render(
      <ScanPersonCard
        person={person({
          groupColor: "#123456",
          badgePrinted: true,
          badgePrintedAt: "2026-09-01T08:00:00Z",
        })}
        timezone="Europe/Warsaw"
      />,
    );

    expect(await axeViolations(container).then(summarize)).toBe("");
  });
});

describe("ScannerCodeInput - czytnik sprzętowy i klawiatura", () => {
  function mountInput(over: { busy?: boolean; disabled?: boolean } = {}) {
    const onCode = vi.fn();
    const view = render(
      <ScannerCodeInput onCode={onCode} busy={over.busy ?? false} disabled={over.disabled} />,
    );
    return { ...view, onCode };
  }

  function type(code: string): HTMLElement {
    const input = screen.getByLabelText("eventScanner.manual.label");
    fireEvent.change(input, { target: { value: code } });
    return input;
  }

  it("kod jedzie obcięty, a pole CZYŚCI SIĘ SAMO", () => {
    // Bez czyszczenia drugi skan doklei się do pierwszego i powstanie kod,
    // którego nie ma na żadnym bilecie - a operator zobaczy „nieznany kod".
    const { onCode } = mountInput();
    const input = type("  TICKET-1  ");

    fireEvent.submit(input.closest("form") as HTMLFormElement);

    expect(onCode).toHaveBeenCalledExactlyOnceWith("TICKET-1");
    expect(input).toHaveValue("");
  });

  it("puste pole nie wysyła nic - Enter z pustego czytnika to nie skan", () => {
    const { onCode } = mountInput();
    const input = type("   ");

    fireEvent.submit(input.closest("form") as HTMLFormElement);

    expect(onCode).not.toHaveBeenCalled();
  });

  it("skan W TOKU nie wypuszcza drugiego - czytnik potrafi wysłać Enter dwa razy", () => {
    const { onCode } = mountInput({ busy: true });
    const input = type("TICKET-2");

    fireEvent.submit(input.closest("form") as HTMLFormElement);

    expect(onCode).not.toHaveBeenCalled();
  });

  it("wyłączone wejście blokuje pole i nie wysyła kodu", () => {
    // Tryb identyfikatora bez sieci: rejestr wydruku nie ma kolejki offline,
    // więc pole ma być martwe, a nie „prawie działające".
    const { onCode } = mountInput({ disabled: true });
    const input = screen.getByLabelText("eventScanner.manual.label");

    expect(input).toBeDisabled();
    fireEvent.submit(input.closest("form") as HTMLFormElement);
    expect(onCode).not.toHaveBeenCalled();
  });

  it("brak obsługi aparatu mówi, co robić zamiast niego", () => {
    mountInput();

    expect(screen.getByText("eventScanner.camera.notSupported")).toBeInTheDocument();
  });

  it("odmowa zgody na aparat to inny komunikat niż brak obsługi", () => {
    // Dwie różne sytuacje i dwa różne wyjścia: zgodę da się zmienić
    // w ustawieniach strony, braku obsługi nie da się.
    h.camera = { ...h.camera, support: "supported", error: "permission_denied" };
    mountInput();

    expect(screen.getByText("eventScanner.camera.permissionDenied")).toBeInTheDocument();
  });

  it("działający aparat nie tłumaczy się z niczego", () => {
    h.camera = { ...h.camera, support: "supported", active: true };
    mountInput();

    expect(screen.queryByText(/eventScanner\.camera\.(notSupported|insecureContext)/)).toBeNull();
    expect(screen.getByRole("button", { name: /eventScanner.camera.stop/ })).toBeInTheDocument();
  });

  it("doświetlenie pokazuje się tylko wtedy, gdy aparat pracuje i je ma", () => {
    h.camera = { ...h.camera, support: "supported", active: true, torchAvailable: false };
    const first = mountInput();
    expect(screen.queryByRole("button", { name: /eventScanner.camera.torch/ })).toBeNull();
    first.unmount();

    h.camera = { ...h.camera, active: true, torchAvailable: true };
    mountInput();
    fireEvent.click(screen.getByRole("button", { name: /eventScanner.camera.torchOn/ }));
    expect(h.toggleTorch).toHaveBeenCalledTimes(1);
  });

  it("wejście kodu nie ma naruszeń axe", async () => {
    h.camera = { ...h.camera, support: "supported", active: true, torchAvailable: true };
    const { container } = mountInput();

    expect(await axeViolations(container).then(summarize)).toBe("");
  });

  /* ------------------------------------------------------------- aparat --- */

  /** Odczyt z obrazu - to samo, co robi `useBarcodeScanner` po dekodowaniu. */
  function aparatWykryl(code: string): void {
    if (h.wykryty === null) throw new Error("test: molekula nie podala `onCode` aparatowi");
    h.wykryty(code);
  }

  it("kod ODCZYTANY Z OBRAZU idzie tą samą drogą co kod z klawiatury", () => {
    h.camera = { ...h.camera, support: "supported", active: true };
    const { onCode } = mountInput();

    aparatWykryl("TICKET-Z-APARATU");

    expect(onCode).toHaveBeenCalledExactlyOnceWith("TICKET-Z-APARATU");
  });

  it("WYŁĄCZONE wejście ignoruje także kod z aparatu, nie tylko z klawiatury", () => {
    // Aparat pracuje dalej po zablokowaniu pola (tryb bez kolejki offline);
    // bez tej bramki odczyt z obrazu obchodziłby blokadę bocznymi drzwiami.
    h.camera = { ...h.camera, support: "supported", active: true };
    const { onCode } = mountInput({ disabled: true });

    aparatWykryl("TICKET-MIMO-BLOKADY");

    expect(onCode).not.toHaveBeenCalled();
  });

  it("przycisk aparatu WŁĄCZA go, gdy stoi, i GASI, gdy pracuje", () => {
    h.camera = { ...h.camera, support: "supported", active: false };
    const first = mountInput();
    fireEvent.click(screen.getByRole("button", { name: /eventScanner.camera.start/ }));
    expect(h.start).toHaveBeenCalledTimes(1);
    expect(h.stop).not.toHaveBeenCalled();
    first.unmount();

    h.camera = { ...h.camera, support: "supported", active: true };
    mountInput();
    fireEvent.click(screen.getByRole("button", { name: /eventScanner.camera.stop/ }));
    expect(h.stop).toHaveBeenCalledTimes(1);
  });

  it("APARAT W ROZRUCHU mówi o tym wprost i nie da się go kliknąć drugi raz", () => {
    // Dwa kliknięcia w rozruchu to dwa strumienie i zapalona dioda po wyjściu
    // z ekranu - dlatego przycisk gaśnie na czas startu.
    h.camera = { ...h.camera, support: "supported", starting: true };
    mountInput();

    const przycisk = screen.getByRole("button", { name: /eventScanner.camera.starting/ });
    expect(przycisk).toBeDisabled();
    fireEvent.click(przycisk);
    expect(h.start).not.toHaveBeenCalled();
  });

  it("SPRAWDZANIE możliwości też blokuje przycisk - nie wiadomo jeszcze, co uruchomić", () => {
    h.camera = { ...h.camera, support: "checking" };
    mountInput();

    expect(screen.getByRole("button", { name: /eventScanner.camera.start/ })).toBeDisabled();
  });

  it("wyłączone wejście gasi też przycisk aparatu", () => {
    h.camera = { ...h.camera, support: "supported" };
    mountInput({ disabled: true });

    expect(screen.getByRole("button", { name: /eventScanner.camera.start/ })).toBeDisabled();
  });

  it("ZAPALONE doświetlenie proponuje ZGASZENIE, a nie zapalenie drugi raz", () => {
    h.camera = {
      ...h.camera,
      support: "supported",
      active: true,
      torchAvailable: true,
      torchOn: true,
    };
    mountInput();

    expect(
      screen.getByRole("button", { name: /eventScanner.camera.torchOff/ }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /eventScanner.camera.torchOn/ })).toBeNull();
  });

  it("BRAK HTTPS to inny komunikat niż brak obsługi - jedno da się naprawić adresem", () => {
    // `insecure_context` znaczy „otwórz to po HTTPS"; `not_supported` znaczy
    // „ta przeglądarka tego nie umie". Zlanie ich w jedno zdanie kosztuje
    // koordynatora telefon do informatyka.
    h.camera = { ...h.camera, support: "insecure" };
    const first = mountInput();
    expect(screen.getByText("eventScanner.camera.insecureContext")).toBeInTheDocument();
    first.unmount();

    h.camera = { ...h.camera, support: "supported", error: "insecure_context" };
    mountInput();
    expect(screen.getByText("eventScanner.camera.insecureContext")).toBeInTheDocument();
  });

  it("AWARIA SPRZĘTU aparatu schodzi na to samo zdanie co brak obsługi", () => {
    // Dla operatora różnica jest żadna: aparat nie zadziała, zostaje czytnik
    // i klawiatura. Osobny komunikat byłby zdaniem bez następnego kroku.
    h.camera = { ...h.camera, support: "supported", error: "camera_unavailable" };
    mountInput();

    expect(screen.getByText("eventScanner.camera.notSupported")).toBeInTheDocument();
  });

  it("PRACUJĄCY aparat chowa komunikat, nawet gdy poprzednia próba się nie udała", () => {
    h.camera = { ...h.camera, support: "supported", active: true, error: "permission_denied" };
    mountInput();

    expect(screen.queryByText("eventScanner.camera.permissionDenied")).toBeNull();
  });
});

describe("ScannerOutboxPanel - kolejka musi być widoczna, żeby była uczciwa", () => {
  function mountPanel(over: Partial<Parameters<typeof ScannerOutboxPanel>[0]> = {}) {
    const onFlush = vi.fn();
    const onDiscard = vi.fn();
    const view = render(
      <ScannerOutboxPanel
        outbox={over.outbox ?? []}
        timezone={over.timezone ?? "Europe/Warsaw"}
        flushing={over.flushing ?? false}
        persistent={over.persistent ?? true}
        onFlush={over.onFlush ?? onFlush}
        onDiscard={over.onDiscard ?? onDiscard}
      />,
    );
    return { ...view, onFlush, onDiscard };
  }

  it("pusta kolejka mówi WPROST, że wszystko poszło, i nie da się jej wysłać", () => {
    mountPanel();

    expect(screen.getByText("eventScanner.outbox.empty")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /eventScanner.outbox.sync/ })).toBeDisabled();
  });

  it("licznik czekających NIE liczy pozycji, których nikt już nie ponawia", () => {
    // Osiem nieudanych prób to koniec ponawiania. Wliczanie takiej pozycji do
    // „czeka na wysłanie" obiecywałoby wysyłkę, której nie będzie.
    mountPanel({
      outbox: [
        outboxItem(),
        outboxItem({ id: "o2", code: "TICKET-2" }),
        outboxItem({ id: "o3", code: "TICKET-3", attempts: 8, lastError: "invalid_payload" }),
      ],
    });

    expect(screen.getByText("eventScanner.outbox.pending(count=2)")).toBeInTheDocument();
    expect(screen.getByText("eventScanner.outbox.stuck(count=1)")).toBeInTheDocument();
  });

  it("pozycja wymagająca uwagi niesie kod, czas skanu i POWÓD zdaniem", () => {
    mountPanel({
      outbox: [outboxItem({ attempts: 8, lastError: "invalid_payload: missing code" })],
    });

    expect(screen.getByText("TICKET-1")).toBeInTheDocument();
    expect(
      screen.getByText("Skan jest niekompletny. Zeskanuj kod jeszcze raz."),
    ).toBeInTheDocument();
    expect(screen.getByText("eventScanner.outbox.stuckHint")).toBeInTheDocument();
  });

  it("usunięcie z kolejki dotyczy DOKŁADNIE tej pozycji", () => {
    // Operator usuwa świadomie i pokazuje pozycję organizatorowi. Pomyłka
    // w identyfikatorze kasowałaby cudzy skan, którego nikt już nie odzyska.
    const view = mountPanel({
      outbox: [
        outboxItem({ id: "keep", code: "TICKET-KEEP", attempts: 8 }),
        outboxItem({ id: "drop", code: "TICKET-DROP", attempts: 8 }),
      ],
    });

    const row = screen.getByText("TICKET-DROP").closest("li") as HTMLElement;
    fireEvent.click(within(row).getByRole("button", { name: /eventScanner.outbox.discard/ }));

    expect(view.onDiscard).toHaveBeenCalledExactlyOnceWith("drop");
  });

  it("wysyłka ręczna woła opróżnienie kolejki", () => {
    const view = mountPanel({ outbox: [outboxItem()] });

    fireEvent.click(screen.getByRole("button", { name: /eventScanner.outbox.sync/ }));

    expect(view.onFlush).toHaveBeenCalledTimes(1);
  });

  it("wysyłka w toku blokuje przycisk - drugie kliknięcie to druga próba", () => {
    mountPanel({ outbox: [outboxItem()], flushing: true });

    expect(screen.getByRole("button", { name: /eventScanner.outbox.syncing/ })).toBeDisabled();
  });

  it("kolejka, która NIE PRZEŻYJE zamknięcia karty, ostrzega o tym z góry", () => {
    // Prywatne okno bez IndexedDB. Ostrzeżenie ma wisieć ZANIM operator
    // zeskanuje pierwszy bilet, a nie razem z pierwszą stratą.
    mountPanel({ persistent: false });

    expect(screen.getByText("eventScanner.session.memoryOnly")).toBeInTheDocument();
  });

  it("panel kolejki z pozycją wymagającą uwagi nie ma naruszeń axe", async () => {
    const { container } = mountPanel({
      outbox: [outboxItem(), outboxItem({ id: "o2", attempts: 8, lastError: "device_locked" })],
      persistent: false,
    });

    expect(await axeViolations(container).then(summarize)).toBe("");
  });
});
