// Rama studia dla wydarzenia, które JESZCZE NIE ISTNIEJE.
//
// PO CO OSOBNA RAMA. `EventStudioShell` startuje od `admin_event_detail` -
// potrzebuje wiersza wydarzenia, żeby wiedzieć, co pokazać w nagłówku sidebara
// i czy publikacja jest w ogóle możliwa. W kreatorze tego wiersza nie ma, a
// mimo to ekran ma wyglądać jak studio: właściciel poprosił wprost, żeby
// „klikając utwórz nowe wydarzenie" wyświetlała się strona z własnym sidebarem,
// a nie z powłoką panelu.
//
// DLACZEGO RAIL POKAZUJE JEDEN WIERSZ, A NIE DWUDZIESTU DZIEWIĘCIU WYSZARZONYCH.
// Wzorzec nigdy nie wyszarza nawigacji dla stanu „jeszcze nie istnieje":
// na zrzucie 37 marketplace nie jest założony („Create marketplace" czeka na
// kliknięcie), a jego pozycja w sidebarze jest PODŚWIETLONA i cały sidebar
// sprawny; na zrzucie 01 nie ma ani jednego kodu rejestracyjnego, a „Codes"
// świeci. Pustkę niesie wyłącznie TREŚĆ. Ten sam spór jest już rozstrzygnięty
// tym samym argumentem w `EventStudioSidebar` („pozycje wyłączonych modułów są
// NIEOBECNE, a nie wyszarzone").
//
// Drugi powód jest geometryczny. Po zapisie kreator prowadzi na
// `/admin/events/<id>/general`, czyli na pierwsze dziecko grupy „Kreator
// wydarzenia". Jeśli rail pokaże dokładnie ten jeden wiersz jako aktywny,
// przejście z kreatora do studia nie przesunie ANI JEDNEGO PIKSELA nawigacji -
// tylko dopisze pod nią resztę pozycji. Wariant „tylko nagłówek" dawałby skok
// z pustego pasa na dwunastopozycyjny.
//
// CZEGO W RAILU NIE MA I DLACZEGO:
//   - pola „Szukaj w wydarzeniu…" - nie ma czego szukać, a znalezienie
//     „Stolików" bez możliwości wejścia to kontrolka, która nie robi tego,
//     co obiecuje (ten sam argument stoi w `EventStudioSidebar`),
//   - odnośnika „Otwórz wydarzenie" - nie ma czego otworzyć; miejsce zajmuje
//     zdanie o szkicu, to samo, które widzi szkic już zapisany,
//   - `<Link>` na pozycji nawigacji - `EVENT_STUDIO_ROUTES` wymaga `eventId`,
//     którego jeszcze nie ma, więc wiersz jest `<span aria-current="page">`.
//
// Powrót do listy jest jednocześnie akcją „Anuluj" - formularz nie potrzebuje
// drugiego wyjścia w innym miejscu ekranu.
import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ChevronLeft } from "lucide-react";
import { EventStudioTopBar } from "@/components/admin/events/studio/EventStudioTopBar";
import { ensureI18n as ensureAdminEventsI18n } from "@/lib/i18n-admin-events";

export function EventStudioCreateShell({
  eventTitle,
  startsAtLabel,
  children,
}: {
  /** Tytuł WPISYWANY w formularzu; pusty = „Nowe wydarzenie". */
  eventTitle: string;
  /** Termin wybrany w formularzu; pusty = „bez terminu". */
  startsAtLabel: string;
  children: ReactNode;
}) {
  ensureAdminEventsI18n();
  const { t } = useTranslation();

  const title = eventTitle.trim() === "" ? t("adminEvents.list.create.title") : eventTitle;
  const date = startsAtLabel.trim() === "" ? t("adminEvents.list.row.noDate") : startsAtLabel;

  return (
    <div className="admin-compact flex min-h-screen flex-col bg-muted/30">
      <EventStudioTopBar
        status="draft"
        isBusy={false}
        previewOpen={false}
        onTogglePreview={() => undefined}
        onStatusChange={() => undefined}
        createMode
      />

      <div className="flex min-h-0 flex-1">
        <aside
          data-sidebar="sidebar"
          aria-label={t("adminEvents.studio.nav.label")}
          className="sticky top-[3.25rem] flex h-[calc(100vh-3.25rem)] w-64 shrink-0 flex-col self-start overflow-y-auto border-r border-border bg-card"
        >
          <div className="space-y-2 border-b border-border p-3">
            <Link
              to="/admin/events/list"
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <ChevronLeft className="h-3 w-3" aria-hidden="true" />
              {t("adminEvents.studio.nav.backToList")}
            </Link>

            <p className="text-sm font-semibold leading-snug text-foreground">{title}</p>
            <p className="text-xs text-muted-foreground">{date}</p>

            <span className="block text-xs text-muted-foreground">
              {t("adminEvents.studio.nav.openEventDraft")}
            </span>
          </div>

          <nav className="space-y-0.5 p-2" aria-label={t("adminEvents.studio.nav.label")}>
            <p className="px-2 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              {t("adminEvents.studio.groups.builder")}
            </p>
            <span
              aria-current="page"
              className="flex items-center rounded-md bg-brand/10 px-2 py-1.5 text-[13px] font-medium text-brand"
            >
              {t("adminEvents.studio.sections.general")}
            </span>
          </nav>
        </aside>

        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}
