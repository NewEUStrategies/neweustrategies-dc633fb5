// Części wyekstrahowane z `ChatWindow` - testowane W IZOLACJI, bez warstwy
// danych i bez organizmu. To jest cała stawka refaktoru: te same reguły były
// wcześniej sprawdzalne wyłącznie przez wyrenderowanie okna czatu z sesją,
// tenantem, kanałem realtime i kompozytorem.
//
// Każdy blok pilnuje jednej rzeczy, która w powtórzonym JSX-ie ginie:
//   ChatIconButton      - kontrakt a11y (aria-pressed TYLKO dla przełączników),
//   ChatWindowHeader    - RÓŻNICE między wariantami, nie ich podobieństwo,
//   ChatConfirmDialog   - potwierdzenie ma wyjście bez potwierdzania,
//   BlockedComposerNotice - blokada mutacji w locie.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Images, Minus, Search } from "lucide-react";
import "@/lib/i18n-chat";
import { chatPl } from "@/lib/i18n-chat";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { HeaderSubtitle } from "@/lib/chat/thread";

vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  Link: (await import("@/test/routerLinkStub")).RouterLinkStub,
}));

import { BlockedComposerNotice } from "../BlockedComposerNotice";
import { ChatConfirmDialog } from "../ChatConfirmDialog";
import {
  CHAT_ICON_BUTTON_CLASS,
  CHAT_ICON_BUTTON_PRESSED_CLASS,
  ChatIconButton,
} from "../ChatIconButton";
import { ChatWindowHeader, type ChatWindowHeaderProps } from "../ChatWindowHeader";

function withTooltips(ui: React.ReactElement) {
  return render(<TooltipProvider delayDuration={0}>{ui}</TooltipProvider>);
}

afterEach(() => cleanup());

describe("ChatIconButton", () => {
  it("przycisk PRZEŁĄCZAJĄCY ogłasza stan i podświetla tło", () => {
    withTooltips(<ChatIconButton icon={Search} label="Szukaj" onClick={() => {}} pressed={true} />);
    const button = screen.getByRole("button", { name: "Szukaj" });
    expect(button.getAttribute("aria-pressed")).toBe("true");
    expect(button.className).toContain(CHAT_ICON_BUTTON_PRESSED_CLASS);
  });

  it("przycisk AKCJI nie udaje stanu, którego nie ma", () => {
    withTooltips(<ChatIconButton icon={Minus} label="Minimalizuj" onClick={() => {}} />);
    const button = screen.getByRole("button", { name: "Minimalizuj" });
    expect(button.hasAttribute("aria-pressed")).toBe(false);
    expect(button.className).toContain(CHAT_ICON_BUTTON_CLASS);
    expect(button.className).not.toContain(CHAT_ICON_BUTTON_PRESSED_CLASS);
  });

  it("ikona jest dekoracją - etykieta niesie znaczenie", () => {
    withTooltips(<ChatIconButton icon={Images} label="Media" onClick={() => {}} />);
    const icon = screen.getByRole("button", { name: "Media" }).querySelector("svg");
    expect(icon?.getAttribute("aria-hidden")).toBe("true");
  });

  it("deklaruje `aria-haspopup`, gdy otwiera menu", () => {
    withTooltips(<ChatIconButton icon={Search} label="Menu" onClick={() => {}} hasPopup="menu" />);
    expect(screen.getByRole("button", { name: "Menu" }).getAttribute("aria-haspopup")).toBe("menu");
  });

  it("woła akcję na kliknięciu", () => {
    const onClick = vi.fn();
    withTooltips(<ChatIconButton icon={Search} label="Szukaj" onClick={onClick} />);
    fireEvent.click(screen.getByRole("button", { name: "Szukaj" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

describe("ChatWindowHeader", () => {
  const directSubtitle: HeaderSubtitle = { kind: "direct", online: false };

  function headerProps(overrides: Partial<ChatWindowHeaderProps> = {}): ChatWindowHeaderProps {
    return {
      variant: "page",
      name: "Anna Nowak",
      avatarUrl: null,
      slug: null,
      isGroup: false,
      peerOnline: false,
      subtitle: directSubtitle,
      muted: false,
      pinned: false,
      onOpenGroupInfo: () => {},
      actions: <button type="button">akcje</button>,
      ...overrides,
    };
  }

  it("wariant page renderuje pasek div, dock - element header", () => {
    const page = withTooltips(<ChatWindowHeader {...headerProps()} />);
    expect(page.container.querySelector("header")).toBeNull();
    cleanup();

    const dock = withTooltips(<ChatWindowHeader {...headerProps({ variant: "dock" })} />);
    expect(dock.container.querySelector("header")).not.toBeNull();
  });

  it("podtytuł wątku bezpośredniego przełącza online/offline", () => {
    withTooltips(<ChatWindowHeader {...headerProps()} />);
    expect(screen.getByText(chatPl.chat.offline)).toBeTruthy();
    cleanup();

    withTooltips(
      <ChatWindowHeader {...headerProps({ subtitle: { kind: "direct", online: true } })} />,
    );
    expect(screen.getByText(chatPl.chat.online)).toBeTruthy();
  });

  it("podtytuł kręgu podaje liczbę uczestników, a online dokłada dopiero od jedynki", () => {
    withTooltips(
      <ChatWindowHeader
        {...headerProps({
          isGroup: true,
          name: "Krąg energetyczny",
          subtitle: { kind: "group", members: 4, online: 0 },
        })}
      />,
    );
    const withoutOnline = screen.getByText(/4/);
    expect(withoutOnline.textContent).not.toContain("·");
    cleanup();

    withTooltips(
      <ChatWindowHeader
        {...headerProps({
          isGroup: true,
          name: "Krąg energetyczny",
          subtitle: { kind: "group", members: 4, online: 2 },
        })}
      />,
    );
    expect(screen.getByText(/·/).textContent).toContain("2");
  });

  it("przypięcie pokazuje plakietkę w wariancie page, ale NIE w dock (420 px belki)", () => {
    withTooltips(<ChatWindowHeader {...headerProps({ pinned: true, muted: true })} />);
    expect(screen.getByLabelText(chatPl.chat.menu.pinnedBadge)).toBeTruthy();
    expect(screen.getByLabelText(chatPl.chat.menu.mutedBadge)).toBeTruthy();
    cleanup();

    withTooltips(
      <ChatWindowHeader {...headerProps({ variant: "dock", pinned: true, muted: true })} />,
    );
    expect(screen.queryByLabelText(chatPl.chat.menu.pinnedBadge)).toBeNull();
    // Wyciszenie zostaje w OBU wariantach - to informacja o doręczaniu.
    expect(screen.getByLabelText(chatPl.chat.menu.mutedBadge)).toBeTruthy();
  });

  it("krąg w wariancie page ma klikalną tożsamość otwierającą dialog", () => {
    const onOpenGroupInfo = vi.fn();
    withTooltips(
      <ChatWindowHeader {...headerProps({ isGroup: true, name: "Krąg", onOpenGroupInfo })} />,
    );
    const identity = screen.getByRole("button", { name: chatPl.chat.group.info });
    expect(identity.getAttribute("aria-haspopup")).toBe("dialog");
    fireEvent.click(identity);
    expect(onOpenGroupInfo).toHaveBeenCalled();
  });

  it("wątek bezpośredni NIE ma klikalnej tożsamości (nie ma czego otwierać)", () => {
    withTooltips(<ChatWindowHeader {...headerProps()} />);
    expect(screen.queryByRole("button", { name: chatPl.chat.group.info })).toBeNull();
  });

  it("slug zamienia avatar w link do profilu publicznego", () => {
    const { container } = withTooltips(
      <ChatWindowHeader {...headerProps({ slug: "anna-nowak" })} />,
    );
    expect(container.querySelector('a[href="/author/anna-nowak"]')).not.toBeNull();
  });

  it("bez sluga avatar nie jest linkiem", () => {
    const { container } = withTooltips(<ChatWindowHeader {...headerProps()} />);
    expect(container.querySelector('a[href^="/author/"]')).toBeNull();
  });

  it("powrót do listy jest tylko w wariancie page i tylko z handlerem", () => {
    const onBack = vi.fn();
    withTooltips(<ChatWindowHeader {...headerProps({ onBack })} />);
    fireEvent.click(screen.getByRole("button", { name: chatPl.chat.messages }));
    expect(onBack).toHaveBeenCalled();
    cleanup();

    withTooltips(<ChatWindowHeader {...headerProps({ variant: "dock", onBack })} />);
    expect(screen.queryByRole("button", { name: chatPl.chat.messages })).toBeNull();
  });

  it("krąg nie dostaje kropki presence na avatarze, wątek bezpośredni owszem", () => {
    // Liczba online kręgu żyje w podtytule; kropka na avatarze kręgu
    // twierdziłaby, że „krąg jest online", co nie znaczy nic.
    const group = withTooltips(
      <ChatWindowHeader
        {...headerProps({
          variant: "dock",
          isGroup: true,
          peerOnline: true,
          subtitle: { kind: "group", members: 3, online: 3 },
        })}
      />,
    );
    expect(group.container.querySelectorAll("span.bg-emerald-500")).toHaveLength(0);
    cleanup();

    const direct = withTooltips(
      <ChatWindowHeader {...headerProps({ variant: "dock", peerOnline: true })} />,
    );
    expect(direct.container.querySelectorAll("span.bg-emerald-500")).toHaveLength(1);
  });

  it("renderuje slot akcji przekazany przez organizm", () => {
    withTooltips(<ChatWindowHeader {...headerProps()} />);
    expect(screen.getByRole("button", { name: "akcje" })).toBeTruthy();
  });
});

describe("ChatConfirmDialog", () => {
  const props = {
    open: true,
    onOpenChange: () => {},
    title: "Wyczyść historię",
    description: "Zniknie tylko u Ciebie.",
    confirmLabel: "Wyczyść",
    cancelLabel: "Zamknij",
    onConfirm: () => {},
  };

  it("pokazuje tytuł, opis i OBA wyjścia", () => {
    render(<ChatConfirmDialog {...props} />);
    expect(screen.getByText("Wyczyść historię")).toBeTruthy();
    expect(screen.getByText("Zniknie tylko u Ciebie.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Wyczyść" })).toBeTruthy();
    // Potwierdzenie BEZ anulowania to pułapka - operacji nie da się cofnąć.
    expect(screen.getByRole("button", { name: "Zamknij" })).toBeTruthy();
  });

  it("zamknięty nie renderuje niczego", () => {
    render(<ChatConfirmDialog {...props} open={false} />);
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("potwierdzenie woła akcję, anulowanie zgłasza zamknięcie", () => {
    const onConfirm = vi.fn();
    const onOpenChange = vi.fn();
    render(<ChatConfirmDialog {...props} onConfirm={onConfirm} onOpenChange={onOpenChange} />);

    fireEvent.click(screen.getByRole("button", { name: "Wyczyść" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Zamknij" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

describe("BlockedComposerNotice", () => {
  it("nazywa przyczynę i daje jedyną sensowną akcję", () => {
    const onUnblock = vi.fn();
    render(<BlockedComposerNotice onUnblock={onUnblock} pending={false} />);
    expect(screen.getByText(chatPl.chat.block.composerNotice)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: chatPl.chat.block.unblock }));
    expect(onUnblock).toHaveBeenCalledTimes(1);
  });

  it("mutacja w locie BLOKUJE przycisk, nie tylko go przygasza", () => {
    const onUnblock = vi.fn();
    render(<BlockedComposerNotice onUnblock={onUnblock} pending={true} />);
    const button = screen.getByRole("button", { name: chatPl.chat.block.unblock });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(onUnblock).not.toHaveBeenCalled();
  });
});
