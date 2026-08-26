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
// PO UTWORZENIU IDZIEMY NA PULPIT WYDARZENIA, NIE NA LISTĘ. Kreator zbiera pięć pól -
// resztę wydarzenia (opis, okładka, strony, branding, zapisy, regulamin)
// uzupełnia się w studiu. Powrót na listę kazałby redaktorowi odszukać wśród
// kilkudziesięciu wierszy ten świeżo dodany i dopiero stamtąd wejść do środka,
// czyli wykonać dwa kliknięcia po to, żeby wrócić do pracy, której nie skończył.
// Tworzenie kończy się tam, gdzie zaczyna się ciąg dalszy.
import { useState } from "react";
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
import { EventStudioCreateShell } from "@/components/admin/events/studio/EventStudioCreateShell";
import { formatEventDateTime } from "@/lib/events/timezone";
import { uiLang } from "@/lib/i18n/format";
import { useCreateEventFromType } from "@/lib/events/useAdminEvents";
import { useEventTypes } from "@/lib/events/useEventTypes";
import { ensureI18n as ensureAdminEventsI18n } from "@/lib/i18n-admin-events";

export const Route = createFileRoute("/admin/events_/new")({
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
  const { t, i18n } = useTranslation();
  const { isAdmin, roles } = useAuth();
  const canWrite = isAdmin || roles.includes("editor");
  const navigate = useNavigate();

  const typesQ = useEventTypes();
  const create = useCreateEventFromType();

  // Nagłówek railu czyta TEN stan, nie formularz - dlatego kreator raportuje
  // szkic w górę (`onDraftChange`). Bez tego sidebar musiałby albo trzymać
  // drugą kopię pól, albo pokazywać „Nowe wydarzenie" także wtedy, gdy tytuł
  // jest już wpisany - czyli kłamać o stanie, który redaktor ma przed oczami.
  const [railTitle, setRailTitle] = useState("");
  const [railStartsAt, setRailStartsAt] = useState("");

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
        // Koniec pusty znaczy „nie podano" - wtedy koniec liczy rodzaj po stronie
        // bazy, a nie formularz zgadujacy dlugosc wydarzenia.
        endsAt: draft.endsAt.trim() === "" ? null : new Date(draft.endsAt).toISOString(),
        timezone: draft.timezone.trim() === "" ? null : draft.timezone.trim(),
        format: draft.format.trim() === "" ? null : draft.format.trim(),
        city: draft.city.trim() === "" ? null : draft.city.trim(),
        country: draft.country.trim() === "" ? null : draft.country.trim(),
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
          // PULPIT, NIE „Informacje ogolne": kreator zebral juz wszystko, co
          // ogólne pytanie by powtórzyło, a pulpit pokazuje następne kroki
          // (okladka, opis, sesje, publikacja) - czyli miejsce, w ktorym praca
          // nad wydarzeniem realnie sie zaczyna.
          void navigate({ to: "/admin/events/$eventId/overview", params: { eventId } });
        },
        onError: (error) => toast.error(error.message),
      },
    );
  };

  // Strefa przeglądarki, nie wydarzenia: rodzaj jeszcze nie przepisał strefy,
  // więc jedyna, jaką znamy na tym ekranie, to strefa osoby wypełniającej.
  const lang = uiLang(i18n.language);
  const railDate =
    railStartsAt.trim() === ""
      ? ""
      : formatEventDateTime(
          new Date(railStartsAt).toISOString(),
          Intl.DateTimeFormat().resolvedOptions().timeZone,
          lang,
        );

  return (
    <EventStudioCreateShell eventTitle={railTitle} startsAtLabel={railDate}>
      <div className="w-full p-4 sm:p-6">
        <EventCreateForm
          types={typesQ.data ?? []}
          isSaving={create.isPending}
          onCancel={backToList}
          onSubmit={submit}
          onDraftChange={(draft) => {
            setRailTitle(lang === "en" ? draft.titleEn || draft.titlePl : draft.titlePl);
            setRailStartsAt(draft.startsAt);
          }}
        />
      </div>
    </EventStudioCreateShell>
  );
}
