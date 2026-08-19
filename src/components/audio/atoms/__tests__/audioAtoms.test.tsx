// Kontrakty A11Y atomów odtwarzacza.
//
// `AudioIconButton` powstał z OŚMIU kopii JSX rozsypanych po dwóch plikach,
// a `FOCUS_RING` - jedyna rzecz odpowiadająca za widoczność fokusu klawiatury
// w całym odtwarzaczu - był w nich ZADEKLAROWANY DWA RAZY. Testy pilnują tego,
// czego osiem kopii nie było w stanie utrzymać: jednego pierścienia fokusu,
// jednej nazwy dostępnej i tego, że stan `aria-pressed` mają WYŁĄCZNIE przyciski,
// które faktycznie przełączają.
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { Download, X } from "lucide-react";
import {
  AUDIO_FOCUS_RING,
  AUDIO_ICON_BUTTON_VARIANTS,
  AudioIconButton,
} from "@/components/audio/atoms/AudioIconButton";
import { MorphPlayPause } from "@/components/audio/atoms/MorphPlayPause";

describe("AudioIconButton - kontrakt a11y", () => {
  it("jest przyciskiem o nazwie dostępnej z etykiety (ikona nie jest nazwą)", () => {
    render(<AudioIconButton label="Pobierz MP3" onClick={() => {}} icon={Download} />);
    const button = screen.getByRole("button", { name: "Pobierz MP3" });
    expect(button).toBeInTheDocument();
    expect(button).toHaveTextContent("");
  });

  it("ikona jest DEKORACJĄ", () => {
    const { container } = render(
      <AudioIconButton label="Zamknij odtwarzacz" onClick={() => {}} icon={X} />,
    );
    expect(container.querySelector("svg")).toHaveAttribute("aria-hidden");
    expect(screen.getByRole("button", { name: "Zamknij odtwarzacz" })).toBeInTheDocument();
  });

  it("KAŻDY wariant niesie pierścień fokusu - jeden, wspólny", () => {
    for (const variant of Object.keys(AUDIO_ICON_BUTTON_VARIANTS) as Array<
      keyof typeof AUDIO_ICON_BUTTON_VARIANTS
    >) {
      const { unmount } = render(
        <AudioIconButton label={`akcja-${variant}`} onClick={() => {}} variant={variant} />,
      );
      expect(screen.getByRole("button", { name: `akcja-${variant}` }).className).toContain(
        "focus-visible:ring-2",
      );
      unmount();
    }
    expect(AUDIO_FOCUS_RING).toContain("focus-visible:ring-brand");
  });

  it("przycisk PRZEŁĄCZAJĄCY (odtwarzanie) ogłasza stan wciśnięcia", () => {
    render(<AudioIconButton label="Pauza" onClick={() => {}} variant="primary" pressed />);
    const button = screen.getByRole("button", { name: "Pauza", pressed: true });
    expect(button).toHaveAttribute("aria-pressed", "true");
    expect(button.className).toContain("bg-brand");
  });

  it("przycisk AKCJI nie ogłasza stanu, którego nie ma", () => {
    // W scalanych kopiach przycisk POBIERANIA miał `aria-pressed` - stan bez
    // żadnego znaczenia, ogłaszany czytnikowi ekranu przy każdym przejściu.
    render(<AudioIconButton label="Pobierz MP3" onClick={() => {}} icon={Download} />);
    expect(screen.getByRole("button", { name: "Pobierz MP3" })).not.toHaveAttribute("aria-pressed");
  });

  it("stan `busy` ogłasza zajętość, ale sam nie wyłącza przycisku", () => {
    render(<AudioIconButton label="Pobieram audio" onClick={() => {}} busy />);
    const button = screen.getByRole("button", { name: "Pobieram audio" });
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(button).toBeEnabled();
  });

  it("stan wyłączony blokuje akcję", () => {
    const onClick = vi.fn();
    render(<AudioIconButton label="Do przodu 15 sekund" onClick={onClick} disabled />);
    const button = screen.getByRole("button", { name: "Do przodu 15 sekund" });
    expect(button).toBeDisabled();
    button.click();
    expect(onClick).not.toHaveBeenCalled();
  });

  it("wywołuje akcję dokładnie raz na klik", () => {
    const onClick = vi.fn();
    render(<AudioIconButton label="Cofnij 15 sekund" onClick={onClick} />);
    screen.getByRole("button", { name: "Cofnij 15 sekund" }).click();
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onClick.mock.calls[0][0]).toBeDefined();
  });

  it("`children` zastępuje ikonę (spinner, morfująca ikona play)", () => {
    render(
      <AudioIconButton label="Generuję audio" onClick={() => {}} variant="primary">
        <span data-testid="spinner" />
      </AudioIconButton>,
    );
    expect(screen.getByTestId("spinner")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Generuję audio" })).toBeInTheDocument();
  });

  it("wariant `danger` różni się od `ghost` (zamknięcie nie wygląda jak akcja)", () => {
    expect(AUDIO_ICON_BUTTON_VARIANTS.danger).not.toBe(AUDIO_ICON_BUTTON_VARIANTS.ghost);
    expect(AUDIO_ICON_BUTTON_VARIANTS.danger).toContain("hover:text-destructive");
  });

  it("własna klasa nie zabiera wariantu ani pierścienia fokusu", () => {
    render(
      <AudioIconButton label="Pobierz" onClick={() => {}} icon={Download} className="hidden" />,
    );
    const cls = screen.getByRole("button", { name: "Pobierz" }).className;
    expect(cls).toContain("hidden");
    expect(cls).toContain("focus-visible:ring-2");
  });

  it("bez ikony i bez children renderuje pusty, ale NAZWANY przycisk", () => {
    render(<AudioIconButton label="1,5x" onClick={() => {}} />);
    const button = screen.getByRole("button", { name: "1,5x" });
    expect(button).toBeEmptyDOMElement();
    expect(button).toHaveAttribute("aria-label", "1,5x");
  });
});

describe("MorphPlayPause - atom ikony", () => {
  it("jest CAŁKOWICIE dekoracyjny (nazwę niesie przycisk, który go opakowuje)", () => {
    const { container } = render(<MorphPlayPause playing={false} />);
    expect(container.firstElementChild).toHaveAttribute("aria-hidden");
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("stan odtwarzania jest widoczny w DOM-ie (crossfade steruje CSS, nie React)", () => {
    const { container: idle } = render(<MorphPlayPause playing={false} />);
    const { container: playing } = render(<MorphPlayPause playing />);
    expect(idle.firstElementChild).toHaveAttribute("data-playing", "false");
    expect(playing.firstElementChild).toHaveAttribute("data-playing", "true");
  });

  it("renderuje OBA kształty naraz - przejście jest przenikaniem, nie podmianą", () => {
    const { container } = render(<MorphPlayPause playing />);
    expect(container.querySelectorAll("svg")).toHaveLength(2);
    expect(container.querySelector(".mpp-svg-play")).not.toBeNull();
  });

  it("ikony SVG są wyjęte z kolejności tabulacji", () => {
    const { container } = render(<MorphPlayPause playing={false} />);
    for (const svg of container.querySelectorAll("svg")) {
      expect(svg).toHaveAttribute("focusable", "false");
    }
    expect(container.querySelectorAll("svg").length).toBeGreaterThan(0);
  });

  it("własna klasa dokłada się do klasy bazowej", () => {
    const { container } = render(<MorphPlayPause playing={false} className="h-4 w-4" />);
    const cls = container.firstElementChild?.className ?? "";
    expect(cls).toContain("mpp");
    expect(cls).toContain("h-4");
  });
});
