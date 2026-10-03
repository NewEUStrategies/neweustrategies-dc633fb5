// Toaster (sonner) w jasnym i ciemnym motywie. Kontrakt opakowania: każdy
// toast, opis i przyciski biorą kolory z tokenów (`bg-background`,
// `text-muted-foreground`, `bg-primary`, `bg-muted`), więc wyglądają spójnie
// w obu motywach; motyw biblioteki (`data-sonner-theme`) idzie z propsa, a dla
// `system` z preferencji systemu; kierunek pisma jest stały (`ltr`), bo
// automatyczne wykrywanie czytałoby styl całego dokumentu. Region powiadomień
// jest ogłaszany czytnikowi i osiągalny skrótem Alt+T.
//
// Montowanie bez wymuszania odczytu stylów pilnuje `sonner.test.tsx`; ten plik
// go nie dubluje. `matchMedia` podmieniam wyłącznie w testach motywu `system`
// (happy-dom nie zna preferencji systemu) i przywracam w `afterEach`.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { toast } from "sonner";
import { Toaster } from "../sonner";

afterEach(() => {
  act(() => {
    toast.dismiss();
  });
  cleanup();
  vi.unstubAllGlobals();
});

function stubColorScheme(scheme: "dark" | "light") {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: query === "(prefers-color-scheme: dark)" && scheme === "dark",
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  );
}

async function showToast() {
  act(() => {
    toast("Zapisano zmiany", {
      description: "Wersja robocza jest aktualna.",
      action: { label: "Cofnij", onClick: () => undefined },
      cancel: { label: "Zamknij", onClick: () => undefined },
    });
  });
  await act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
  const list = document.querySelector<HTMLOListElement>("[data-sonner-toaster]");
  expect(list).not.toBeNull();
  return list as HTMLOListElement;
}

describe("Toaster - motyw", () => {
  it("ogłasza region powiadomień czytnikowi ekranu uprzejmie, bez przerywania", () => {
    render(<Toaster />);
    const region = screen.getByRole("region", { name: /Notifications/ });
    expect(region).toHaveAttribute("aria-live", "polite");
    expect(region).toHaveAttribute("aria-atomic", "false");
  });

  it("bez wskazanego motywu rysuje powiadomienia w motywie jasnym, z kierunkiem ltr", async () => {
    render(<Toaster />);
    const list = await showToast();
    expect(list).toHaveAttribute("data-sonner-theme", "light");
    expect(list).toHaveAttribute("dir", "ltr");
    expect(list).toHaveClass("toaster", "group");
  });

  it("w motywie ciemnym oznacza listę ciemnym motywem biblioteki", async () => {
    render(<Toaster theme="dark" />);
    const list = await showToast();
    expect(list).toHaveAttribute("data-sonner-theme", "dark");
  });

  it("w motywie systemowym idzie za ciemną preferencją systemu", async () => {
    stubColorScheme("dark");
    render(<Toaster theme="system" />);
    const list = await showToast();
    expect(list).toHaveAttribute("data-sonner-theme", "dark");
  });

  it("w motywie systemowym idzie za jasną preferencją systemu", async () => {
    stubColorScheme("light");
    render(<Toaster theme="system" />);
    const list = await showToast();
    expect(list).toHaveAttribute("data-sonner-theme", "light");
  });

  it("nadaje toastowi, opisowi i przyciskom kolory z tokenów wspólnych dla obu motywów", async () => {
    render(<Toaster theme="dark" />);
    const list = await showToast();
    const item = list.querySelector("li[data-sonner-toast]");
    expect(item).toHaveClass(
      "toast",
      "group-[.toaster]:bg-background",
      "group-[.toaster]:text-foreground",
      "group-[.toaster]:border-border",
    );
    expect(screen.getByText("Wersja robocza jest aktualna.")).toHaveClass(
      "group-[.toast]:text-muted-foreground",
    );
    expect(screen.getByRole("button", { name: "Cofnij" })).toHaveClass(
      "group-[.toast]:bg-primary",
      "group-[.toast]:text-primary-foreground",
    );
    expect(screen.getByRole("button", { name: "Zamknij" })).toHaveClass(
      "group-[.toast]:bg-muted",
      "group-[.toast]:text-muted-foreground",
    );
  });

  it("przenosi ognisko na listę powiadomień skrótem Alt+T", async () => {
    render(<Toaster />);
    const list = await showToast();
    fireEvent.keyDown(document, { key: "t", code: "KeyT", altKey: true });
    expect(list).toHaveFocus();
  });

  it("pozwala wywołującemu nadpisać ustawienia domyślne, np. położenie", async () => {
    render(<Toaster position="top-center" />);
    const list = await showToast();
    expect(list).toHaveAttribute("data-y-position", "top");
    expect(list).toHaveAttribute("data-x-position", "center");
  });
});
