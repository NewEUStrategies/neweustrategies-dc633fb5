// Klient telemetrii popupu newslettera.
//
// Sesja żyje w sessionStorage, żeby dało się połączyć impression -> submit ->
// success w obrębie jednej wizyty bez cookie i bez identyfikatora osoby.
// Wysyłka jest fire-and-forget: żaden błąd telemetrii nie może zablokować
// zapisu do newslettera.
import {
  logNewsletterPopupEvent,
  type NewsletterPopupEventName,
} from "@/lib/newsletter-popup-events.functions";

const SESSION_KEY = "nes:nl-popup-session";

export function newsletterPopupSessionId(): string {
  if (typeof window === "undefined") return "ssr";
  try {
    const existing = window.sessionStorage.getItem(SESSION_KEY);
    if (existing) return existing;
    const fresh =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `s-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    window.sessionStorage.setItem(SESSION_KEY, fresh);
    return fresh;
  } catch {
    return "no-storage";
  }
}

export interface PopupEventPayload {
  event: NewsletterPopupEventName;
  lang: "pl" | "en";
  layout?: string;
  source?: string;
  variant?: string;
  errorCode?: string;
  meta?: Record<string, string>;
}

export function trackNewsletterPopupEvent(payload: PopupEventPayload): void {
  if (typeof window === "undefined") return;
  void logNewsletterPopupEvent({
    data: { ...payload, sessionId: newsletterPopupSessionId() },
  }).catch(() => {
    /* telemetria nie może psuć UX */
  });
}
