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
//
// DRUGA DROGA: KOPIA POPRZEDNIEJ EDYCJI (`?from=<id>`). Ten sam adres, ta sama
// rama studia, inny formularz - `EventCloneScreen` kopiuje konfigurację
// wskazanego wydarzenia z przesunięciem dat. Parametr przechodzi przez
// `parseCloneSearch` (tylko UUID), a wybór źródła („Kopiuj z poprzedniej
// edycji") stoi nad kreatorem wyłącznie dla administratora, bo klon jest
// operacją administratora (`assert_event_admin_tenant()`).
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
import { eventLocalInputToIso } from "@/lib/events/eventLocalInput";
import { EventCloneSourcePicker } from "@/components/admin/events/molecules/EventCloneSourcePicker";
import { EventCloneScreen } from "@/components/admin/events/organisms/EventCloneScreen";
import { EventStudioCreateShell } from "@/components/admin/events/studio/EventStudioCreateShell";
import { parseCloneSearch } from "@/lib/events/eventCloneSearch";
import { formatEventDateTime } from "@/lib/events/timezone";
import { uiLang } from "@/lib/i18n/format";
import { useCreateEventFromType } from "@/lib/events/useAdminEvents";
import { useEventTypes } from "@/lib/events/useEventTypes";
import { ensureI18n as ensureAdminEventsI18n } from "@/lib/i18n-admin-events";

export const Route = createFileRoute("/admin/events_/new")({
  validateSearch: (search: Record<string, unknown>): { from?: string } => parseCloneSearch(search),
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
  const { from } = Route.useSearch();
  const { isAdmin } = useAuth();
  if (from !== undefined) return <EventCloneScreen sourceId={from} canClone={isAdmin} />;
  return <CreateFromTypePage />;
}

function CreateFromTypePage() {
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
  const [railTimeZone, setRailTimeZone] = useState("");

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
    const timezone = draft.timezone.trim() === "" ? null : draft.timezone.trim();
    // Szkic trzyma ZEGAR w strefie wydarzenia (klasa OPS-15), nie chwilę -
    // chwilę liczy wspólny `eventLocalInputToIso` w strefie z droplisty, tak jak
    // `eventCreateIssue` przy walidacji. Formularz nie wypuszcza szkicu bez
    // czytelnego początku; ta odmowa jest bezpiecznikiem, nie ścieżką.
    const startsAt = eventLocalInputToIso(draft.startsAt, timezone);
    if (startsAt === null) {
      toast.error(t("adminEvents.list.create.errors.startsAt"));
      return;
    }
    create.mutate(
      {
        eventTypeId: draft.eventTypeId,
        titlePl: draft.titlePl.trim(),
        titleEn: draft.titleEn.trim(),
        startsAt,
        // Koniec pusty znaczy „nie podano" - wtedy koniec liczy rodzaj po stronie
        // bazy, a nie formularz zgadujacy dlugosc wydarzenia.
        endsAt: eventLocalInputToIso(draft.endsAt, timezone),
        timezone,
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

  // Strefa WYDARZENIA z droplisty kreatora: pole jest zegarem w niej, więc rail
  // pokazuje tę samą godzinę, którą redaktor wpisał, a po zapisie - tę samą,
  // którą zobaczy uczestnik.
  const lang = uiLang(i18n.language);
  const railZone = railTimeZone.trim() === "" ? null : railTimeZone.trim();
  const railDate = formatEventDateTime(
    eventLocalInputToIso(railStartsAt, railZone),
    railZone,
    lang,
  );

  return (
    <EventStudioCreateShell eventTitle={railTitle} startsAtLabel={railDate}>
      <div className="w-full p-4 sm:p-6">
        {isAdmin ? (
          <EventCloneSourcePicker
            onPick={(eventId) =>
              void navigate({ to: "/admin/events/new", search: { from: eventId } })
            }
          />
        ) : null}
        <EventCreateForm
          types={typesQ.data ?? []}
          isSaving={create.isPending}
          onCancel={backToList}
          onSubmit={submit}
          onDraftChange={(draft) => {
            setRailTitle(lang === "en" ? draft.titleEn || draft.titlePl : draft.titlePl);
            setRailStartsAt(draft.startsAt);
            setRailTimeZone(draft.timezone);
          }}
        />
      </div>
    </EventStudioCreateShell>
  );
}
