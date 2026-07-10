// Global bus for opening chat windows from anywhere (people search, profile
// cards, header droplist) without prop-drilling through the layout tree.
// Mirrors the loginPopupBus pattern.
export interface OpenChatRequest {
  conversationId: string;
  /** Focus the composer right away (default true). */
  focus?: boolean;
}

const EVENT = "nes:open-chat";

export function openChatWindow(request: OpenChatRequest) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<OpenChatRequest>(EVENT, { detail: request }));
}

export function onOpenChatWindow(handler: (request: OpenChatRequest) => void) {
  if (typeof window === "undefined") return () => {};
  const listener = (e: Event) => {
    const detail = (e as CustomEvent<OpenChatRequest>).detail;
    if (detail?.conversationId) handler(detail);
  };
  window.addEventListener(EVENT, listener);
  return () => window.removeEventListener(EVENT, listener);
}
