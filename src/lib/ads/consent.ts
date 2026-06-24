// Minimalny mechanizm zgody marketingowej (RODO).
// Wartość trzymamy w localStorage; gdy brak — reklamy wymagające zgody nie są ładowane.
// W przyszłości można podpiąć pełny CMP (Cookiebot, Klaro).

import { useEffect, useState } from "react";

const STORAGE_KEY = "consent:marketing";
const EVENT = "consent-change";

export function getMarketingConsent(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(STORAGE_KEY) === "granted";
}

export function setMarketingConsent(granted: boolean) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, granted ? "granted" : "denied");
  window.dispatchEvent(new Event(EVENT));
}

export function clearMarketingConsent() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(STORAGE_KEY);
  window.dispatchEvent(new Event(EVENT));
}

export function hasMarketingDecision(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(STORAGE_KEY) !== null;
}

export function useMarketingConsent() {
  const [granted, setGranted] = useState<boolean>(() => getMarketingConsent());
  const [decided, setDecided] = useState<boolean>(() => hasMarketingDecision());

  useEffect(() => {
    const sync = () => {
      setGranted(getMarketingConsent());
      setDecided(hasMarketingDecision());
    };
    window.addEventListener(EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  return { granted, decided, grant: () => setMarketingConsent(true), deny: () => setMarketingConsent(false) };
}
