// Kalendarz klubu - siatka miesiąca i agenda obok niej.
//
// DWA WIDOKI NA RAZ, i to jest decyzja, nie przypadek. Siatka odpowiada na
// pytanie "jak gęsty jest ten miesiąc" (jednym spojrzeniem, bez czytania),
// agenda - "co konkretnie mnie czeka". Sama siatka zmusza do klikania w każdy
// dzień, sama lista gubi rytm procesu, który ten klub ma śledzić.
//
// TYDZIEŃ ZACZYNA SIĘ W PONIEDZIAŁEK. Serwis jest europejski w obu językach,
// więc niedziela na pierwszym miejscu byłaby błędem także w wersji EN.
//
// ZAKRES ZAPYTANIA obejmuje CAŁY widoczny miesiąc plus horyzont agendy, więc
// przewijanie miesięcy to nowe zapytanie (klucz zawiera zakres), a nie filtr
// po stronie klienta na niepełnych danych.
import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import {
  CalendarOff,
  ChevronLeft,
  ChevronRight,
  Clock,
  Link2,
  MapPin,
  Pencil,
  Plus,
  Trash2,
  Users,
  Video,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { ClubEventForm } from "@/components/clubs/molecules/ClubEventForm";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  useClubEventRsvp,
  useClubEvents,
  useDeleteClubEvent,
  useUpsertClubEvent,
} from "@/lib/clubs/useClubWorkspace";
import {
  CLUB_RSVP_STATES,
  isEventFull,
  isEventLive,
  toEventKind,
  toEventStatus,
  toRsvpState,
  type ClubEventRow,
  type ClubRsvpState,
} from "@/lib/clubs/workspaceTypes";
import {
  ClubEventDot,
  ClubEventKindChip,
  clubEventToneClass,
} from "@/components/clubs/atoms/ClubWorkspaceBadges";
import { ClubCalendarSkeleton } from "@/components/clubs/atoms/ClubWorkspaceSkeletons";
import { ClubErrorNotice } from "@/components/clubs/molecules/ClubErrorNotice";
import { formatDate, formatDateTime, uiLang, uiLocale } from "@/lib/i18n/format";
import { pickLocalized } from "@/lib/i18n/pickLocalized";

const DAY_MS = 86_400_000;

/** Klucz dnia w czasie LOKALNYM. `toISOString()` przesuwa datę o strefę, więc
 *  wydarzenie o 23:30 lądowało w siatce dzień później. */
function dayKey(date: Date): string {
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/** Poniedziałek tygodnia, w którym leży `date`. */
function startOfWeek(date: Date): Date {
  const out = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const shift = (out.getDay() + 6) % 7;
  out.setDate(out.getDate() - shift);
  return out;
}

interface MonthModel {
  cells: Date[];
  from: Date;
  to: Date;
}

/** Sześć pełnych tygodni: siatka nie może zmieniać wysokości przy przejściu
 *  na miesiąc, który zajmuje o rząd więcej - to podskakiwanie układu. */
function buildMonth(anchor: Date): MonthModel {
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const from = startOfWeek(first);
  const cells: Date[] = [];
  for (let i = 0; i < 42; i += 1) {
    cells.push(new Date(from.getTime() + i * DAY_MS));
  }
  const last = cells[cells.length - 1] ?? from;
  return {
    cells,
    from,
    to: new Date(last.getFullYear(), last.getMonth(), last.getDate(), 23, 59, 59),
  };
}

function EventCard({
  row,
  clubSlug,
  now,
  onRsvp,
  rsvpPending,
  onEdit,
  onDelete,
}: {
  row: ClubEventRow;
  clubSlug: string;
  now: number;
  onRsvp: (eventId: string, state: ClubRsvpState) => void;
  rsvpPending: boolean;
  /** Podane tylko kuratorowi - brak funkcji chowa cały pasek redakcji. */
  onEdit?: (row: ClubEventRow) => void;
  onDelete?: (row: ClubEventRow) => void;
}) {
  const { t, i18n } = useTranslation();
  const lang = uiLang(i18n.language);
  const kind = toEventKind(row.kind);
  const status = toEventStatus(row.status);
  const mine = toRsvpState(row.my_rsvp);
  const live = isEventLive(row, now);
  const full = isEventFull(row);
  const title = pickLocalized(row, "title", lang);
  const description = pickLocalized(row, "description", lang);

  return (
    <article
      className={cn(
        "rounded-lg border bg-card p-3",
        status === "cancelled" ? "border-border/60 opacity-60" : "border-border/60",
        live && "border-primary/60",
      )}
      data-testid="club-event-card"
    >
      <div className="flex flex-wrap items-center gap-2">
        <ClubEventKindChip kind={kind} />
        {live ? (
          <Badge className="gap-1 text-[11px]">
            <span
              className="h-1.5 w-1.5 animate-pulse rounded-full bg-current"
              aria-hidden="true"
            />
            {t("club.calendar.live")}
          </Badge>
        ) : null}
        {status !== "scheduled" ? (
          <Badge variant="secondary" className="text-[11px]">
            {t(`club.calendar.status.${status}`)}
          </Badge>
        ) : null}
      </div>

      <h3 className="mt-1.5 font-medium leading-tight">{title}</h3>

      <p className="mt-1 inline-flex items-center gap-1.5 text-xs text-muted-foreground">
        <Clock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        {row.all_day
          ? formatDate(row.starts_at, lang, { day: "numeric", month: "long", year: "numeric" })
          : formatDateTime(row.starts_at, lang)}
        {row.all_day ? ` · ${t("club.calendar.allDay")}` : ""}
      </p>

      {description !== null && description.trim() !== "" ? (
        <p className="mt-1.5 line-clamp-3 text-sm text-muted-foreground">{description}</p>
      ) : null}

      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {row.location !== null && row.location.trim() !== "" ? (
          <span className="inline-flex items-center gap-1.5">
            <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
            {row.location}
          </span>
        ) : null}
        {row.rsvp_enabled ? (
          <span className="inline-flex items-center gap-1.5">
            <Users className="h-3.5 w-3.5" aria-hidden="true" />
            {row.capacity !== null
              ? t("club.calendar.goingOfCapacity", {
                  count: row.going_count,
                  capacity: row.capacity,
                })
              : t("club.calendar.goingCount", { count: row.going_count })}
          </span>
        ) : null}
        {row.thread_slug !== null ? (
          <Link
            to="/club/$clubSlug/t/$threadSlug"
            params={{ clubSlug, threadSlug: row.thread_slug }}
            className="inline-flex items-center gap-1 hover:text-foreground"
          >
            <Link2 className="h-3 w-3" aria-hidden="true" />
            {t("club.calendar.linkedThread")}
          </Link>
        ) : null}
      </div>

      {/* Adres pokoju przychodzi z RPC WYŁĄCZNIE uczestnikom - jeśli jest
          `null`, to nie znaczy "brak spotkania online", tylko "nie dla Ciebie",
          i dlatego nie ma tu żadnego zastępczego komunikatu. */}
      {row.meeting_url !== null && row.meeting_url.trim() !== "" ? (
        <Button asChild size="sm" variant="secondary" className="mt-3">
          <a href={row.meeting_url} target="_blank" rel="noreferrer">
            <Video className="mr-1.5 h-4 w-4" aria-hidden="true" />
            {t("club.calendar.join")}
          </a>
        </Button>
      ) : null}

      {row.rsvp_enabled && status === "scheduled" ? (
        <div
          className="mt-3 flex flex-wrap gap-1.5"
          role="group"
          aria-label={t("club.calendar.rsvpLabel")}
        >
          {CLUB_RSVP_STATES.map((state) => {
            const active = mine === state;
            // Limit miejsc blokuje WEJŚCIE na listę obecnych, nigdy zejście
            // z niej - dokładnie tak, jak liczy to RPC.
            const blocked = state === "going" && full && !active;
            return (
              <Button
                key={state}
                type="button"
                size="sm"
                variant={active ? "default" : "outline"}
                disabled={rsvpPending || blocked}
                aria-pressed={active}
                onClick={() => onRsvp(row.id, state)}
              >
                {t(`club.calendar.rsvp.${state}`)}
              </Button>
            );
          })}
          {full && mine !== "going" ? (
            <span className="self-center text-xs text-muted-foreground">
              {t("club.calendar.full")}
            </span>
          ) : null}
        </div>
      ) : null}

      {onEdit !== undefined || onDelete !== undefined ? (
        <div className="mt-3 flex flex-wrap gap-1.5 border-t border-border/60 pt-2">
          {onEdit !== undefined ? (
            <Button type="button" size="sm" variant="ghost" onClick={() => onEdit(row)}>
              <Pencil className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
              {t("club.eventForm.edit")}
            </Button>
          ) : null}
          {onDelete !== undefined ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="text-muted-foreground hover:text-destructive"
              onClick={() => onDelete(row)}
            >
              <Trash2 className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
              {t("club.eventForm.delete")}
            </Button>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

export function ClubCalendar({
  clubId,
  clubSlug,
  canManage = false,
}: {
  clubId: string;
  clubSlug: string;
  /** Kurator klubu: tworzenie, redakcja i usuwanie terminów. */
  canManage?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const lang = uiLang(i18n.language);
  const locale = uiLocale(i18n.language);

  const [anchor, setAnchor] = useState(() => new Date());
  const [selected, setSelected] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ClubEventRow | null>(null);
  const [pendingDelete, setPendingDelete] = useState<ClubEventRow | null>(null);

  const month = useMemo(() => buildMonth(anchor), [anchor]);
  const eventsQ = useClubEvents({
    clubId,
    from: month.from.toISOString(),
    to: month.to.toISOString(),
  });
  const rsvp = useClubEventRsvp(clubId);
  const upsert = useUpsertClubEvent(clubId);
  const remove = useDeleteClubEvent(clubId);

  const rows = useMemo(() => eventsQ.data ?? [], [eventsQ.data]);

  /** Mapa dzień -> wpisy. Liczona raz na zestaw danych, nie raz na komórkę:
   *  42 komórki x N wpisów to iloczyn, który widać na telefonie. */
  const byDay = useMemo(() => {
    const map = new Map<string, ClubEventRow[]>();
    for (const row of rows) {
      const start = new Date(row.starts_at);
      if (Number.isNaN(start.getTime())) continue;
      const key = dayKey(start);
      const bucket = map.get(key);
      if (bucket === undefined) map.set(key, [row]);
      else bucket.push(row);
    }
    return map;
  }, [rows]);

  const now = Date.now();
  const todayKey = dayKey(new Date());

  /** Agenda: wybrany dzień albo - domyślnie - wszystko od dziś w przód. */
  const agenda = useMemo(() => {
    if (selected !== null) return byDay.get(selected) ?? [];
    return rows.filter((row) => {
      const end = Date.parse(row.ends_at ?? row.starts_at);
      return !Number.isNaN(end) && end >= now;
    });
  }, [selected, byDay, rows, now]);

  const weekdays = useMemo(() => {
    // Etykiety dni biorą się z Intl, a nie z tablicy napisów - inaczej byłyby
    // trzecim miejscem, w którym trzeba pamiętać o dwóch językach.
    const base = startOfWeek(new Date());
    return Array.from({ length: 7 }, (_, i) =>
      new Date(base.getTime() + i * DAY_MS).toLocaleDateString(locale, { weekday: "short" }),
    );
  }, [locale]);

  if (eventsQ.isError) return <ClubErrorNotice onRetry={() => void eventsQ.refetch()} />;
  if (eventsQ.isPending) return <ClubCalendarSkeleton />;

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_24rem]">
      <section aria-label={t("club.calendar.monthLabel")}>
        <div className="mb-2 flex items-center justify-between gap-2">
          <h2 className="text-base font-semibold capitalize">
            {formatDate(anchor, lang, { month: "long", year: "numeric" })}
          </h2>
          <div className="flex gap-1">
            {canManage ? (
              <Button
                size="sm"
                onClick={() => {
                  setEditing(null);
                  setFormOpen(true);
                }}
              >
                <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />
                {t("club.eventForm.createTitle")}
              </Button>
            ) : null}

            <Button
              variant="outline"
              size="icon"
              aria-label={t("club.calendar.prevMonth")}
              onClick={() => {
                setSelected(null);
                setAnchor((d) => new Date(d.getFullYear(), d.getMonth() - 1, 1));
              }}
            >
              <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setSelected(null);
                setAnchor(new Date());
              }}
            >
              {t("club.calendar.today")}
            </Button>
            <Button
              variant="outline"
              size="icon"
              aria-label={t("club.calendar.nextMonth")}
              onClick={() => {
                setSelected(null);
                setAnchor((d) => new Date(d.getFullYear(), d.getMonth() + 1, 1));
              }}
            >
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-7 gap-px overflow-hidden rounded-lg border border-border/60 bg-border/60">
          {weekdays.map((label) => (
            <div
              key={label}
              className="bg-muted/40 px-1 py-1.5 text-center text-[11px] font-medium uppercase text-muted-foreground"
            >
              {label}
            </div>
          ))}

          {month.cells.map((cell) => {
            const key = dayKey(cell);
            const dayEvents = byDay.get(key) ?? [];
            const outside = cell.getMonth() !== anchor.getMonth();
            const isToday = key === todayKey;
            const isSelected = key === selected;

            return (
              <button
                key={key}
                type="button"
                aria-pressed={isSelected}
                aria-label={`${formatDate(cell, lang, { day: "numeric", month: "long" })} - ${t("club.calendar.dayEvents", { count: dayEvents.length })}`}
                onClick={() => setSelected(isSelected ? null : key)}
                className={cn(
                  "flex min-h-[3.25rem] flex-col items-start gap-1 bg-card p-1.5 text-left transition-colors hover:bg-muted/50 sm:min-h-[4.5rem]",
                  outside && "bg-muted/20 text-muted-foreground",
                  isSelected && "ring-2 ring-inset ring-primary",
                )}
              >
                <span
                  className={cn(
                    "inline-flex h-5 w-5 items-center justify-center rounded-full text-xs tabular-nums",
                    isToday && "bg-primary font-semibold text-primary-foreground",
                  )}
                >
                  {cell.getDate()}
                </span>
                {dayEvents.length > 0 ? (
                  <span className="flex flex-wrap gap-1">
                    {/* Trzy kropki i licznik: pięć kropek w komórce na
                        telefonie zlewa się w kreskę i nic nie mówi. */}
                    {dayEvents.slice(0, 3).map((row) => (
                      <ClubEventDot
                        key={row.id}
                        kind={toEventKind(row.kind)}
                        label={pickLocalized(row, "title", lang)}
                      />
                    ))}
                    {dayEvents.length > 3 ? (
                      <span className="text-[10px] leading-none text-muted-foreground">
                        +{dayEvents.length - 3}
                      </span>
                    ) : null}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>

        {/* Legenda rodzajów: kropka bez legendy jest kolorem, nie informacją. */}
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
          {(["meeting", "deadline", "consultation", "vote"] as const).map((kind) => (
            <span key={kind} className="inline-flex items-center gap-1.5">
              <span
                className={cn("h-1.5 w-1.5 rounded-full border", clubEventToneClass(kind))}
                aria-hidden="true"
              />
              {t(`club.calendar.kind.${kind}`)}
            </span>
          ))}
        </div>
      </section>

      <section aria-label={t("club.calendar.agendaLabel")} className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-base font-semibold">
            {selected !== null
              ? formatDate(new Date(`${selected}T12:00:00`), lang, {
                  day: "numeric",
                  month: "long",
                })
              : t("club.calendar.upcoming")}
          </h2>
          {selected !== null ? (
            <Button variant="ghost" size="sm" onClick={() => setSelected(null)}>
              {t("club.calendar.showUpcoming")}
            </Button>
          ) : null}
        </div>

        {agenda.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-3 p-8 text-center">
              <CalendarOff className="h-7 w-7 text-muted-foreground" aria-hidden="true" />
              <p className="text-sm text-muted-foreground">
                {selected !== null ? t("club.calendar.emptyDay") : t("club.calendar.empty")}
              </p>
            </CardContent>
          </Card>
        ) : (
          agenda.map((row) => (
            <EventCard
              key={row.id}
              row={row}
              clubSlug={clubSlug}
              now={now}
              rsvpPending={rsvp.isPending}
              onRsvp={(eventId, state) => rsvp.mutate({ eventId, state })}
              {...(canManage
                ? {
                    onEdit: (event: ClubEventRow) => {
                      setEditing(event);
                      setFormOpen(true);
                    },
                    onDelete: (event: ClubEventRow) => setPendingDelete(event),
                  }
                : {})}
            />
          ))
        )}
      </section>

      {canManage && formOpen ? (
        <ClubEventForm
          key={editing?.id ?? "new"}
          open={formOpen}
          initial={editing}
          pending={upsert.isPending}
          onOpenChange={setFormOpen}
          onSubmit={(input) =>
            upsert.mutate(input, {
              onSuccess: () => {
                setFormOpen(false);
                toast.success(t("club.eventForm.saved"));
              },
              onError: () => toast.error(t("club.eventForm.failed")),
            })
          }
        />
      ) : null}

      {canManage && pendingDelete !== null ? (
        <AlertDialog
          open
          onOpenChange={(open) => {
            if (!open) setPendingDelete(null);
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t("club.eventForm.deleteTitle")}</AlertDialogTitle>
              <AlertDialogDescription>
                {t("club.eventForm.deleteLead", {
                  title: pickLocalized(pendingDelete, "title", lang),
                })}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t("club.eventForm.cancel")}</AlertDialogCancel>
              <AlertDialogAction
                disabled={remove.isPending}
                onClick={() =>
                  remove.mutate(pendingDelete.id, {
                    onSuccess: () => {
                      setPendingDelete(null);
                      toast.success(t("club.eventForm.deleted"));
                    },
                    onError: () => toast.error(t("club.eventForm.failed")),
                  })
                }
              >
                {t("club.eventForm.delete")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      ) : null}
    </div>
  );
}
