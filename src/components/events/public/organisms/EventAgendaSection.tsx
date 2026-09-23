// Organizm: PUBLICZNY program wydarzenia - DANE i ZAPIS na sesję.
//
// RYSUNEK NIE STOI TUTAJ. Kompaktową tablicę programu (kolumna pomocnicza,
// zakładki dni, filtr nurtu, bloki sesji rozdzielone linią) rysuje
// `EventAgendaBoardView`, bo TEN SAM rysunek musi pokazać podgląd studia, który
// nie może wołać `event_agenda` (bramka `status = 'published'`) ani nieść
// żywego zapisu na sesję. Dwa niezależne rysunki tego samego programu już raz
// kosztowały właściciela „stary layout w studiu”.
//
// TEN PLIK WNOSI WYŁĄCZNIE ŹRÓDŁO I AKCJĘ. Zapytanie `event_agenda` liczy w tej
// samej chwili zajętość, mój zapis i `access_state`; mutacja zapisu unieważnia
// to zapytanie, zamiast zgadywać liczby miejsc lokalnie.
//
// PUSTY PROGRAM NIE RYSUJE OBUDOWY. Bez ani jednej sesji nie ma czego szukać
// ani co filtrować, więc zostaje jedno zdanie pod nagłówkiem, który należy do
// `EventPageSections`.
import { useState } from "react";
import { Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { Skeleton } from "@/components/ui/skeleton";
import { uiLang } from "@/lib/i18n/format";
import { useAuth } from "@/hooks/useAuth";
import type { AgendaSession } from "@/lib/events/agendaSurface";
import { useEventAgenda, useSessionSignup } from "@/lib/events/usePublicEvent";
import { publicEventErrorMessage } from "@/lib/events/publicEventErrors";
import { EventAgendaBoardView } from "@/components/events/public/organisms/EventAgendaBoardView";
import { ensureI18n as ensureEventFrontI18n } from "@/lib/i18n-event-front";

ensureEventFrontI18n();

export function EventAgendaSection({ slug, enabled = true }: { slug: string; enabled?: boolean }) {
  const { t, i18n } = useTranslation();
  const lang = uiLang(i18n.language);
  const { user } = useAuth();
  const signedIn = user !== null;

  const agendaQuery = useEventAgenda(slug, enabled);
  const signup = useSessionSignup(slug);
  const [pendingId, setPendingId] = useState<string | null>(null);

  const sessions = agendaQuery.data ?? [];

  const runSignup = (session: AgendaSession, status: "registered" | "cancelled") => {
    if (!signedIn) {
      toast.info(t("eventFront.agenda.actions.signIn"));
      return;
    }
    setPendingId(session.id);
    signup.mutate(
      { sessionId: session.id, status },
      {
        onSuccess: (result) => {
          setPendingId(null);
          if (result.status === "registered")
            toast.success(t("eventFront.agenda.toasts.registered"));
          else if (result.status === "waitlist")
            toast.success(t("eventFront.agenda.toasts.waitlist"));
          else toast.success(t("eventFront.agenda.toasts.cancelled"));
          if (result.promoted) toast.info(t("eventFront.agenda.toasts.promoted"));
        },
        onError: (error) => {
          setPendingId(null);
          toast.error(publicEventErrorMessage(error));
        },
      },
    );
  };

  if (agendaQuery.isPending) {
    return (
      <div className="space-y-3" aria-busy="true" aria-label={t("eventFront.agenda.loading")}>
        <Skeleton className="h-9 w-56" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  if (agendaQuery.isError) {
    return (
      <p className="rounded-[6px] border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
        {publicEventErrorMessage(agendaQuery.error)}
      </p>
    );
  }

  if (sessions.length === 0) {
    return <p className="text-sm text-muted-foreground">{t("eventFront.sections.agenda.empty")}</p>;
  }

  return (
    <div className="space-y-4">
      <EventAgendaBoardView
        sessions={sessions}
        lang={lang}
        signedIn={signedIn}
        pendingId={signup.isPending ? pendingId : null}
        onSignup={(session) => runSignup(session, "registered")}
        onCancel={(session) => runSignup(session, "cancelled")}
      />

      {signup.isPending && pendingId === null && (
        <p className="inline-flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          {t("eventFront.agenda.actions.working")}
        </p>
      )}
    </div>
  );
}
