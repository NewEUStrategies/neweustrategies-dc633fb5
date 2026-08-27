// /admin/events/<id>/content/speakers - prelegenci wydarzenia.
//
// TA TRASA ZAMYKA OSTATNI POWOD, ZEBY WCHODZIC W `/admin/community/events`.
// Katalog prelegentow byl tam jedyna funkcja bez odpowiednika w studiu, a
// dochodzilo sie do niego przez wyszukanie wydarzenia po slugu i otwarcie
// dialogu edycji - czyli przez wynik wyszukiwania, nie przez wydarzenie.
//
// DEFEKT DIAGNOSTYCZNY, KTORY TU BYL. Trasa konczyla sie linia
// `if (row === null) return null;`, wiec TRZY rozne rzeczy wygladaly
// identycznie - jako pusty ekran bez ani jednego slowa:
//   1) brak uprawnien (`admin_event_detail` stoi na
//      `assert_event_admin_tenant()`, wiec redaktor dostaje 42501),
//   2) blad sieci albo bazy,
//   3) wydarzenie, ktore naprawde nie istnieje (zly identyfikator w adresie).
// Zgloszenie „ekran prelegentow jest pusty" nie dawalo sie zdiagnozowac bez
// zagladania do konsoli przegladarki. Teraz kazdy z tych stanow ma wlasne
// zdanie, a blad oddaje tresc wyjatku.
//
// UCZCIWIE O ZASIEGU TEJ NAPRAWY: rama studia (`EventStudioShell`) czyta TEN
// SAM klucz cache i sama zatrzymuje render na spinnerze oraz na zdaniu „nie
// znaleziono", wiec w praktyce pierwsza zobaczy blad ONA - i pokaze „nie
// znaleziono" takze dla odmowy uprawnien. Rozdzielenie stanow w ramie jest
// osobna zmiana w osobnym pliku (poza zakresem tej galezi); tutaj trasa
// przestaje byc drugim, cichym miejscem gubienia tej informacji.
import { createFileRoute } from "@tanstack/react-router";
import { Loader2, ShieldAlert } from "lucide-react";
import { useTranslation } from "react-i18next";

import { EventContentSpeakersSection } from "@/components/admin/events/studio/EventStudioModuleSections";
import { Card, CardContent } from "@/components/ui/card";
import { useAdminEventDetail } from "@/lib/events/useAdminEventDetail";

export const Route = createFileRoute("/admin/events_/$eventId/content/speakers")({
  head: () => ({
    meta: [
      { title: "Speakers · Event · Admin" },
      { name: "robots", content: "noindex, nofollow" },
      { name: "description", content: "Speakers billed for this event and their profiles." },
    ],
  }),
  component: EventStudioContentSpeakersPage,
});

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-3xl p-6">
      <Card>
        <CardContent className="flex items-center gap-3 p-6 text-sm text-muted-foreground">
          <ShieldAlert className="h-5 w-5 shrink-0" aria-hidden="true" />
          {children}
        </CardContent>
      </Card>
    </div>
  );
}

function EventStudioContentSpeakersPage() {
  const { t } = useTranslation();
  const { eventId } = Route.useParams();
  // Ten sam klucz cache, co w ramie - React Query oddaje wczytany wiersz,
  // a nie drugie zapytanie o to samo wydarzenie.
  const detailQ = useAdminEventDetail(eventId);

  if (detailQ.isPending) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
      </div>
    );
  }

  // ODMOWA I AWARIA TO NIE „BRAK WYDARZENIA". Tresc wyjatku wchodzi na ekran,
  // bo RPC odmawia NAZWANYM bledem (`forbidden: admin role required`) - bez
  // tego redaktor i administrator patrzacy na awarie sieci widza to samo.
  if (detailQ.isError) {
    return <Notice>{detailQ.error.message}</Notice>;
  }

  const row = detailQ.data ?? null;
  if (row === null) {
    return <Notice>{t("adminEvents.studio.errors.notFound")}</Notice>;
  }

  return <EventContentSpeakersSection row={row} />;
}
