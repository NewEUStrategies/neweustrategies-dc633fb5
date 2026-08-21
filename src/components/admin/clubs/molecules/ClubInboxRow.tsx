// Molekuła: JEDNO zgłoszenie członkowskie w skrzynce - nagłówek i kartoteka.
//
// CO BYŁO W ORGANIZMIE. Lokalny `ApplicationRow` w `ClubApplicationsInbox`:
// sto trzydzieści linii, w których obok układu siedziały cztery reguły - wybór
// nazwy klubu między dwoma językami, trzy rozłączne stany poczty, lista pól
// kartoteki z pomijaniem pustych i zbiór statusów do ustawienia. Wszystkie
// wyprowadzone do `adminApplicationsInbox`; tutaj zostaje SKŁADANIE.
//
// TRZY RZECZY, KTÓRE TU SĄ REGUŁĄ UKŁADU, A NIE OZDOBĄ:
//
//   1. WIERSZ JEST ZWINIĘTY, DOPÓKI KTOŚ GO NIE OTWORZY. Kartoteka ma czternaście
//      pól, w tym cztery długie odpowiedzi opisowe. Skrzynka z ośmioma
//      rozwiniętymi zgłoszeniami nie daje się przeskanować wzrokiem, a decyzja
//      zapada właśnie ze skanowania: nazwisko, firma, specjalizacja, data.
//   2. STATUS OBECNY NIE JEST PRZYCISKIEM. Przyciski to statusy DO USTAWIENIA,
//      więc obecny jest z nich wykluczony - inaczej operator kliknąłby „oczekuje”
//      na zgłoszeniu, które już oczekuje, i zobaczył zapis bez zmiany.
//   3. STAN POCZTY STOI PRZY WIERSZU, NIE W DIALOGU. Nieudana wysyłka NIE cofa
//      decyzji, więc jedynym śladem po niej jest ta linia - i musi być widoczna
//      bez klikania, bo inaczej kandydat czeka na maila, którego nie ma.
//
// JEDNA ODPOWIEDZIALNOŚĆ: pokazać jedno zgłoszenie i oddać dwa zdarzenia
// (zmiana statusu, ponowienie CRM). Molekuła nie woła mutacji ani RPC.
import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ClubInboxToneBadge } from "@/components/admin/clubs/atoms/ClubInboxToneBadge";
import { ClubInboxCrmChip } from "@/components/admin/clubs/molecules/ClubInboxCrmChip";
import { uiLang, uiLocale } from "@/lib/i18n/format";
import {
  APPLICATION_DETAIL_FIELDS,
  applicationClubName,
  applicationDetailValue,
  applicationMailState,
  applicationStatusActions,
  applicationStatusTone,
  type ApplicationDetailField,
} from "@/lib/clubs/adminApplicationsInbox";
import type { ClubApplicationAdminRow, ClubApplicationStatus } from "@/lib/clubs/applyApi";
import { ensureAdminClubsI18n } from "@/lib/i18n-clubs-admin";

export function ClubInboxRow({
  row,
  onStatus,
  onRetryCrm,
  busy,
  retrying,
}: {
  row: ClubApplicationAdminRow;
  onStatus: (id: string, status: ClubApplicationStatus) => void;
  onRetryCrm: (id: string) => void;
  busy: boolean;
  retrying: boolean;
}) {
  // Klucze `adminClubs.applications.*` żyją w słowniku PANELU - bez `ensure`
  // wiersz pokazałby gołe klucze, gdyby trafił na powierzchnię, która słownika
  // panelu nie dociągnęła.
  ensureAdminClubsI18n();
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const lang = uiLang(i18n.language);
  const locale = uiLocale(i18n.language);
  const stamp = (iso: string, dateStyle: "short" | "medium"): string =>
    new Date(iso).toLocaleString(locale, { dateStyle, timeStyle: "short" });
  const clubName = applicationClubName(row, lang);
  const mail = applicationMailState(row);

  /** Pole puste (`null` albo `""`) NIE renderuje etykiety - pusta etykieta
      wyglądałaby jak dana, której kandydat „nie podał”, a nie jak brak pola. */
  const detail = (entry: { labelKey: string; field: ApplicationDetailField }): ReactNode => {
    const value = applicationDetailValue(row, entry.field);
    return value === null ? null : (
      <div key={entry.field}>
        <dt className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
          {t(entry.labelKey)}
        </dt>
        <dd className="mt-0.5 break-words text-sm">{value}</dd>
      </div>
    );
  };

  return (
    <li className="rounded-md border border-border p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex min-w-0 flex-1 items-start gap-2 text-left"
          aria-expanded={open}
        >
          <ChevronDown
            className={`mt-1 h-4 w-4 shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
            aria-hidden="true"
          />
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold">
              {row.first_name} {row.last_name}
            </span>
            <span className="block truncate text-xs text-muted-foreground">
              {row.email} · {row.company} · {row.job_position}
            </span>
            <span className="mt-1 block text-xs text-muted-foreground">
              {stamp(row.created_at, "medium")} · {row.specialization_slug}
              {clubName === null ? "" : ` · ${clubName}`} · {row.tier_key}
            </span>
            <span className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground">
              <Mail className="h-3 w-3 shrink-0" aria-hidden="true" />
              {mail.kind === "error"
                ? t("adminClubs.applications.mail.error", { message: mail.message })
                : mail.kind === "none"
                  ? t("adminClubs.applications.mail.none")
                  : t("adminClubs.applications.mail.sent", {
                      status: t(`adminClubs.applications.status.${mail.status}`),
                      when: stamp(mail.iso, "short"),
                    })}
            </span>
          </span>
        </button>
        <div className="flex flex-wrap items-center gap-2">
          <ClubInboxCrmChip row={row} onRetry={onRetryCrm} retrying={retrying} />
          <ClubInboxToneBadge tone={applicationStatusTone(row.status)}>
            {t(`adminClubs.applications.status.${row.status}`)}
          </ClubInboxToneBadge>
          {applicationStatusActions(row.status).map((status) => (
            <Button
              key={status}
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => onStatus(row.id, status)}
            >
              {t(`adminClubs.applications.setStatus.${status}`)}
            </Button>
          ))}
        </div>
      </div>

      {open ? (
        <dl className="mt-3 grid gap-3 border-t border-border pt-3 sm:grid-cols-2 lg:grid-cols-3">
          {APPLICATION_DETAIL_FIELDS.filter((entry) => !entry.wide).map((entry) => detail(entry))}
          {/* Odpowiedzi opisowe dostają całą szerokość - to zdania, nie wartości.
              Ramka zostaje także wtedy, gdy pole jest puste: siatka trzyma wtedy
              stałe miejsce i kartoteka nie „skacze” między zgłoszeniami. */}
          {APPLICATION_DETAIL_FIELDS.filter((entry) => entry.wide).map((entry) => (
            <div key={entry.field} className="sm:col-span-2 lg:col-span-3">
              {detail(entry)}
            </div>
          ))}
        </dl>
      ) : null}
    </li>
  );
}
