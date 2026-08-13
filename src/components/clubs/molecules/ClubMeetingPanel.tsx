// Moduł "Najbliższe spotkanie + kto będzie".
//
// PO CO ZASTĘPUJE SAMĄ DATĘ. Poprzedni panel wypisywał dwa najbliższe terminy
// i na tym kończył. Sama data konwertuje słabo: mówi, KIEDY coś się dzieje,
// i milczy o jedynej rzeczy, która realnie decyduje o przyjściu - kto tam
// będzie. Ludzie przychodzą do ludzi, nie do tematu, a klub, który prowadzi
// spotkania w formule Chatham House, ma tę listę wyjątkowo cenną.
//
// UKŁAD JEST HIERARCHIĄ, NIE LISTĄ. Najbliższe spotkanie dostaje pełną kartę
// z twarzami i przyciskiem potwierdzenia; kolejne dwa - jedną linijkę każde.
// Trzy równorzędne wpisy zamieniłyby panel w drugi kalendarz, a kalendarz ma
// własny ekran.
//
// LISTA NAZWISK JEST PRZYWILEJEM, LICZBA - NIE. Klub, który ukrywa skład,
// dostaje z bazy zero wierszy uczestników, ale `going_count` jedzie dalej
// w wierszu wydarzenia. Panel pokazuje wtedy samą liczbę i to jest poprawny
// stan, a nie awaria: "siedem osób potwierdziło" nadal jest powodem, żeby
// przyjść.
import { useState } from "react";
import { pickLocalized } from "@/lib/i18n/pickLocalized";
import { useTranslation } from "react-i18next";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { CalendarClock, MapPin, Pencil, Plus, Trash2, Users2, Video } from "lucide-react";
import { cn } from "@/lib/utils";
import { ClubRailPanel } from "@/components/clubs/atoms/ClubHubPrimitives";
import { ClubFaceStack } from "@/components/clubs/atoms/ClubNetworkPrimitives";
import {
  ClubEventKindIcon,
  clubEventToneClass,
} from "@/components/clubs/atoms/ClubWorkspaceBadges";
import { useClubEventAttendees } from "@/lib/clubs/useClubNetwork";
import {
  useClubEventRsvp,
  useDeleteClubEvent,
  useUpsertClubEvent,
} from "@/lib/clubs/useClubWorkspace";
import { toEventKind, type ClubEventRow, type ClubRsvpState } from "@/lib/clubs/workspaceTypes";
import { formatDate, uiLang } from "@/lib/i18n/format";
import { MoreLink } from "@/components/clubs/molecules/ClubHubContext";
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

/** Trzy stany potwierdzenia. "Może" jest prawdziwą odpowiedzią - patrz A28. */
const RSVP_STATES: readonly ClubRsvpState[] = ["going", "maybe", "declined"];

function RsvpControls({
  clubId,
  eventId,
  current,
}: {
  clubId: string;
  eventId: string;
  current: string | null;
}) {
  const { t } = useTranslation();
  const rsvp = useClubEventRsvp(clubId);

  return (
    <div
      role="radiogroup"
      aria-label={t("club.network.meeting.rsvpLabel")}
      className="mt-2 flex gap-1"
    >
      {RSVP_STATES.map((state) => {
        const active = current === state;
        return (
          <button
            key={state}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={rsvp.isPending}
            onClick={() =>
              rsvp.mutate(
                { eventId, state },
                { onError: () => toast.error(t("club.network.meeting.rsvpFailed")) },
              )
            }
            className={cn(
              "inline-flex h-7 flex-1 items-center justify-center rounded-lg border px-1.5 text-[11px] font-medium transition-colors",
              active
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border/60 bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground",
              // Dark: `--primary` to jasny popiel - pełne wypełnienie gasi
              // etykietę. Kontrast bierzemy z ramki i tła (ta sama decyzja,
              // co w szynie sekcji).
              active && "dark:bg-primary/15 dark:text-foreground",
            )}
          >
            {t(`club.calendar.rsvp.${state}`)}
          </button>
        );
      })}
    </div>
  );
}

export function ClubMeetingPanel({
  clubSlug,
  clubId,
  events,
  canSeeMembers,
  canRsvp,
  canManage = false,
}: {
  clubSlug: string;
  clubId: string;
  events: readonly ClubEventRow[];
  canSeeMembers: boolean;
  canRsvp: boolean;
  /** Kurator klubu: tworzy, redaguje i usuwa terminy wprost z szyny. */
  canManage?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const lang = uiLang(i18n.language);
  const next = events[0] ?? null;
  const later = events.slice(1, 3);

  // Stan okien trzymamy PRZED wczesnym `return`, bo hooki nie mogą być
  // warunkowe - a panel bez wydarzeń nadal musi umieć otworzyć formularz.
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ClubEventRow | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const upsert = useUpsertClubEvent(clubId);
  const remove = useDeleteClubEvent(clubId);

  const attendeesQ = useClubEventAttendees({
    clubId,
    eventId: next?.id,
    // Zapytanie o nazwiska nie leci wcale, gdy klub ukrywa skład - RPC i tak
    // oddałoby zero wierszy, a niewysłane żądanie jest szybsze niż puste.
    enabled: canSeeMembers && next !== null,
  });

  const openCreate = () => {
    setEditing(null);
    setFormOpen(true);
  };

  const form =
    canManage && formOpen ? (
      <ClubEventForm
        // Klucz przestawia stan formularza przy zmianie trybu: bez niego
        // "edytuj" po "dodaj" pokazałoby puste pola.
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
    ) : null;

  if (next === null) {
    if (!canManage) return null;
    return (
      <ClubRailPanel title={t("club.network.meeting.title")} icon={CalendarClock}>
        <p className="text-[11px] leading-snug text-muted-foreground">
          {t("club.network.meeting.emptyManage")}
        </p>
        <button
          type="button"
          onClick={openCreate}
          className="mt-2 inline-flex h-7 items-center gap-1 rounded-lg border border-border/60 px-2 text-[11px] font-medium transition-colors hover:border-primary/40 hover:text-primary"
        >
          <Plus className="h-3 w-3" aria-hidden="true" />
          {t("club.eventForm.createTitle")}
        </button>
        {form}
      </ClubRailPanel>
    );
  }

  const kind = toEventKind(next.kind);
  const attendees = attendeesQ.data ?? [];
  const going = attendees.filter((row) => row.state === "going");
  // Licznik z wiersza wydarzenia jest źródłem prawdy o LICZBIE - lista nazwisk
  // bywa przycięta limitem albo ukryta regułą klubu.
  const goingCount = Math.max(next.going_count, going.length);

  return (
    <ClubRailPanel
      title={t("club.network.meeting.title")}
      icon={CalendarClock}
      action={
        <div className="flex items-center gap-1.5">
          {canManage ? (
            <button
              type="button"
              aria-label={t("club.eventForm.createTitle")}
              title={t("club.eventForm.createTitle")}
              onClick={openCreate}
              className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-border/60 text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary"
            >
              <Plus className="h-3 w-3" aria-hidden="true" />
            </button>
          ) : null}
          <MoreLink to="/club/$clubSlug/calendar" clubSlug={clubSlug} label={t("club.hub.more")} />
        </div>
      }
    >
      <div className="flex gap-2.5">
        <span
          className={cn(
            "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border",
            clubEventToneClass(kind),
          )}
        >
          <ClubEventKindIcon kind={kind} className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          {/* Tytuł prowadzi na STRONĘ TEGO spotkania, a nie do kalendarza:
              decyzja "idę / nie idę" zapada przy jednym wydarzeniu i potrzebuje
              opisu oraz pełnej listy potwierdzonych, których wiersz kalendarza
              nie ma. "Więcej" w rogu zostaje przy kalendarzu, bo to jest droga
              do POZOSTAŁYCH terminów. */}
          <Link
            to="/club/$clubSlug/e/$eventSlug"
            params={{ clubSlug, eventSlug: next.slug }}
            className="text-sm font-medium leading-tight hover:text-primary"
          >
            {pickLocalized(next, "title", lang)}
          </Link>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {formatDate(next.starts_at, lang, {
              weekday: "short",
              day: "numeric",
              month: "short",
              hour: next.all_day ? undefined : "2-digit",
              minute: next.all_day ? undefined : "2-digit",
            })}
          </p>
          {next.location !== null && next.location.trim() !== "" ? (
            <p className="mt-0.5 flex items-center gap-1 text-[11px] text-muted-foreground">
              <MapPin className="h-3 w-3 shrink-0" aria-hidden="true" />
              <span className="truncate">{next.location}</span>
            </p>
          ) : null}
          {next.meeting_url !== null && next.meeting_url.trim() !== "" ? (
            <a
              href={next.meeting_url}
              target="_blank"
              rel="noreferrer"
              className="mt-0.5 inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline"
            >
              <Video className="h-3 w-3 shrink-0" aria-hidden="true" />
              {t("club.network.meeting.join")}
            </a>
          ) : null}
        </div>
      </div>

      {/* KTO BĘDZIE - to jest cała nowość tego panelu. */}
      <div className="mt-2.5 border-t border-border/60 pt-2.5">
        {goingCount === 0 ? (
          <p className="text-[11px] leading-snug text-muted-foreground">
            {t("club.network.meeting.nobodyYet")}
          </p>
        ) : (
          <>
            <p className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
              <Users2 className="h-3 w-3 shrink-0" aria-hidden="true" />
              {t("club.network.meeting.goingCount", { count: goingCount })}
            </p>
            {going.length > 0 ? (
              <>
                <ClubFaceStack
                  className="mt-1.5"
                  faces={going.map((row) => ({
                    userId: row.user_id,
                    name: row.display_name,
                    avatarUrl: row.avatar_url,
                  }))}
                  total={goingCount}
                />
                {/* Dwa pierwsze nazwiska wypisane wprost: stos twarzy mówi
                    "ilu", a pytanie brzmi także "kogo znam". */}
                <p className="mt-1 truncate text-[11px] text-muted-foreground">
                  {going
                    .slice(0, 2)
                    .map((row) => row.display_name)
                    .join(", ")}
                  {goingCount > 2
                    ? ` ${t("club.network.meeting.andMore", { count: goingCount - 2 })}`
                    : ""}
                </p>
              </>
            ) : null}
          </>
        )}

        {canRsvp && next.rsvp_enabled ? (
          <RsvpControls clubId={clubId} eventId={next.id} current={next.my_rsvp} />
        ) : null}

        {canManage ? (
          <div className="mt-2 flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => {
                setEditing(next);
                setFormOpen(true);
              }}
              className="inline-flex h-6 items-center gap-1 rounded-md border border-border/60 px-1.5 text-[10px] font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary"
            >
              <Pencil className="h-3 w-3" aria-hidden="true" />
              {t("club.eventForm.edit")}
            </button>
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              className="inline-flex h-6 items-center gap-1 rounded-md border border-border/60 px-1.5 text-[10px] font-medium text-muted-foreground transition-colors hover:border-destructive/50 hover:text-destructive"
            >
              <Trash2 className="h-3 w-3" aria-hidden="true" />
              {t("club.eventForm.delete")}
            </button>
          </div>
        ) : null}
      </div>

      {later.length > 0 ? (
        <ul className="mt-2.5 space-y-1 border-t border-border/60 pt-2">
          {later.map((event) => (
            <li key={event.id} className="flex items-baseline justify-between gap-2 text-[11px]">
              <Link
                to="/club/$clubSlug/e/$eventSlug"
                params={{ clubSlug, eventSlug: event.slug }}
                className="truncate text-muted-foreground hover:text-primary"
              >
                {pickLocalized(event, "title", lang)}
              </Link>
              <span className="shrink-0 tabular-nums text-muted-foreground">
                {formatDate(event.starts_at, lang, { day: "numeric", month: "short" })}
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {form}

      {canManage ? (
        <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t("club.eventForm.deleteTitle")}</AlertDialogTitle>
              <AlertDialogDescription>
                {t("club.eventForm.deleteLead", {
                  title: pickLocalized(next, "title", lang),
                })}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t("club.eventForm.cancel")}</AlertDialogCancel>
              <AlertDialogAction
                disabled={remove.isPending}
                onClick={() =>
                  remove.mutate(next.id, {
                    onSuccess: () => {
                      setConfirmDelete(false);
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
    </ClubRailPanel>
  );
}
