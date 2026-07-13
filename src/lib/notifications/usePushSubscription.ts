// Web Push per urządzenie: rejestracja SW + PushManager.subscribe + zapis
// subskrypcji w push_subscriptions (own-row RLS). Obecność aktywnej
// subskrypcji dla bieżącego endpointu == włączony push na TYM urządzeniu;
// wyłączenie odsubskrybowuje przeglądarkę i usuwa wiersz.
import { useCallback, useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { getPushConfig } from "@/lib/notifications/push.functions";

/** applicationServerKey wymaga surowych bajtów klucza (base64url -> Uint8Array). */
export function urlBase64ToUint8Array(base64Url: string): Uint8Array {
  const padding = "=".repeat((4 - (base64Url.length % 4)) % 4);
  const base64 = (base64Url + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function pushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    window.isSecureContext &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

export interface PushSubscriptionState {
  /** Przeglądarka wspiera Web Push (secure context + SW + PushManager). */
  supported: boolean;
  /** Serwer ma skonfigurowane VAPID (publicKey dostępny). */
  configured: boolean;
  /** To urządzenie ma aktywną subskrypcję. */
  enabled: boolean;
  busy: boolean;
  permissionDenied: boolean;
  subscribe: () => Promise<boolean>;
  unsubscribe: () => Promise<void>;
}

export function usePushSubscription(): PushSubscriptionState {
  const { user, tenantId } = useAuth();
  const fetchConfig = useServerFn(getPushConfig);
  const supported = pushSupported();

  const configQ = useQuery({
    queryKey: ["push", "config"],
    queryFn: () => fetchConfig(),
    enabled: !!user && supported,
    staleTime: 10 * 60_000,
  });
  const publicKey = configQ.data?.publicKey ?? null;

  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [permissionDenied, setPermissionDenied] = useState(
    supported && typeof Notification !== "undefined" && Notification.permission === "denied",
  );

  useEffect(() => {
    if (!supported || !user) return;
    let cancelled = false;
    void (async () => {
      try {
        const reg = await navigator.serviceWorker.getRegistration("/sw.js");
        const sub = await reg?.pushManager.getSubscription();
        if (!cancelled) setEnabled(!!sub);
      } catch {
        if (!cancelled) setEnabled(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [supported, user]);

  const subscribe = useCallback(async (): Promise<boolean> => {
    if (!supported || !publicKey || !user || !tenantId) return false;
    setBusy(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setPermissionDenied(permission === "denied");
        return false;
      }
      const reg = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
      const existing = await reg.pushManager.getSubscription();
      const sub =
        existing ??
        (await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey) as unknown as BufferSource,
        }));
      const json = sub.toJSON();
      if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
        await sub.unsubscribe().catch(() => undefined);
        return false;
      }
      // Endpoint jest unikalny globalnie: upsert reaktywuje wiersz po powrocie
      // (np. wcześniej wyłączony po 410) i przepina na bieżącego użytkownika.
      const { error } = await supabase.from("push_subscriptions" as never).upsert(
        {
          user_id: user.id,
          tenant_id: tenantId,
          endpoint: json.endpoint,
          p256dh: json.keys.p256dh,
          auth: json.keys.auth,
          ua: navigator.userAgent.slice(0, 300),
          last_seen_at: new Date().toISOString(),
          disabled_at: null,
        } as never,
        { onConflict: "endpoint" },
      );
      if (error) {
        await sub.unsubscribe().catch(() => undefined);
        return false;
      }
      setEnabled(true);
      return true;
    } catch {
      return false;
    } finally {
      setBusy(false);
    }
  }, [supported, publicKey, user, tenantId]);

  const unsubscribe = useCallback(async (): Promise<void> => {
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.getRegistration("/sw.js");
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        const endpoint = sub.endpoint;
        await sub.unsubscribe().catch(() => undefined);
        await supabase
          .from("push_subscriptions" as never)
          .delete()
          .eq("endpoint", endpoint);
      }
      setEnabled(false);
    } finally {
      setBusy(false);
    }
  }, []);

  return {
    supported,
    configured: !!publicKey,
    enabled,
    busy,
    permissionDenied,
    subscribe,
    unsubscribe,
  };
}
