// LinkPreview to link zewnętrzny z podglądem obrazka po najechaniu (Radix
// HoverCard). Kontrakt: link zawsze otwiera się w nowej karcie z
// `rel="noopener noreferrer"`; wyłączony podgląd daje zwykły link; otwarty
// podgląd jest opisem linku (`aria-describedby`), a zamknięty nie wisi w drzewie
// dostępności; obrazek wchodzi z przezroczystości dopiero po wczytaniu;
// ruch myszy przesuwa kartę za kursorem tylko wtedy, gdy link ma szerokość.
//
// Domyślne opóźnienia (60 ms otwarcie, 100 ms zamknięcie) to gałęzie
// komponentu, więc test steruje czasem atrapą zegara zamiast je nadpisywać.
// Zegar jest przywracany w `afterEach`.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { LinkPreview } from "../link-preview";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const LINK_URL = "https://example.test/raport";

function hover(link: HTMLElement, ms: number) {
  fireEvent.pointerEnter(link, { pointerType: "mouse" });
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

function card(): HTMLElement | null {
  return document.querySelector("[data-link-preview-card]");
}

describe("LinkPreview", () => {
  it("wyłączony podgląd daje zwykły link do nowej karty bez warstwy podglądu", () => {
    render(
      <LinkPreview
        url={LINK_URL}
        imageSrc="/p.png"
        alt="Okładka"
        enabled={false}
        className="font-bold"
      >
        Raport
      </LinkPreview>,
    );
    const link = screen.getByRole("link", { name: "Raport" });
    expect(link).toHaveAttribute("href", LINK_URL);
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(link).toHaveClass("text-primary", "underline", "font-bold");
    expect(link).not.toHaveAttribute("data-state");
    hover(link, 500);
    expect(card()).toBeNull();
  });

  it("włączony podgląd zostaje bezpiecznym linkiem do nowej karty i startuje zamknięty", () => {
    render(
      <LinkPreview url={LINK_URL} imageSrc="/p.png" alt="Okładka">
        Raport
      </LinkPreview>,
    );
    const link = screen.getByRole("link", { name: "Raport" });
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(link).toHaveAttribute("data-state", "closed");
    expect(link).not.toHaveAttribute("aria-describedby");
    expect(card()).toBeNull();
  });

  it("otwiera podgląd po domyślnym opóźnieniu i wiąże go z linkiem jako opis", () => {
    render(
      <LinkPreview url={LINK_URL} imageSrc="/p.png" alt="Okładka raportu">
        Raport
      </LinkPreview>,
    );
    const link = screen.getByRole("link", { name: "Raport" });
    hover(link, 59);
    expect(card()).toBeNull();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(card()).not.toBeNull();
    expect(link).toHaveAttribute("data-state", "open");
    const describedBy = link.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy as string)).toContainElement(card());
    expect(link).toHaveAccessibleDescription("Okładka raportu");
  });

  it("zamyka podgląd po domyślnym opóźnieniu od zjechania myszą i zdejmuje opis", () => {
    render(
      <LinkPreview url={LINK_URL} imageSrc="/p.png" alt="Okładka">
        Raport
      </LinkPreview>,
    );
    const link = screen.getByRole("link", { name: "Raport" });
    hover(link, 60);
    expect(card()).not.toBeNull();
    fireEvent.pointerLeave(link, { pointerType: "mouse" });
    act(() => {
      vi.advanceTimersByTime(99);
    });
    expect(card()).not.toBeNull();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(card()).toBeNull();
    expect(link).not.toHaveAttribute("aria-describedby");
  });

  it("otwiera podgląd z klawiatury i zamyka go klawiszem Escape", () => {
    render(
      <LinkPreview url={LINK_URL} imageSrc="/p.png" alt="Okładka" openDelay={0} closeDelay={0}>
        Raport
      </LinkPreview>,
    );
    const link = screen.getByRole("link", { name: "Raport" });
    fireEvent.focus(link);
    act(() => {
      vi.advanceTimersByTime(0);
    });
    const preview = card();
    expect(preview).not.toBeNull();
    fireEvent.keyDown(preview as HTMLElement, { key: "Escape" });
    expect(card()).toBeNull();
  });

  it("ładuje obrazek leniwie w domyślnym rozmiarze i odsłania go dopiero po wczytaniu", () => {
    render(
      <LinkPreview url={LINK_URL} imageSrc="/okladka.png" alt="Okładka">
        Raport
      </LinkPreview>,
    );
    hover(screen.getByRole("link", { name: "Raport" }), 60);
    const image = screen.getByRole("img", { name: "Okładka" });
    expect(image).toHaveAttribute("src", "/okladka.png");
    expect(image).toHaveAttribute("loading", "lazy");
    expect(image).toHaveAttribute("decoding", "async");
    expect(image).toHaveAttribute("referrerpolicy", "no-referrer");
    expect(image).toHaveAttribute("width", "200");
    expect(image).toHaveAttribute("height", "125");
    expect(image.style.width).toBe("200px");
    expect(image).toHaveClass("opacity-0", "bg-muted");
    fireEvent.load(image);
    expect(image).toHaveClass("opacity-100");
    expect(image).not.toHaveClass("opacity-0");
  });

  it("przyjmuje własny rozmiar obrazka i rysuje kartę tokenami motywu", () => {
    render(
      <LinkPreview
        url={LINK_URL}
        imageSrc="/p.png"
        alt="Mała"
        width={120}
        height={80}
        openDelay={10}
        closeDelay={10}
      >
        Raport
      </LinkPreview>,
    );
    hover(screen.getByRole("link", { name: "Raport" }), 10);
    const image = screen.getByRole("img", { name: "Mała" });
    expect(image).toHaveAttribute("width", "120");
    expect(image).toHaveAttribute("height", "80");
    expect(image.style.height).toBe("80px");
    expect(card()).toHaveClass("bg-card", "border-border", "shadow-lg");
  });

  it("przesuwa otwartą kartę za kursorem względem środka linku", () => {
    render(
      <LinkPreview url={LINK_URL} imageSrc="/p.png" alt="Okładka">
        Raport
      </LinkPreview>,
    );
    const link = screen.getByRole("link", { name: "Raport" });
    hover(link, 60);
    vi.spyOn(link, "getBoundingClientRect").mockReturnValue(new DOMRect(10, 0, 100, 20));
    fireEvent.mouseMove(link, { clientX: 90 });
    expect(card()?.style.getPropertyValue("--lp-offset-x")).toBe("15.0px");
    fireEvent.mouseMove(link, { clientX: 20 });
    expect(card()?.style.getPropertyValue("--lp-offset-x")).toBe("-20.0px");
  });

  it("nie przesuwa karty, gdy link nie ma jeszcze szerokości", () => {
    render(
      <LinkPreview url={LINK_URL} imageSrc="/p.png" alt="Okładka">
        Raport
      </LinkPreview>,
    );
    const link = screen.getByRole("link", { name: "Raport" });
    hover(link, 60);
    fireEvent.mouseMove(link, { clientX: 90 });
    expect(card()?.style.getPropertyValue("--lp-offset-x")).toBe("");
  });

  it("ruch myszy przy zamkniętym podglądzie nie wywraca komponentu", () => {
    render(
      <LinkPreview url={LINK_URL} imageSrc="/p.png" alt="Okładka">
        Raport
      </LinkPreview>,
    );
    const link = screen.getByRole("link", { name: "Raport" });
    vi.spyOn(link, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 100, 20));
    expect(() => fireEvent.mouseMove(link, { clientX: 70 })).not.toThrow();
    expect(card()).toBeNull();
    expect(link).toHaveAttribute("data-state", "closed");
  });
});
