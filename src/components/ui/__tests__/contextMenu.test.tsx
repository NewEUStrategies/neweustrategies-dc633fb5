// ContextMenu to menu pod prawym przyciskiem (Radix). Kontrakt dostępności:
// rola `menu` z pozycjami `menuitem` / `menuitemcheckbox` / `menuitemradio`
// i `aria-checked`, separator z rolą `separator`, podmenu ogłaszane przez
// `aria-haspopup="menu"` i `aria-expanded`. Klawiatura: strzałki chodzą po
// pozycjach z pominięciem wyłączonych, strzałka w prawo otwiera podmenu
// i wchodzi do niego, w lewo z niego wychodzi, Enter wybiera, Escape zamyka.
// Wariant `destructive` i wcięcie `inset` to gałęzie opakowania. Kolory idą
// z tokenów `popover`/`accent`/`destructive`, wspólnych dla motywów.
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuPortal,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "../context-menu";
import { axeViolations } from "@/test/axe";

// Radix zdejmuje zakres ogniska odmontowanego menu dopiero w następnym takcie
// i wtedy oddaje ognisko poprzedniemu elementowi. Gdy test kończy się z otwartym
// menu, ten spóźniony ruch ogniska trafiałby w podmenu NASTĘPNEGO testu i je
// zamykał, więc po sprzątnięciu czekam na ten takt.
afterEach(async () => {
  cleanup();
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
});

function Sample({
  onCopy,
  onDelete,
  onOpenChange,
}: {
  onCopy?: () => void;
  onDelete?: () => void;
  onOpenChange?: (open: boolean) => void;
}) {
  const [pinned, setPinned] = useState(false);
  const [density, setDensity] = useState("comfortable");
  return (
    <ContextMenu onOpenChange={onOpenChange}>
      <ContextMenuTrigger data-testid="obszar">Blok treści</ContextMenuTrigger>
      <ContextMenuContent className="w-64">
        <ContextMenuLabel>Blok</ContextMenuLabel>
        <ContextMenuGroup>
          <ContextMenuItem onSelect={onCopy}>
            Kopiuj
            <ContextMenuShortcut>Ctrl+C</ContextMenuShortcut>
          </ContextMenuItem>
          <ContextMenuItem disabled>Wklej</ContextMenuItem>
          <ContextMenuItem inset>Duplikuj</ContextMenuItem>
        </ContextMenuGroup>
        <ContextMenuSeparator />
        <ContextMenuCheckboxItem checked={pinned} onCheckedChange={setPinned}>
          Przypnij
        </ContextMenuCheckboxItem>
        <ContextMenuLabel inset>Gęstość</ContextMenuLabel>
        <ContextMenuRadioGroup value={density} onValueChange={setDensity}>
          <ContextMenuRadioItem value="comfortable">Wygodna</ContextMenuRadioItem>
          <ContextMenuRadioItem value="compact">Zwarta</ContextMenuRadioItem>
        </ContextMenuRadioGroup>
        <ContextMenuSub>
          <ContextMenuSubTrigger inset>Przenieś do</ContextMenuSubTrigger>
          <ContextMenuPortal>
            <ContextMenuSubContent>
              <ContextMenuItem>Kolumna lewa</ContextMenuItem>
              <ContextMenuItem>Kolumna prawa</ContextMenuItem>
            </ContextMenuSubContent>
          </ContextMenuPortal>
        </ContextMenuSub>
        <ContextMenuSeparator />
        <ContextMenuItem variant="destructive" onSelect={onDelete}>
          Usuń
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

function openMenu() {
  fireEvent.contextMenu(screen.getByTestId("obszar"), { clientX: 40, clientY: 40 });
  return screen.getByRole("menu");
}

const item = (name: string) => screen.getByRole("menuitem", { name });

/** Klawisz w menu. Radix przenosi ognisko po pozycjach w `setTimeout`, więc takt opróżniam w `act`. */
async function press(element: HTMLElement, key: string) {
  fireEvent.keyDown(element, { key });
  await act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
}

describe("ContextMenu", () => {
  it("otwiera menu prawym przyciskiem i oznacza obszar jako otwarty", () => {
    const onOpenChange = vi.fn();
    render(<Sample onOpenChange={onOpenChange} />);
    const area = screen.getByTestId("obszar");
    expect(area).toHaveAttribute("data-state", "closed");
    expect(screen.queryByRole("menu")).toBeNull();
    const menu = openMenu();
    expect(onOpenChange).toHaveBeenLastCalledWith(true);
    expect(area).toHaveAttribute("data-state", "open");
    expect(menu).toHaveAttribute("data-state", "open");
    expect(menu).toHaveAttribute("aria-orientation", "vertical");
  });

  it("wystawia pozycje z rolami menu, zaznaczeniem i separatorami", () => {
    render(<Sample />);
    openMenu();
    expect(screen.getAllByRole("menuitem").map((el) => el.textContent)).toEqual([
      "KopiujCtrl+C",
      "Wklej",
      "Duplikuj",
      "Przenieś do",
      "Usuń",
    ]);
    const pin = screen.getByRole("menuitemcheckbox", { name: "Przypnij" });
    expect(pin).toHaveAttribute("aria-checked", "false");
    expect(screen.getByRole("menuitemradio", { name: "Wygodna" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByRole("menuitemradio", { name: "Zwarta" })).toHaveAttribute(
      "aria-checked",
      "false",
    );
    expect(screen.getAllByRole("separator")).toHaveLength(2);
    const [actions, densityGroup] = screen.getAllByRole("group");
    expect(actions).toContainElement(item("Kopiuj Ctrl+C"));
    expect(densityGroup).toContainElement(screen.getByRole("menuitemradio", { name: "Zwarta" }));
    expect(item("Wklej")).toHaveAttribute("aria-disabled", "true");
    expect(item("Wklej")).toHaveAttribute("data-disabled", "");
  });

  it("przenosi ognisko strzałkami z pominięciem pozycji wyłączonej", async () => {
    render(<Sample />);
    const menu = openMenu();
    await waitFor(() => expect(menu).toHaveFocus());
    await press(menu, "ArrowDown");
    expect(item("Kopiuj Ctrl+C")).toHaveFocus();
    await press(item("Kopiuj Ctrl+C"), "ArrowDown");
    expect(item("Duplikuj")).toHaveFocus();
    await press(item("Duplikuj"), "ArrowDown");
    expect(screen.getByRole("menuitemcheckbox", { name: "Przypnij" })).toHaveFocus();
  });

  it("wybiera pozycję klawiszem Enter i zamyka menu", async () => {
    const onCopy = vi.fn();
    const onOpenChange = vi.fn();
    render(<Sample onCopy={onCopy} onOpenChange={onOpenChange} />);
    const menu = openMenu();
    await press(menu, "ArrowDown");
    await press(item("Kopiuj Ctrl+C"), "Enter");
    expect(onCopy).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
  });

  it("zamyka menu klawiszem Escape bez wybierania pozycji", async () => {
    const onCopy = vi.fn();
    render(<Sample onCopy={onCopy} />);
    const menu = openMenu();
    await press(menu, "Escape");
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    expect(onCopy).not.toHaveBeenCalled();
    expect(screen.getByTestId("obszar")).toHaveAttribute("data-state", "closed");
  });

  it("pozycja wyłączona nie wywołuje akcji po kliknięciu", () => {
    render(<Sample />);
    openMenu();
    fireEvent.click(item("Wklej"));
    expect(screen.getByRole("menu")).toBeInTheDocument();
  });

  it("przełącza pozycję wyboru i pokazuje znacznik dopiero po zaznaczeniu", async () => {
    render(<Sample />);
    openMenu();
    const pin = screen.getByRole("menuitemcheckbox", { name: "Przypnij" });
    expect(pin.querySelector("svg")).toBeNull();
    fireEvent.click(pin);
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    openMenu();
    const pinned = screen.getByRole("menuitemcheckbox", { name: "Przypnij" });
    expect(pinned).toHaveAttribute("aria-checked", "true");
    expect(pinned.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });

  it("przełącza opcję w grupie jednokrotnego wyboru", async () => {
    render(<Sample />);
    openMenu();
    const wygodna = screen.getByRole("menuitemradio", { name: "Wygodna" });
    expect(wygodna.querySelector("svg")).toHaveClass("fill-current");
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Zwarta" }));
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    openMenu();
    expect(screen.getByRole("menuitemradio", { name: "Zwarta" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByRole("menuitemradio", { name: "Wygodna" })).toHaveAttribute(
      "aria-checked",
      "false",
    );
  });

  it("otwiera podmenu strzałką w prawo, wchodzi do niego i wraca strzałką w lewo", async () => {
    render(<Sample />);
    openMenu();
    const subTrigger = item("Przenieś do");
    expect(subTrigger).toHaveAttribute("aria-haspopup", "menu");
    expect(subTrigger).toHaveAttribute("aria-expanded", "false");
    expect(subTrigger.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    act(() => subTrigger.focus());
    await press(subTrigger, "ArrowRight");
    expect(subTrigger).toHaveAttribute("aria-expanded", "true");
    const menus = screen.getAllByRole("menu");
    expect(menus).toHaveLength(2);
    const sub = menus[1];
    expect(subTrigger).toHaveAttribute("aria-controls", sub.id);
    await waitFor(() => expect(item("Kolumna lewa")).toHaveFocus());
    await press(item("Kolumna lewa"), "ArrowLeft");
    await waitFor(() => expect(screen.getAllByRole("menu")).toHaveLength(1));
    expect(subTrigger).toHaveFocus();
    expect(subTrigger).toHaveAttribute("aria-expanded", "false");
  });

  it("wyróżnia pozycję destrukcyjną kolorem tokenu ostrzegawczego", () => {
    const onDelete = vi.fn();
    render(<Sample onDelete={onDelete} />);
    openMenu();
    const remove = item("Usuń");
    expect(remove).toHaveClass("text-destructive", "focus:bg-destructive/10");
    expect(item("Duplikuj")).not.toHaveClass("text-destructive");
    expect(item("Duplikuj")).toHaveClass("focus:bg-accent", "focus:text-accent-foreground");
    fireEvent.click(remove);
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it("wcina pozycję, etykietę i wyzwalacz podmenu tylko z flagą inset", () => {
    render(<Sample />);
    openMenu();
    expect(item("Duplikuj")).toHaveClass("pl-8");
    expect(item("Kopiuj Ctrl+C")).not.toHaveClass("pl-8");
    expect(item("Przenieś do")).toHaveClass("pl-8", "data-[state=open]:bg-accent");
    expect(screen.getByText("Gęstość")).toHaveClass("pl-8", "uppercase", "text-muted-foreground");
    expect(screen.getByText("Blok")).not.toHaveClass("pl-8");
  });

  it("rysuje menu, podmenu, separator i skrót tokenami motywu", async () => {
    render(<Sample />);
    const menu = openMenu();
    expect(menu).toHaveClass("w-64", "bg-popover", "text-popover-foreground", "shadow-xl");
    expect(screen.getAllByRole("separator")[0]).toHaveClass("h-px", "bg-border/60");
    expect(screen.getByText("Ctrl+C")).toHaveClass("ml-auto", "text-muted-foreground");
    const subTrigger = item("Przenieś do");
    act(() => subTrigger.focus());
    await press(subTrigger, "ArrowRight");
    const sub = screen.getAllByRole("menu")[1];
    expect(sub).toHaveClass("bg-popover", "text-popover-foreground", "shadow-lg", "min-w-[10rem]");
  });

  it("przechodzi audyt dostępności axe w stanie otwartym", async () => {
    render(<Sample />);
    const menu = openMenu();
    // Pozycjonowanie warstwy kończy się asynchronicznie; domykam je przed audytem.
    await act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
    expect(await axeViolations(menu)).toEqual([]);
  });
});
