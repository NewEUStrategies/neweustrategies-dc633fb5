// Podgląd typografii na żywo - NADAWCA (panel właściwości i builder):
// rozgłasza typografię widgetu do ramek tej karty i innych kart edytora oraz
// czyści wszystkie podglądy przy cofnij/ponów. Odbiorcę (subskrypcję ramki),
// szablon i kanał opisuje nagłówek `liveTypography.ts`.
//
// OSOBNY MODUŁ, CELOWO (chunk startowy, roadmapa ładowania §9.1 J3).
// `liveTypography.ts` importuje ramka widgetu, więc siedzi w `app-initial`;
// nadawcę (ok. 0,8 KB surowego kodu) woła wyłącznie panel.
// `liveTypography.ts` NIE importuje stąd niczego - także reeksportem.
import type { WidgetTypography } from "./types";
import {
  CHANNEL_NAME,
  EVENT_NAME,
  STORAGE_PREFIX,
  STYLE_ID_PREFIX,
  applyLiveTypographyStyle,
  liveStyleRevision,
  storageKey,
  type WidgetTypographyLivePayload,
} from "./liveTypography";

export function broadcastWidgetTypography(
  widgetId: string,
  typography: WidgetTypography | undefined,
): void {
  if (typeof window === "undefined") return;
  const payload: WidgetTypographyLivePayload = { widgetId, typography, updatedAt: Date.now() };

  applyLiveTypographyStyle(widgetId, typography);

  window.dispatchEvent(
    new CustomEvent<WidgetTypographyLivePayload>(EVENT_NAME, { detail: payload }),
  );

  try {
    if (typography === undefined) window.sessionStorage.removeItem(storageKey(widgetId));
    else window.sessionStorage.setItem(storageKey(widgetId), JSON.stringify(payload));
  } catch {
    // sessionStorage can be disabled - live same-document updates still work.
  }

  if (typeof BroadcastChannel === "undefined") return;
  try {
    const channel = new BroadcastChannel(CHANNEL_NAME);
    channel.postMessage(payload);
    channel.close();
  } catch {
    // BroadcastChannel is best-effort; React state update remains authoritative.
  }
}

/**
 * Drop every live typography override (same-document): removes the injected
 * <style> nodes + sessionStorage snapshots and notifies subscribers with
 * `undefined` so widgets fall back to the DOCUMENT's typography.
 *
 * Needed around undo/redo: the live broadcast otherwise shadows the restored
 * document value and the canvas visibly "ignores" the undo.
 */
export function clearAllLiveWidgetTypography(): void {
  if (typeof window === "undefined") return;
  const widgetIds = new Set<string>();
  try {
    for (let i = window.sessionStorage.length - 1; i >= 0; i--) {
      const key = window.sessionStorage.key(i);
      if (key && key.startsWith(STORAGE_PREFIX)) {
        widgetIds.add(key.slice(STORAGE_PREFIX.length));
        window.sessionStorage.removeItem(key);
      }
    }
  } catch {
    // sessionStorage can be disabled — style/subscriber cleanup still runs.
  }
  if (typeof document !== "undefined") {
    document.querySelectorAll(`style[id^="${STYLE_ID_PREFIX}"]`).forEach((el) => el.remove());
  }
  // Spóźniony generator nie odtworzy usuniętego bloku.
  liveStyleRevision.clear();
  widgetIds.forEach((widgetId) => {
    window.dispatchEvent(
      new CustomEvent<WidgetTypographyLivePayload>(EVENT_NAME, {
        detail: { widgetId, typography: undefined, updatedAt: Date.now() },
      }),
    );
  });
}
