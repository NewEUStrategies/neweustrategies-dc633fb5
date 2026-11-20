// Wyskakujące okienko w aplikacji przy @wzmiance i prośbie o zdanie.
//
// Źródło: ten sam kanał Realtime `notifications` (filtr `user_id=eq.<uid>`),
// którego używa dzwonek - `tableChannelHub` współdzieli jedno gniazdo, więc
// okienko nie kosztuje drugiej subskrypcji, a RLS sprawdza wyłącznie
// właściciela wiersza. Wyciszenia rozstrzyga baza: powiadomienie, którego
// rodzaj odbiorca wyłączył, w ogóle nie powstaje, więc okienka też nie ma.
//
// Montaż: `WorkspaceDock` (zalogowany członek, poza /admin i /login, raz na
// sesję). Jedno okienko na powiadomienie (`signal:<id>`), 8 s, akcja
// „Otwórz" przechodzi do dyskusji i oznacza powiadomienie jako przeczytane.
import { useEffect, useRef } from "react";
import { toast } from "sonner";
import i18n from "@/lib/i18n";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { subscribeToTable } from "@/lib/realtime/tableChannelHub";
import { signalToastFromRow, type SignalNotificationRow } from "./signalToast";

const SIGNAL_TOAST_DURATION_MS = 8000;

async function markRead(notificationId: string): Promise<void> {
  const { error } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", notificationId)
    .is("read_at", null);
  if (error) console.warn("[notifications] mark read from toast failed", error.message);
}

export function useIncomingSignalToasts(enabled: boolean, onOpen: (href: string) => void): void {
  const { user } = useAuth();
  const uid = user?.id;
  const onOpenRef = useRef(onOpen);
  onOpenRef.current = onOpen;

  useEffect(() => {
    if (!uid || !enabled) return;
    const shown = new Set<string>();
    const unsubscribe = subscribeToTable(
      { table: "notifications", filter: `user_id=eq.${uid}` },
      (payload) => {
        // Kanał jest wspólny z dzwonkiem - wyjątek okienka nie może zabrać
        // dzwonkowi odświeżenia, więc nic stąd nie wychodzi.
        try {
          if (payload.eventType !== "INSERT") return;
          const content = signalToastFromRow({
            row: payload.new as SignalNotificationRow,
            userId: uid,
            lang: i18n.language === "en" ? "en" : "pl",
            nowMs: Date.now(),
          });
          if (!content || shown.has(content.toastId)) return;
          shown.add(content.toastId);
          const href = content.href;
          toast(content.title, {
            id: content.toastId,
            ...(content.description ? { description: content.description } : {}),
            duration: SIGNAL_TOAST_DURATION_MS,
            ...(href
              ? {
                  action: {
                    label: i18n.t("notifications.signalToast.open"),
                    onClick: () => {
                      void markRead(content.notificationId);
                      onOpenRef.current(href);
                    },
                  },
                }
              : {}),
          });
        } catch (error) {
          if (typeof reportError === "function") reportError(error);
        }
      },
    );
    return () => {
      unsubscribe();
      for (const id of shown) toast.dismiss(id);
      shown.clear();
    };
  }, [uid, enabled]);
}
