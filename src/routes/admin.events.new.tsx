// /admin/events/new - tworzenie wydarzenia jako STRONA, nie okno modalne.
//
// DLACZEGO STRONA. Formularz z podglądem dziedziczenia rodzaju (siedem wartości
// przepisywanych przez `admin_event_create`) nie mieści się w popupie bez
// przewijania, a popup nie ma adresu: nie da się go odświeżyć, wrócić „wstecz"
// ani przesłać linku współpracownikowi. Adres daje wszystkie trzy rzeczy za darmo.
//
// BRAMKA ROLI JEST W BAZIE. `admin_event_create` stoi za `assert_editor_tenant()`,
// więc autor bez roli redaktora dostanie `42501` niezależnie od tego, co pokaże
// ekran. Zdanie zamiast formularza istnieje po to, by odmowa nie wyglądała
// na awarię.
//
// PO UTWORZENIU IDZIEMY DO STUDIA, NIE NA LISTĘ. Kreator zbiera pięć pól -
// resztę wydarzenia (opis, okładka, strony, branding, zapisy, regulamin)
// uzupełnia się w studiu. Powrót na listę kazałby redaktorowi odszukać wśród
// kilkudziesięciu wierszy ten świeżo dodany i dopiero stamtąd wejść do środka,
// czyli wykonać dwa kliknięcia po to, żeby wrócić do pracy, której nie skończył.
// Tworzenie kończy się tam, gdzie zaczyna się ciąg dalszy.
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent } from "@/components/ui/card";
import {
  EventCreateForm,
  type EventCreateDraft,
} from "@/components/admin/events/organisms/EventCreateForm";
import { useCreateEventFromType } from "@/lib/events/useAdminEvents";
import { useEventTypes } from "@/lib/events/useEventTypes";
import { ensureI18n as ensureAdminEventsI18n } from "@/lib/i18n-admin-events";

export const Route = createFileRoute("/admin/events/new")({
  head: () => ({
    meta: [
      { title: "New event · Admin" },
      { name: "robots", content: "noindex, nofollow" },
      { name: "description", content: "Create an event draft from an event type." },
    ],
  }),
  component: AdminEventCreatePage,
});

function AdminEventCreatePage() {
  ensureAdminEventsI18n();
  const { t } = useTranslation();
  const { isAdmin, roles } = useAuth();
  const canWrite = isAdmin || roles.includes("editor");
  const navigate = useNavigate();

  const typesQ = useEventTypes();
  const create = useCreateEventFromType();

  const backToList = () => void navigate({ to: "/admin/events/list" });

  if (!canWrite) {
    return (
      <Card>
        <CardContent className="flex items-center gap-3 p-6 text-sm text-muted-foreground">
          <ShieldAlert className="h-5 w-5 shrink-0" aria-hidden="true" />
          {t("adminEvents.list.adminOnly")}
        </CardContent>
      </Card>
    );
  }

  const submit = (draft: EventCreateDraft) => {
    create.mutate(
      {
        eventTypeId: draft.eventTypeId,
        titlePl: draft.titlePl.trim(),
        titleEn: draft.titleEn.trim(),
        // Szkic trzyma już chwilę w ISO (nasz picker liczy strefę przeglądarki),
        // więc tutaj nie ma żadnej ponownej interpretacji czasu lokalnego.
        startsAt: new Date(draft.startsAt).toISOString(),
        // Puste pole znaczy „nie podano", a nie „podano pusty adres". Serwer
        // i tak zeruje adres dla rodzajów, które go nie używają.
        externalRegistrationUrl:
          draft.externalRegistrationUrl.trim() === "" ? null : draft.externalRegistrationUrl.trim(),
      },
      {
        // `admin_event_create` oddaje identyfikator nowego wiersza - jedyny
        // moment, w którym znamy go bez dodatkowego zapytania o listę.
        onSuccess: (eventId) => {
          toast.success(t("adminEvents.list.toasts.created"));
          void navigate({ to: "/admin/events/$eventId/general", params: { eventId } });
        },
        onError: (error) => toast.error(error.message),
      },
    );
  };

  return (
    <div className="mx-auto w-full max-w-5xl p-4 sm:p-6">
      <EventCreateForm
        types={typesQ.data ?? []}
        isSaving={create.isPending}
        onCancel={backToList}
        onSubmit={submit}
      />
    </div>
  );
}
