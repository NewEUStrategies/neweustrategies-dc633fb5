// Konfiguracja Web Push dla klienta. Klucz publiczny VAPID nie jest tajny,
// ale wystawiamy go przez server fn (auth), żeby klient nie zależał od
// wstrzykiwania env do bundla i żeby móc zwrócić null == "kanał wyłączony".
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const getPushConfig = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async (): Promise<{ publicKey: string | null }> => {
    const { vapidPublicKey, isWebPushConfigured } = await import("@/lib/server/webPush.server");
    return { publicKey: isWebPushConfigured() ? vapidPublicKey() : null };
  });
