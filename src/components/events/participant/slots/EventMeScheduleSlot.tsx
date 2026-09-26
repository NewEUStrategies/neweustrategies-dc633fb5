// GNIAZDO `EventMeScheduleSlot` - zakładka „Harmonogram" panelu „Moje".
//
// WŁAŚCICIEL: tor A (osobisty plan: `MyPlanPanel`, ładowany leniwie). Do tego
// czasu Foundation trzyma tu DZISIEJSZY harmonogram - `MyAgendaList` nad
// `event_my_agenda` - z gałęzią błędu, której panel wcześniej nie miał.
//
// „NIE WIEM” TO INNA ODPOWIEDŹ NIŻ „PUSTO”. Odmowa albo awaria
// `event_my_agenda` pokazywała zdanie „nie masz jeszcze żadnych zapisów” -
// uczestnik zapisywał się drugi raz albo uznawał, że jego wybory przepadły.
// Błąd ma własne zdanie i przycisk ponowienia.
//
// ZAPYTANIE OSOBISTE, WIĘC DOPIERO PO ROZSTRZYGNIĘCIU SESJI (R-UI/SSR):
// `enabled` wymaga zalogowanego i `!useAuth().loading`.
//
// Właściwości są zamrożone (`slotTypes.ts`); tor A przepisuje ciało tego pliku
// i jego test (`__tests__/EventMeScheduleSlot.test.tsx`), nigdy hosta.
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { MyAgendaList } from "@/components/events/participant/molecules/MyAgendaList";
import type { EventMeSlotProps } from "@/components/events/participant/slots/slotTypes";
import { useMyAgenda } from "@/lib/events/useMyEventPanel";
import { ensureI18n as ensureEventParticipantI18n } from "@/lib/i18n-event-participant";

export function EventMeScheduleSlot({ slug }: EventMeSlotProps) {
  ensureEventParticipantI18n();
  const { t } = useTranslation();
  const { session, loading } = useAuth();
  const agenda = useMyAgenda(slug, session !== null && !loading);

  if (agenda.isError) {
    return (
      <div
        role="alert"
        className="space-y-3 rounded-md border border-destructive/40 bg-destructive/10 p-4"
      >
        <p className="text-sm">{t("eventParticipant.agenda.loadError")}</p>
        <Button type="button" size="sm" variant="outline" onClick={() => void agenda.refetch()}>
          {t("eventParticipant.agenda.retry")}
        </Button>
      </div>
    );
  }

  return <MyAgendaList sessions={agenda.data ?? []} loading={agenda.isPending} />;
}
