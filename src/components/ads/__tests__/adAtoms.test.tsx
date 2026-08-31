// Atomy reklamy: `AdContainer` (rezerwacja miejsca = CLS) i `SandboxedAdFrame`
// (izolacja kreacji = stored XSS).
//
// PO CO TEN PLIK ISTNIEJE. Oba atomy są cienkie i wyglądają na „nic do
// testowania", a każdy z nich sam jeden trzyma jedno twarde wymaganie:
//
//   * AdContainer trzyma pudełko slotu OD PIERWSZEGO PAINTU. Skasowanie
//     `reserveStyle` z jego stylu nie psuje ani jednego renderu - psuje
//     Cumulative Layout Shift, czyli metrykę widoczną dopiero w Lighthouse
//     i w rankingu wyszukiwarki, tygodnie po wdrożeniu.
//   * SandboxedAdFrame trzyma `sandbox` BEZ `allow-same-origin`. Dopisanie tam
//     jednego tokenu (np. „bo kreacja klienta potrzebuje localStorage") daje
//     dowolnemu HTML-owi z panelu pełny dostęp do sesji czytelnika. To jest
//     bramka bezpieczeństwa, więc ma tu JAWNĄ, nazwaną asercję - taką, której
//     nie da się usunąć przypadkiem przy refaktorze.
//
// ATRAPUJEMY WYŁĄCZNIE GRANICE: nic tu nie sięga sieci ani bazy, więc oba atomy
// biegną w całości prawdziwe, na prawdziwym DOM-ie happy-dom.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRef } from "react";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { axeViolations, summarize } from "@/test/axe";
import { AdContainer } from "@/components/ads/atoms/AdContainer";
import { SandboxedAdFrame } from "@/components/ads/atoms/SandboxedAdFrame";

afterEach(() => {
  cleanup();
});

// ---------------------------------------------------------------------------
describe("AdContainer - rezerwacja miejsca (zero CLS)", () => {
  it("znane szerokość i wysokość rezerwują pudełko PROPORCJĄ, nie sztywną wysokością", () => {
    render(
      <AdContainer dimensions={{ width: 300, height: 250 }} label="Reklama" position="sidebar" />,
    );

    const box = screen.getByRole("complementary");
    // Proporcja skaluje się na wąskim ekranie, a `maxWidth` nie pozwala
    // rozciągnąć kreacji ponad jej rozdzielczość - obie własności są potrzebne.
    expect(box.style.aspectRatio).toBe("300 / 250");
    expect(box.style.maxWidth).toBe("300px");
    expect(box.style.width).toBe("100%");
  });

  it("sama wysokość rezerwuje PODŁOGĘ wysokości", () => {
    render(
      <AdContainer dimensions={{ width: null, height: 120 }} label="Reklama" position="sidebar" />,
    );

    const box = screen.getByRole("complementary");
    expect(box.style.minHeight).toBe("120px");
    expect(box.style.aspectRatio).toBe("");
  });

  it("BEZ wymiarów slot rezerwuje wysokość typową dla swojej pozycji", () => {
    render(
      <AdContainer
        dimensions={{ width: null, height: null }}
        label="Reklama"
        position="mid_post"
      />,
    );

    // Kreacja bez zadeklarowanych wymiarów to najczęstszy przypadek przy
    // podpięciu sieci reklamowej - gdyby pudełko zapadło się do 0 px, wstawka
    // śródtekstowa zepchnęłaby resztę artykułu w chwili doładowania.
    expect(screen.getByRole("complementary").style.minHeight).toBe("250px");
  });

  it("pasek nagłówka i pasek dolny rezerwują niższe pudełko niż prostokąt w treści", () => {
    render(
      <>
        <AdContainer
          dimensions={{ width: null, height: null }}
          label="Baner"
          position="header_banner"
        />
        <AdContainer
          dimensions={{ width: null, height: null }}
          label="Pasek"
          position="footer_slideup"
        />
      </>,
    );

    const [header, slideup] = screen.getAllByRole("complementary");
    expect(header.style.minHeight).toBe("90px");
    expect(slideup.style.minHeight).toBe("90px");
  });

  it("wymiar zerowy lub ujemny traktujemy jak BRAK wymiaru", () => {
    render(
      <AdContainer dimensions={{ width: 0, height: -10 }} label="Reklama" position="sidebar" />,
    );

    const box = screen.getByRole("complementary");
    expect(box.style.aspectRatio).toBe("");
    expect(box.style.minHeight).toBe("250px");
  });

  it("miejsce jest zarezerwowane JUŻ w stanie ładowania, zanim przyjdzie kreacja", () => {
    render(
      <AdContainer
        dimensions={{ width: 728, height: 90 }}
        label="Reklama"
        position="header_banner"
        state="loading"
      />,
    );

    // To jest cała istota strategii zero-CLS: pudełko istnieje w pierwszym
    // paincie, a kreacja wpada w miejsce, które już tam było.
    const box = screen.getByRole("complementary");
    expect(box.style.aspectRatio).toBe("728 / 90");
    expect(box).toBeEmptyDOMElement();
  });

  it("styl podany przez wywołującego nadpisuje rezerwację, a nie odwrotnie", () => {
    render(
      <AdContainer
        dimensions={{ width: 300, height: 250 }}
        label="Reklama"
        position="sidebar"
        style={{ maxWidth: 999 }}
      />,
    );

    expect(screen.getByRole("complementary").style.maxWidth).toBe("999px");
  });
});

// ---------------------------------------------------------------------------
describe("AdContainer - atrybuty data-ad-* i stany", () => {
  it("wystawia komplet znaczników slotu dla analityki i blokerów", () => {
    render(
      <AdContainer
        dimensions={{ width: 300, height: 250 }}
        label="Reklama"
        position="in_feed"
        kind="script"
        slotId="slot-42"
        state="ready"
      />,
    );

    const box = screen.getByRole("complementary");
    expect(box).toHaveAttribute("data-ad-slot", "slot-42");
    expect(box).toHaveAttribute("data-ad-position", "in_feed");
    expect(box).toHaveAttribute("data-ad-kind", "script");
    expect(box).toHaveAttribute("data-ad-state", "ready");
  });

  it("domyślnym stanem jest ładowanie - i tylko ono ustawia aria-busy", () => {
    render(<AdContainer dimensions={{ width: null, height: null }} label="Reklama" />);

    const box = screen.getByRole("complementary");
    expect(box).toHaveAttribute("data-ad-state", "loading");
    expect(box).toHaveAttribute("aria-busy", "true");
  });

  it("stan `blocked` znaczy pudełko i ZDEJMUJE aria-busy", () => {
    render(
      <AdContainer dimensions={{ width: 300, height: 250 }} label="Reklama" state="blocked">
        Treść reklamowa zablokowana
      </AdContainer>,
    );

    const box = screen.getByRole("complementary");
    // `aria-busy` w stanie blokady kazałoby czytnikowi ekranu czekać na treść,
    // która nigdy nie przyjdzie - komunikat o braku zgody ma być czytany od razu.
    expect(box).toHaveAttribute("aria-busy", "false");
    expect(box).toHaveAttribute("data-ad-state", "blocked");
    expect(box.className).toContain("border-dashed");
    expect(box).toHaveTextContent("Treść reklamowa zablokowana");
  });

  it("stan `ready` nie ma już aria-busy ani tła stanu ładowania", () => {
    render(
      <AdContainer dimensions={{ width: 300, height: 250 }} label="Reklama" state="ready">
        <img src="https://cdn.example.com/kreacja.png" alt="Kreacja" />
      </AdContainer>,
    );

    const box = screen.getByRole("complementary");
    expect(box).toHaveAttribute("aria-busy", "false");
    expect(box.className).not.toContain("bg-muted/10");
    expect(screen.getByRole("img")).toBeInTheDocument();
  });

  it("bez identyfikatora slotu nie zostawia pustych atrybutów w DOM", () => {
    render(<AdContainer dimensions={{ width: null, height: null }} label="Reklama" />);

    const box = screen.getByRole("complementary");
    expect(box.hasAttribute("data-ad-slot")).toBe(false);
    expect(box.hasAttribute("data-ad-position")).toBe(false);
    expect(box.hasAttribute("data-ad-kind")).toBe(false);
  });

  it("dokłada klasy wywołującego, nie gubiąc własnych", () => {
    render(
      <AdContainer
        dimensions={{ width: null, height: null }}
        label="Reklama"
        className="my-custom-zone"
      />,
    );

    const box = screen.getByRole("complementary");
    expect(box.className).toContain("ad-slot");
    expect(box.className).toContain("my-custom-zone");
  });

  it("przekazuje ref do PRAWDZIWEGO węzła DOM", () => {
    const ref = createRef<HTMLDivElement>();

    render(<AdContainer ref={ref} dimensions={{ width: null, height: null }} label="Reklama" />);

    // `useDeferredAd` obserwuje ten węzeł IntersectionObserverem. Zerwany ref
    // nie wywala niczego - po prostu bramka viewportu nigdy się nie otwiera
    // i WSZYSTKIE reklamy przestają się ładować, w ciszy.
    expect(ref.current).toBe(screen.getByRole("complementary"));
    expect(ref.current?.tagName).toBe("DIV");
  });
});

// ---------------------------------------------------------------------------
describe("AdContainer - dostępność", () => {
  // -------------------------------------------------------------------------
  // DEFEKT - test celowo oznaczony `it.fails`, kod produkcyjny NIE jest zmieniany.
  //
  // CO JEST ZŁE. `AdContainer` nadaje KAŻDEMU slotowi `role="complementary"`
  // z etykietą `aria-label`, a `AdSlotView` podaje tam zawsze ten sam napis -
  // `t("ads.label")`, czyli „Reklama" / „Advertisement". Strona artykułu ma do
  // pięciu stref naraz (top_of_post, mid_post, sidebar, bottom_of_post,
  // footer_slideup), więc powstaje pięć punktów orientacyjnych o IDENTYCZNEJ
  // roli i nazwie. axe-core zgłasza tu regułę `landmark-unique`.
  //
  // DLACZEGO TO RYZYKO. Punkty orientacyjne to główna nawigacja czytnika ekranu
  // (w NVDA/JAWS klawisz D, w VoiceOver rotor). Lista pięciu identycznych
  // pozycji „Reklama" jest bezużyteczna: użytkownik nie wie, do którego miejsca
  // artykułu skacze, ani czy właśnie wrócił tam, gdzie już był. To bariera
  // dostępności w serwisie publicznym, a nie kosmetyka - i jedyna rzecz, której
  // NIE widać w żadnym teście renderującym pojedynczy slot (dlatego przypadek
  // wyżej, z jednym kontenerem, przechodzi na zielono).
  //
  // DLACZEGO NIE NAPRAWIAM. Poprawka nie jest lokalna dla tego atomu: trzeba
  // rozstrzygnąć, skąd bierze się rozróżniająca nazwa (klucz i18n per pozycja,
  // np. „Reklama - nad artykułem", plus nowe wpisy w PL i EN), a być może w ogóle
  // zdjąć rolę punktu orientacyjnego ze slotów śródtekstowych. To decyzja
  // produktowo-językowa, a zadanie zabrania zmian w kodzie produkcyjnym.
  it.fails("kilka stref na jednej stronie ma ROZRÓŻNIALNE punkty orientacyjne", async () => {
    const { container } = render(
      <main>
        <AdContainer
          dimensions={{ width: 300, height: 250 }}
          label="Reklama"
          position="top_of_post"
          state="ready"
        >
          <img src="https://cdn.example.com/gora.png" alt="Kreacja nad artykułem" />
        </AdContainer>
        <p>Treść artykułu.</p>
        <AdContainer
          dimensions={{ width: 300, height: 250 }}
          label="Reklama"
          position="mid_post"
          state="ready"
        >
          <img src="https://cdn.example.com/srodek.png" alt="Kreacja śródtekstowa" />
        </AdContainer>
      </main>,
    );

    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });

  it("pojedynczy slot nie łamie reguł axe", async () => {
    const { container } = render(
      <AdContainer dimensions={{ width: 300, height: 250 }} label="Reklama" state="ready">
        <img src="https://cdn.example.com/kreacja.png" alt="Kreacja reklamowa" />
      </AdContainer>,
    );

    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
describe("SandboxedAdFrame - izolacja kreacji", () => {
  const MARKUP = '<div id="kreacja">Kup teraz</div>';

  it("BRAMKA BEZPIECZEŃSTWA: sandbox NIE zawiera allow-same-origin", () => {
    render(<SandboxedAdFrame markup={MARKUP} title="Reklama: Kampania" />);

    const frame = screen.getByTitle("Reklama: Kampania");
    const sandbox = frame.getAttribute("sandbox");
    // Treść slotu to dowolny HTML/JS wpisany w panelu. Z `allow-same-origin`
    // kreacja dostaje origin strony: czyta cookies sesji, localStorage i DOM,
    // czyli przejęte konto redaktora zamienia się w przejęte konto czytelnika.
    // Bez tego tokenu ramka ma opaque origin i nie widzi niczego.
    expect(sandbox).not.toBeNull();
    expect(sandbox).not.toContain("allow-same-origin");
  });

  it("BRAMKA BEZPIECZEŃSTWA: sandbox nie daje też dostępu do nawigacji strony", () => {
    render(<SandboxedAdFrame markup={MARKUP} title="Reklama: Kampania" />);

    const sandbox = screen.getByTitle("Reklama: Kampania").getAttribute("sandbox") ?? "";
    // `allow-top-navigation` pozwoliłby kreacji przekierować CAŁĄ stronę
    // czytelnika (klasyczny malvertising); `allow-modals` - zawiesić ją alertem.
    expect(sandbox).not.toContain("allow-top-navigation");
    expect(sandbox).not.toContain("allow-modals");
    expect(sandbox).not.toContain("allow-storage-access-by-user-activation");
  });

  it("sandbox daje DOKŁADNIE trzy tokeny potrzebne do emisji", () => {
    render(<SandboxedAdFrame markup={MARKUP} title="Reklama: Kampania" />);

    // Lista jest zamknięta celowo: każdy nowy token to nowa zdolność kreacji,
    // więc ma przechodzić przez zmianę tego testu, a nie przez zwykły refaktor.
    expect(screen.getByTitle("Reklama: Kampania").getAttribute("sandbox")).toBe(
      "allow-scripts allow-popups allow-popups-to-escape-sandbox",
    );
  });

  it("kreacja jedzie w srcdoc, a nie do DOM-u strony", () => {
    const { container } = render(<SandboxedAdFrame markup={MARKUP} title="Reklama: Kampania" />);

    // Gdyby kreacja trafiła do DOM strony (dawny wariant z innerHTML),
    // jej skrypt wykonałby się z uprawnieniami serwisu.
    expect(container.querySelector("#kreacja")).toBeNull();
    expect(screen.getByTitle("Reklama: Kampania").getAttribute("srcdoc")).toContain(MARKUP);
  });

  it("kreacja typu `script` też nie ląduje w DOM strony", () => {
    // Znacznik zamykajacy sklejony z dwoch czesci: literal "</script>" w pliku
    // .tsx zamknalby tag otaczajacy, a escape `<\/` jest w zwyklym stringu
    // (nie w regexie) zbedny - linter go zglasza.
    const script = "<script>window.location = 'https://zly.example.org';<" + "/script>";
    const { container } = render(<SandboxedAdFrame markup={script} title="Reklama: AdSense" />);

    const srcdoc = screen.getByTitle("Reklama: AdSense").getAttribute("srcdoc") ?? "";
    expect(srcdoc).toContain("zly.example.org");
    // Skrypt kreacji istnieje WYŁĄCZNIE jako tekst wewnątrz `srcdoc`. Do drzewa
    // strony nie trafia ŻADEN element <script>, więc nie ma czego wykonać
    // z uprawnieniami serwisu - to jest różnica między dawnym montażem przez
    // innerHTML a dzisiejszą ramką.
    expect(container.querySelector("script")).toBeNull();
  });

  it("dokument ramki otwiera linki w nowej karcie i nie wysyła referrera", () => {
    render(<SandboxedAdFrame markup={MARKUP} title="Reklama: Kampania" />);

    const frame = screen.getByTitle("Reklama: Kampania");
    // Bez `<base target="_blank">` link w sandboxie bez `allow-top-navigation`
    // po prostu NIC NIE ROBI - kreacja byłaby nieklikalna.
    expect(frame.getAttribute("srcdoc")).toContain('<base target="_blank">');
    expect(frame).toHaveAttribute("referrerpolicy", "no-referrer");
    expect(frame).toHaveAttribute("loading", "lazy");
  });

  it("tytuł ramki jest jej dostępną nazwą - czytnik ekranu odróżni reklamę", () => {
    render(<SandboxedAdFrame markup={MARKUP} title="Reklama: Kampania jesienna" />);

    expect(screen.getByTitle("Reklama: Kampania jesienna").tagName).toBe("IFRAME");
  });

  it("zmiana kreacji przebudowuje srcdoc", () => {
    const { rerender } = render(<SandboxedAdFrame markup="<b>A</b>" title="Reklama" />);
    expect(screen.getByTitle("Reklama").getAttribute("srcdoc")).toContain("<b>A</b>");

    rerender(<SandboxedAdFrame markup="<b>B</b>" title="Reklama" />);

    expect(screen.getByTitle("Reklama").getAttribute("srcdoc")).toContain("<b>B</b>");
  });
});

// ---------------------------------------------------------------------------
describe("SandboxedAdFrame - pomiar interakcji (onEngage)", () => {
  const MARKUP = '<a href="https://example.com">Kup</a>';

  /** Odwzorowuje przejście fokusu do ramki i wyjście fokusu z okna. */
  function engage(frame: HTMLElement) {
    frame.focus();
    fireEvent.blur(window);
  }

  beforeEach(() => {
    document.body.focus();
  });

  it("zgłasza interakcję, gdy okno traci fokus przy zafokusowanej ramce", () => {
    const onEngage = vi.fn();
    render(<SandboxedAdFrame markup={MARKUP} title="Reklama" onEngage={onEngage} />);

    // Kliknięcia WEWNĄTRZ sandboxa nie bąbelkują do strony, więc to jedyny
    // sygnał, po którym da się policzyć kliknięcie w kreację html/script.
    engage(screen.getByTitle("Reklama"));

    expect(onEngage).toHaveBeenCalledTimes(1);
  });

  it("liczy najwyżej RAZ na montaż - jedno kliknięcie to jedno zdarzenie", () => {
    const onEngage = vi.fn();
    render(<SandboxedAdFrame markup={MARKUP} title="Reklama" onEngage={onEngage} />);
    const frame = screen.getByTitle("Reklama");

    engage(frame);
    engage(frame);
    engage(frame);

    // Bez tego zabezpieczenia każde przełączenie karty przeglądarki dokładałoby
    // kliknięcie do rozliczenia z reklamodawcą.
    expect(onEngage).toHaveBeenCalledTimes(1);
  });

  it("NIE zgłasza interakcji, gdy fokus nie był na ramce", () => {
    const onEngage = vi.fn();
    render(<SandboxedAdFrame markup={MARKUP} title="Reklama" onEngage={onEngage} />);

    // Zwykłe przełączenie karty przy czytaniu artykułu - żadnego kontaktu
    // z reklamą, żadnego kliknięcia w raporcie.
    fireEvent.blur(window);

    expect(onEngage).not.toHaveBeenCalled();
  });

  it("brak wywołania zwrotnego nie wywraca ramki", () => {
    render(<SandboxedAdFrame markup={MARKUP} title="Reklama" />);

    expect(() => engage(screen.getByTitle("Reklama"))).not.toThrow();
  });

  it("po odmontowaniu nie nasłuchuje dalej na oknie", () => {
    const onEngage = vi.fn();
    const { unmount } = render(
      <SandboxedAdFrame markup={MARKUP} title="Reklama" onEngage={onEngage} />,
    );
    const frame = screen.getByTitle("Reklama");
    frame.focus();

    unmount();
    fireEvent.blur(window);

    // Wyciek nasłuchu na `window` przeżywa nawigację i zgłaszałby kliknięcia
    // w slot, którego na stronie już nie ma.
    expect(onEngage).not.toHaveBeenCalled();
  });
});
