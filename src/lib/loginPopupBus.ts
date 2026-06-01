// Global bus for opening the login popup from anywhere, optionally with
// custom title/description for "restricted action" contexts (bookmarks, follows).
export type LoginPopupMode = "signin" | "signup";

export interface LoginPopupOptions {
  mode?: LoginPopupMode;
  title?: string;
  description?: string;
}

const EVENT = "lovable:open-login";

export function openLoginPopup(arg?: LoginPopupMode | LoginPopupOptions) {
  if (typeof window === "undefined") return;
  const opts: LoginPopupOptions =
    typeof arg === "string" ? { mode: arg } : (arg ?? {});
  window.dispatchEvent(new CustomEvent<LoginPopupOptions>(EVENT, { detail: opts }));
}

export function onOpenLoginPopup(handler: (opts: LoginPopupOptions) => void) {
  if (typeof window === "undefined") return () => {};
  const listener = (e: Event) => handler((e as CustomEvent<LoginPopupOptions>).detail ?? {});
  window.addEventListener(EVENT, listener);
  return () => window.removeEventListener(EVENT, listener);
}
