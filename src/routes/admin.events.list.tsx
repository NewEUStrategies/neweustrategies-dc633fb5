// /admin/events/list - lista wydarzeń modułu.
//
// STAN LISTY JEST W ADRESIE. `validateSearch` przepuszcza wyłącznie to, co
// przejdzie przez `parseEventListParams` - adres wpisany z ręki albo przeklejony
// ze starszej wersji interfejsu nie może wywrócić listy ani polecieć do RPC jako
// nie-UUID (odmowa `22P02` nie mówi redaktorowi nic).
//
// ZEGAR JEST PODANY Z KOMPONENTU, nie liczony w hooku: granica
// „nadchodzące/minione" musi być ta sama dla listy i dla liczników zakładek,
// a `Date.now()` w dwóch miejscach daje dwie granice różniące się o milisekundy
// i dwa różne klucze cache.
//
// BRAMKA ROLI JEST W BAZIE. `admin_events_list` i `admin_events_counts` stoją za
// `assert_editor_tenant()`, więc autor bez roli redaktora dostanie `42501`
// niezależnie od tego, co pokaże ekran. Zdanie zamiast pustej listy istnieje po
// to, żeby odmowa nie wyglądała jak awaria.
import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ShieldAlert } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useMinuteClock } from "@/hooks/useMinuteClock";
import { Card, CardContent } from "@/components/ui/card";
import { EventsListManager } from "@/components/admin/events/organisms/EventsListManager";
import { parseEventListParams, type EventListParams } from "@/lib/events/eventListParams";
import { ensureI18n as ensureAdminEventsI18n } from "@/lib/i18n-admin-events";

export const Route = createFileRoute("/admin/events/list")({
  validateSearch: (search: Record<string, unknown>): EventListParams =>
    parseEventListParams(search),
  head: () => ({
    meta: [
      { title: "Events · Admin" },
      { name: "robots", content: "noindex, nofollow" },
      { name: "description", content: "Every event in the organisation." },
    ],
  }),
  component: AdminEventsListPage,
});

function AdminEventsListPage() {
  ensureAdminEventsI18n();
  const { t } = useTranslation();
  // `useAuth` nie ma `isEditor` - `isStaff` obejmuje takze role `author`, ktora
  // RPC listy odrzuca (`assert_editor_tenant`). Warunek liczymy z `roles`, zeby
  // ekran mowil to samo, co baza: autor dostaje zdanie o braku uprawnien,
  // a nie liste, ktora zaraz odmowi 42501.
  const { isAdmin, roles } = useAuth();
  const canRead = isAdmin || roles.includes("editor");
  const params = Route.useSearch();

  // Zegar MUSI tykać. Granica zakładek „Najbliższe" i „Archiwum" liczy się z tej
  // wartości, a licznik zakładek liczy się w bazie funkcją `now()` przy każdym
  // odświeżeniu - zamrożone „teraz" rozjeżdża jedno z drugim i ekran pokazuje
  // zakładkę z inną liczbą niż długość listy pod nią.
  const now = useMinuteClock();

  if (!canRead) {
    return (
      <Card>
        <CardContent className="flex items-center gap-3 p-6 text-sm text-muted-foreground">
          <ShieldAlert className="h-5 w-5 shrink-0" aria-hidden="true" />
          {t("adminEvents.list.adminOnly")}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="mx-auto w-full max-w-5xl p-4 sm:p-6">
      <EventsListManager params={params} now={now} />
    </div>
  );
}
