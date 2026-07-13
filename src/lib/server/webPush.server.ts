// Web Push (VAPID) - cienka warstwa nad pakietem `web-push`, wyłącznie
// server-side. Klucze z env:
//   VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY  (wygeneruj: `bunx web-push generate-vapid-keys`)
//   VAPID_SUBJECT                          (mailto:... lub https://..., opcjonalny)
// Bez skonfigurowanych kluczy kanał push jest wyłączony: UI ukrywa przełącznik
// (getPushConfig zwraca publicKey=null), a tick pomija outbox.
export interface PushSubscriptionKeys {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export function vapidPublicKey(): string | null {
  const key = process.env.VAPID_PUBLIC_KEY?.trim();
  return key && key.length > 0 ? key : null;
}

export function isWebPushConfigured(): boolean {
  return !!vapidPublicKey() && !!process.env.VAPID_PRIVATE_KEY?.trim();
}

export type PushSendResult = { ok: true } | { ok: false; gone: boolean; error: string };

/**
 * Wysyła jedno powiadomienie push. `gone=true` (404/410 z push service)
 * oznacza martwą subskrypcję - wołający powinien ją dezaktywować.
 */
export async function sendWebPush(
  sub: PushSubscriptionKeys,
  payload: unknown,
): Promise<PushSendResult> {
  if (!isWebPushConfigured()) return { ok: false, gone: false, error: "push_not_configured" };
  const { default: webpush } = await import("web-push");
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT?.trim() || "mailto:office@neweuropeanstrategies.com",
    process.env.VAPID_PUBLIC_KEY!.trim(),
    process.env.VAPID_PRIVATE_KEY!.trim(),
  );
  try {
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      JSON.stringify(payload),
      { TTL: 24 * 60 * 60 },
    );
    return { ok: true };
  } catch (err) {
    const statusCode =
      err && typeof err === "object" && "statusCode" in err
        ? Number((err as { statusCode: unknown }).statusCode)
        : 0;
    return {
      ok: false,
      gone: statusCode === 404 || statusCode === 410,
      error: err instanceof Error ? err.message.slice(0, 300) : String(err).slice(0, 300),
    };
  }
}
