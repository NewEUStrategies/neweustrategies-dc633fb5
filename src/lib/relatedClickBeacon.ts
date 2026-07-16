// Fire-and-forget beacon: kliknięcia w rekomendacje trafiają do
// `related_post_clicks`. Używamy `navigator.sendBeacon` żeby nie blokować
// nawigacji ani nie tworzyć wyścigu z routingiem SPA.
export function trackRelatedClick(sourcePostId: string, targetPostId: string): void {
  try {
    if (typeof navigator === "undefined") return;
    const payload = JSON.stringify({ sourcePostId, targetPostId });
    const url = "/api/public/related-click";
    const blob = new Blob([payload], { type: "application/json" });
    if (typeof navigator.sendBeacon === "function") {
      navigator.sendBeacon(url, blob);
      return;
    }
    // Fallback - keepalive fetch (nie awaitujemy, klik nie może być blokowany)
    void fetch(url, {
      method: "POST",
      body: payload,
      headers: { "Content-Type": "application/json" },
      keepalive: true,
    }).catch(() => undefined);
  } catch {
    // silent - beacon jest opcjonalny, nie może psuć UX
  }
}
