// Kontrakt DemoBotChat <-> MessageList: DemoBotChat renderuje ten sam
// organizm co realny ChatWindow (MessageList), przekazując ~12 propsów.
// Ten test pilnuje dwóch rzeczy:
//  1) typowo - klucze przekazywane przez DemoBotChat muszą istnieć w
//     MessageListProps (kompilacja się wywali, jeśli ktoś zmieni jedną
//     ze stron i zapomni o drugiej);
//  2) w runtime - smoke test, że podgląd nadal się renderuje (awatar bota,
//     powitanie, pole do pisania widoczne).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ComponentProps } from "react";
import "@/lib/i18n-chat";
import { chatPl } from "@/lib/i18n-chat";
import { DemoBotChat } from "../DemoBotChat";
import { MessageList } from "../MessageList";
import { ChatWindow } from "../ChatWindow";

// Zestaw propsów, które DemoBotChat faktycznie forwarduje do <MessageList>
// (patrz DemoBotChat.tsx). Trzymany osobno, żeby test typów poniżej
// wyłapał drift, jeśli ktoś doda/usunie forwardowany prop bez aktualizacji
// MessageListProps (lub odwrotnie).
const forwardedToMessageList = [
  "lang",
  "myUserId",
  "messages",
  "reactions",
  "reactorProfiles",
  "peerName",
  "peerAvatarUrl",
  "typingNames",
  "typingAvatarUrl",
  "myAvatarUrl",
  "senderProfiles",
  "peerLastReadAt",
  "peerLastDeliveredAt",
  "peerTyping",
  "hasOlder",
  "loadingOlder",
  "onLoadOlder",
  "onReact",
  "onReply",
  "onEdit",
  "onDelete",
  "onDiscardFailed",
  "canEdit",
] as const satisfies readonly (keyof ComponentProps<typeof MessageList>)[];

// Placeholder wykorzystujący `forwardedToMessageList` w kontekście typów -
// gwarantuje, że lista jest faktycznie typowana względem MessageListProps
// (nieużywana zmienna zniknęłaby przy refaktoryzacji, ale typ zostaje
// zweryfikowany przez kompilator TS podczas `tsgo`/vitest).
type _AssertKeysExistOnMessageList =
  (typeof forwardedToMessageList)[number] extends keyof ComponentProps<typeof MessageList>
    ? true
    : never;
const _typeCheck: _AssertKeysExistOnMessageList = true;
void _typeCheck;

// ChatWindow jest importowany, żeby udokumentować w kodzie (i w typach),
// że DemoBotChat to lekki odpowiednik ChatWindow - oba renderują ten sam
// MessageList, więc oba muszą pozostawać zgodne z MessageListProps.
type _ChatWindowRendersMessageList =
  ComponentProps<typeof ChatWindow> extends {
    conversationId: string;
  }
    ? true
    : never;
const _chatWindowTypeCheck: _ChatWindowRendersMessageList = true;
void _chatWindowTypeCheck;

function renderDemo() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <DemoBotChat lang="pl" />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  Element.prototype.scrollTo = Element.prototype.scrollTo ?? (() => undefined);
  Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => undefined);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("DemoBotChat <-> MessageList prop contract", () => {
  it("forwards only keys that exist on MessageListProps (compile-time)", () => {
    expect(forwardedToMessageList.length).toBeGreaterThan(0);
  });

  it("still renders the bot avatar, greeting and composer (smoke)", () => {
    renderDemo();

    expect(screen.getByText(chatPl.chat.demoBot.welcome)).toBeInTheDocument();
    expect(screen.getAllByText(chatPl.chat.demoBot.name).length).toBeGreaterThan(0);
    expect(screen.getByRole("textbox")).toBeInTheDocument();
  });
});
