// Izolowana ramka kreacji reklamowej. DWA RYZYKA NARAZ: (1) atrybut `sandbox`
// jest jedyną barierą między dowolnym HTML/JS wpisanym w panelu a sesją
// czytelnika, (2) ta sama ramka LICZY KLIKNIĘCIA - jej heurystyka trafia
// wprost do CTR w raporcie sprzedawanym reklamodawcy.
//
// CO TEN PLIK DOWODZI.
//   1. Ramka wystawia sandbox BEZ `allow-same-origin`, `referrerPolicy`
//      `no-referrer` i leniwe ładowanie. Asercja obronna: dopisanie
//      `allow-same-origin` kompiluje się i wygląda niewinnie, a otwiera
//      stored XSS z panelu reklam.
//   2. Markup trafia do `srcdoc` dosłownie (razem ze `<script>`), a NIE do DOM
//      strony - i to jest cała różnica między izolacją a wstrzyknięciem.
//   3. Heurystyka kliknięcia (window blur + activeElement === ramka) zlicza
//      NAJWYŻEJ RAZ na montaż i milczy, gdy fokus był gdzie indziej. Licznik
//      trzyma `useRef`, więc żaden re-render ani zmiana `onEngage` go nie
//      zeruje - to jest dokładnie ta warstwa, której nie widać w typach.
//   4. Cleanup zdejmuje listener z `window`: bez tego każdy kolejny montaż
//      slotu dokładałby jedno zliczenie na to samo przełączenie okna.
//   5. DEFEKT (`it.fails`): heurystyka nie odróżnia kliknięcia w kreację od
//      zwykłego alt-tab z fokusem na ramce - czyli zawyża CTR.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. Samych napisów `sandbox`/`srcdoc` dowodzi
// `src/lib/ads/__tests__/adFrame.test.ts`; tutaj chodzi o to, że komponent
// faktycznie je wystawia i że heurystyka działa na prawdziwych zdarzeniach.
// Bez atrapy: pod happy-dom `iframe.focus()` realnie ustawia
// `document.activeElement`, więc heurystykę da się przejechać naprawdę.
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { SandboxedAdFrame } from "@/components/ads/atoms/SandboxedAdFrame";

function frameOf(container: HTMLElement): HTMLIFrameElement {
  const el = container.querySelector("iframe");
  if (!el) throw new Error("brak ramki kreacji");
  return el;
}

/** Utrata fokusu okna - to jest sygnał, na którym stoi cała heurystyka. */
function blurWindow(): void {
  window.dispatchEvent(new Event("blur"));
}

describe("SandboxedAdFrame - izolacja kreacji", () => {
  afterEach(cleanup);

  it("nie przyznaje kreacji allow-same-origin - opaque origin zamiast dostępu do sesji", () => {
    const { container } = render(<SandboxedAdFrame markup="<b>x</b>" title="Reklama: A" />);
    const sandbox = frameOf(container).getAttribute("sandbox") ?? "";
    expect(sandbox).not.toContain("allow-same-origin");
    expect(sandbox).toContain("allow-scripts");
    expect(sandbox).toContain("allow-popups");
    expect(sandbox).toContain("allow-popups-to-escape-sandbox");
  });

  it("nie wycieka adresu strony czytelnika do serwera kreacji (referrerPolicy)", () => {
    const { container } = render(<SandboxedAdFrame markup="<b>x</b>" title="Reklama: A" />);
    expect(frameOf(container).getAttribute("referrerpolicy")).toBe("no-referrer");
  });

  it("ładuje się leniwie i nosi nazwę slotu jako dostępną etykietę", () => {
    const { container } = render(<SandboxedAdFrame markup="<b>x</b>" title="Reklama: Baner" />);
    const frame = frameOf(container);
    expect(frame.getAttribute("loading")).toBe("lazy");
    expect(frame.getAttribute("title")).toBe("Reklama: Baner");
  });

  it("markup ze <script> i cudzysłowami ląduje w srcdoc, a NIE w DOM strony", () => {
    const markup = '<div id="kreacja"><script>window.__ad="1"</script></div>';
    const { container } = render(<SandboxedAdFrame markup={markup} title="Reklama: A" />);
    expect(frameOf(container).getAttribute("srcdoc")).toContain(markup);
    // Gdyby kreacja trafiła do dokumentu strony, te selektory by ją znalazły.
    expect(document.querySelector("#kreacja")).toBeNull();
    expect(container.querySelector("script")).toBeNull();
  });

  it("zmiana kreacji przebudowuje srcdoc (memo nie zamraża starej treści)", () => {
    const { container, rerender } = render(
      <SandboxedAdFrame markup="<b>pierwsza</b>" title="Reklama: A" />,
    );
    expect(frameOf(container).getAttribute("srcdoc")).toContain("pierwsza");
    rerender(<SandboxedAdFrame markup="<b>druga</b>" title="Reklama: A" />);
    const srcdoc = frameOf(container).getAttribute("srcdoc") ?? "";
    expect(srcdoc).toContain("druga");
    expect(srcdoc).not.toContain("pierwsza");
  });
});

describe("SandboxedAdFrame - zliczanie interakcji (CTR)", () => {
  let onEngage: Mock<() => void>;

  beforeEach(() => {
    onEngage = vi.fn<() => void>();
  });

  afterEach(cleanup);

  it("utrata fokusu okna przy fokusie NA RAMCE zgłasza interakcję dokładnie raz", () => {
    const { container } = render(
      <SandboxedAdFrame markup="<b>x</b>" title="Reklama: A" onEngage={onEngage} />,
    );
    frameOf(container).focus();

    blurWindow();
    expect(onEngage).toHaveBeenCalledTimes(1);

    // Drugie przełączenie okna to nadal ta sama, jedna interakcja.
    blurWindow();
    blurWindow();
    expect(onEngage).toHaveBeenCalledTimes(1);
  });

  it("utrata fokusu okna, gdy fokus jest POZA ramką, nie zgłasza niczego", () => {
    const { container } = render(
      <>
        <button type="button">obok</button>
        <SandboxedAdFrame markup="<b>x</b>" title="Reklama: A" onEngage={onEngage} />
      </>,
    );
    container.querySelector("button")?.focus();
    expect(document.activeElement).not.toBe(frameOf(container));

    blurWindow();
    expect(onEngage).not.toHaveBeenCalled();
  });

  it("brak propa onEngage nie wywraca listenera (slot bez pomiaru)", () => {
    const { container } = render(<SandboxedAdFrame markup="<b>x</b>" title="Reklama: A" />);
    frameOf(container).focus();
    expect(() => blurWindow()).not.toThrow();
  });

  it("podmiana onEngage po zliczeniu nie odblokowuje drugiego zliczenia", () => {
    const drugi = vi.fn<() => void>();
    const { container, rerender } = render(
      <SandboxedAdFrame markup="<b>x</b>" title="Reklama: A" onEngage={onEngage} />,
    );
    frameOf(container).focus();
    blurWindow();
    expect(onEngage).toHaveBeenCalledTimes(1);

    // Nowa tożsamość callbacku przepina listener (zależność efektu), ale
    // licznik siedzi w useRef i przeżywa przepięcie.
    rerender(<SandboxedAdFrame markup="<b>x</b>" title="Reklama: A" onEngage={drugi} />);
    frameOf(container).focus();
    blurWindow();
    expect(drugi).not.toHaveBeenCalled();
    expect(onEngage).toHaveBeenCalledTimes(1);
  });

  it("po odmontowaniu ramki przełączenie okna nie dolicza już nic (cleanup zdjął listener)", () => {
    const { container, unmount } = render(
      <SandboxedAdFrame markup="<b>x</b>" title="Reklama: A" onEngage={onEngage} />,
    );
    frameOf(container).focus();
    unmount();

    blurWindow();
    expect(onEngage).not.toHaveBeenCalled();
  });

  it("dwa kolejne montaże tego samego slotu nie liczą podwójnie jednego przełączenia okna", () => {
    const pierwszy = render(
      <SandboxedAdFrame markup="<b>x</b>" title="Reklama: A" onEngage={onEngage} />,
    );
    pierwszy.unmount();

    const drugi = render(
      <SandboxedAdFrame markup="<b>x</b>" title="Reklama: A" onEngage={onEngage} />,
    );
    frameOf(drugi.container).focus();
    blurWindow();
    expect(onEngage).toHaveBeenCalledTimes(1);
  });

  // DEFEKT. Heurystyka widzi WYŁĄCZNIE utratę fokusu okna przy aktywnej ramce.
  // Czytelnik, który przeczytał kreację, zostawił na niej fokus (np. dotarł do
  // niej Tabem albo kliknął w jej tło bez trafienia w link) i przełączył się na
  // inną kartę / inną aplikację, jest liczony jako KLIKNIĘCIE - bez żadnej
  // interakcji z samą kreacją. Widoczny skutek: CTR w raporcie sprzedażowym
  // jest zawyżony o alt-taby, a reklamodawca płaci za ruch, którego nie było.
  // OCZEKIWANE: zliczenie wymaga śladu realnej interakcji ze wskaźnikiem
  // (np. pointerdown na ramce przed utratą fokusu), a samo przełączenie okna
  // nie generuje zdarzenia "click".
  it.fails("alt-tab z fokusem na ramce NIE POWINIEN być liczony jako kliknięcie", () => {
    const { container } = render(
      <SandboxedAdFrame markup="<b>x</b>" title="Reklama: A" onEngage={onEngage} />,
    );
    // Fokus na ramce, ale ANI JEDNEGO zdarzenia wskaźnika - modelujemy zwykłe
    // przejście do innej karty.
    frameOf(container).focus();
    blurWindow();

    expect(onEngage).not.toHaveBeenCalled();
  });
});
