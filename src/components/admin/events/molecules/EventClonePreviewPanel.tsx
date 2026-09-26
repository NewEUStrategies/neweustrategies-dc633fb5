// Molekuła: PODGLĄD PRZESUNIĘCIA klonu edycji - daty, ostrzeżenia, blokady
// i dane, których kopia nie przeniesie.
//
// DATY SĄ Z BAZY, NIE Z PRZEGLĄDARKI. Każda chwila pochodzi z
// `admin_event_clone_preview`, który liczy przesunięcie tą samą funkcją co
// klon (`_event_clone_shift`, czas lokalny strefy wydarzenia). Tu jest wyłącznie
// FORMATOWANIE - w strefie NOWEJ edycji, bo w niej organizator planuje.
//
// DNI GIEŁDY SĄ DNIAMI, NIE CHWILAMI. `meeting_days` to `date[]`; data bez
// godziny sformatowana w strefie wydarzenia na zachód od Greenwich cofnęłaby się
// o dzień, więc formatujemy ją w UTC.
//
// STARY WYNIK ZOSTAJE, NOWY SIĘ LICZY. Podczas pisania podgląd pokazuje ostatni
// policzony stan i zdanie „Liczę daty…" - puste pole przy każdym znaku
// wyglądałoby jak awaria.
import { useTranslation } from "react-i18next";
import { CalendarClock, Loader2 } from "@/lib/lucide-shim";
import { EventCloneItemList } from "@/components/admin/events/molecules/EventCloneItemList";
import { EventCloneNotices } from "@/components/admin/events/molecules/EventCloneNotices";
import { adminCloneErrorMessage } from "@/lib/events/adminCloneErrors";
import type { CloneDates, EventClonePreview } from "@/lib/events/eventCloneApi";
import { cloneItemEntries } from "@/lib/events/eventCloneLabels";
import { formatEventDate, formatEventDateTime } from "@/lib/events/timezone";
import { uiLang } from "@/lib/i18n/format";
import { ensureCloneI18n } from "@/lib/i18n-admin-event-clone";

/** Chwile podglądu w kolejności wiersza tabeli. */
const INSTANT_ROWS = [
  ["rsvpOpensAt", "adminEventClone.preview.rows.rsvpOpensAt"],
  ["salesFrom", "adminEventClone.preview.rows.salesFrom"],
  ["salesTo", "adminEventClone.preview.rows.salesTo"],
  ["firstSessionStartsAt", "adminEventClone.preview.rows.firstSession"],
  ["lastSessionEndsAt", "adminEventClone.preview.rows.lastSession"],
  ["cfpOpensAt", "adminEventClone.preview.rows.cfpOpensAt"],
  ["cfpClosesAt", "adminEventClone.preview.rows.cfpClosesAt"],
] as const satisfies readonly (readonly [keyof CloneDates, string])[];

/** Dane osób i transakcje - zawsze zostają w poprzedniej edycji. */
const NOT_COPIED_KEYS = [
  "registrations",
  "package_orders",
  "checkins",
  "lead_scans",
  "meetings",
  "scanner_devices",
  "cfp_submissions",
  "seat_assignments",
  "invoices",
] as const;

export function EventClonePreviewPanel({
  preview,
  isFetching,
  error,
}: {
  /** Ostatni policzony podgląd; `null` = jeszcze żaden nie przyszedł. */
  preview: EventClonePreview | null;
  isFetching: boolean;
  error: Error | null;
}) {
  ensureCloneI18n();
  const { t, i18n } = useTranslation();
  const lang = uiLang(i18n.language);
  const zone = preview?.target.timezone ?? "";
  const moment = (iso: string | null) =>
    iso === null ? t("adminEventClone.preview.empty") : formatEventDateTime(iso, zone, lang);
  const day = (value: string) => formatEventDate(`${value}T00:00:00.000Z`, "UTC", lang);

  return (
    <section className="space-y-3 rounded-md border border-border/60 bg-muted/30 p-3" aria-live="polite">
      <header className="space-y-0.5">
        <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          <CalendarClock className="h-3.5 w-3.5" aria-hidden="true" />
          {t("adminEventClone.preview.title")}
        </p>
        <p className="text-xs text-muted-foreground">{t("adminEventClone.preview.description")}</p>
      </header>

      {isFetching ? (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          {t("adminEventClone.preview.loading")}
        </p>
      ) : null}

      {error === null ? null : (
        <p className="text-xs text-destructive" role="alert">
          {adminCloneErrorMessage(error)}
        </p>
      )}

      {preview === null ? null : (
        <div className="space-y-3">
          <p className="text-sm font-medium">
            {t("adminEventClone.preview.shiftDays", { count: preview.shift.dayShift })}
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              {t("adminEventClone.preview.zone", { zone })}
            </span>
          </p>
          <dl className="grid gap-x-4 gap-y-1 text-xs sm:grid-cols-2">
            <PreviewRow
              label={t("adminEventClone.preview.rows.startsAt")}
              value={moment(preview.target.startsAt)}
            />
            <PreviewRow
              label={t("adminEventClone.preview.rows.endsAt")}
              value={moment(preview.target.endsAt)}
            />
            {INSTANT_ROWS.filter(([key]) => preview.dates[key] !== null).map(([key, labelKey]) => (
              <PreviewRow key={key} label={t(labelKey)} value={moment(preview.dates[key])} />
            ))}
            {preview.dates.meetingDaysFirst === null || preview.dates.meetingDaysLast === null ? null : (
              <PreviewRow
                label={t("adminEventClone.preview.rows.meetingDays")}
                value={t("adminEventClone.preview.meetingDaysRange", {
                  from: day(preview.dates.meetingDaysFirst),
                  to: day(preview.dates.meetingDaysLast),
                })}
              />
            )}
          </dl>

          <EventCloneNotices
            title={t("adminEventClone.preview.blockersTitle")}
            notices={preview.blockers}
            tone="blocker"
          />
          <EventCloneNotices
            title={t("adminEventClone.preview.warningsTitle")}
            notices={preview.warnings}
            tone="warning"
          />
          <EventCloneItemList
            title={t("adminEventClone.preview.notCopiedTitle")}
            entries={cloneItemEntries(preview.notCopied, NOT_COPIED_KEYS)}
            emptyLabel={t("adminEventClone.preview.notCopiedEmpty")}
          />
        </div>
      )}
    </section>
  );
}

function PreviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2 border-b border-border/40 py-0.5">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-medium">{value}</dd>
    </div>
  );
}
