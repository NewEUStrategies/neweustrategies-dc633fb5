// Klient Web Push: rejestracja service workera, subskrypcja PushManagera
// i zapis kluczy do push_subscriptions (RLS owner-only). Wołane wyłącznie
// z ustawień powiadomień - nigdy automatycznie (permission prompt na żądanie).
import { supabase } from "@/integrations/supabase/client";

const SW_PATH = "/push-sw.js";

export function isPushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

export function vapidPublicKey(): string | null {
  const key = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined;
  return key && key.length > 0 ? key : null;
}

function b64urlToUint8(base64url: string): Uint8Array {
  const base64 = base64url.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob(padded);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function subscriptionKeys(sub: PushSubscription): { p256dh: string; auth: string } | null {
  const json = sub.toJSON();
  const p256dh = json.keys?.p256dh;
  const auth = json.keys?.auth;
  if (!p256dh || !auth) return null;
  return { p256dh, auth };
}

/**
 * Włącza push w TEJ przeglądarce: permission -> SW -> subscribe -> zapis w DB.
 * Rzuca Error z czytelnym komunikatem, gdy użytkownik odmówi lub brak wsparcia.
 */
export async function enablePushForThisBrowser(userId: string): Promise<void> {
  if (!isPushSupported()) {
    throw new Error("push_unsupported");
  }
  const publicKey = vapidPublicKey();
  if (!publicKey) {
    throw new Error("push_not_configured");
  }

  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    throw new Error("push_denied");
  }

  const registration = await navigator.serviceWorker.register(SW_PATH);
  await navigator.serviceWorker.ready;

  const existing = await registration.pushManager.getSubscription();
  const sub =
    existing ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: b64urlToUint8(publicKey).buffer as ArrayBuffer,
    }));

  const keys = subscriptionKeys(sub);
  if (!keys) {
    throw new Error("push_bad_subscription");
  }

  const { error } = await supabase.from("push_subscriptions").upsert(
    {
      user_id: userId,
      endpoint: sub.endpoint,
      p256dh: keys.p256dh,
      auth: keys.auth,
      user_agent: navigator.userAgent.slice(0, 250),
      last_seen_at: new Date().toISOString(),
      failed_at: null,
    },
    { onConflict: "endpoint" },
  );
  if (error) throw error;
}

/** Wyłącza push w TEJ przeglądarce i usuwa jej subskrypcję z DB. */
export async function disablePushForThisBrowser(): Promise<void> {
  if (!isPushSupported()) return;
  const registration = await navigator.serviceWorker.getRegistration(SW_PATH);
  const sub = await registration?.pushManager.getSubscription();
  if (sub) {
    await supabase.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
    await sub.unsubscribe().catch(() => undefined);
  }
}
