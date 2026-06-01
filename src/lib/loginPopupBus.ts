// Simple global bus for opening the login popup from anywhere.
type Mode = "signin" | "signup";

const EVENT = "lovable:open-login";

export function openLoginPopup(mode: Mode = "signin") {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<Mode>(EVENT, { detail: mode }));
}

export function onOpenLoginPopup(handler: (mode: Mode) => void) {
  if (typeof window === "undefined") return () => {};
  const listener = (e: Event) => handler((e as CustomEvent<Mode>).detail ?? "signin");
  window.addEventListener(EVENT, listener);
  return () => window.removeEventListener(EVENT, listener);
}
