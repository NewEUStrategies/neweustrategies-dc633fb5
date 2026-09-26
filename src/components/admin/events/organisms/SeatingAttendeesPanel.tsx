// Organizm: UCZESTNICY do rozsadzenia w planie sali.
//
// TYLKO UPRAWNIENI. Lista pochodzi z `admin_event_seating_candidates`, ktora
// oddaje wylacznie zgloszenia zajmujace miejsce (approved|attended|no_show) -
// organizator nie widzi osob, ktorych i tak nie da sie posadzic (ta sama
// lekcja, co w wyszukiwarce gieldy spotkan). Filtry i stronicowanie ida do
// bazy.
//
// DWIE DROGI DO MIEJSCA, OBIE ROWNORZEDNE: przeciagniecie osoby na plotno
// (mysz) albo "Wskaz miejsce" (klawiatura, czytnik ekranu) - potem Enter na
// miejscu w plotnie albo "Posadz tutaj" w widoku tabeli.
import { useState } from "react";
import { useDraggable } from "@dnd-kit/core";
import { useTranslation } from "react-i18next";

import { AdminCatalogListState } from "@/components/admin/molecules/AdminCatalogListState";
import { AdminFormSwitchRow } from "@/components/admin/molecules/AdminFormSwitchRow";
import { FormSelect } from "@/components/atoms/FormSelect";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { GripVertical, Search } from "@/lib/lucide-shim";
import { adminSeatingErrorMessage } from "@/lib/events/adminSeatingErrors";
import type { SeatingCandidateRow } from "@/lib/events/seatingApi";
import { useSeatingCandidates } from "@/lib/events/useEventSeating";
import { uiLang } from "@/lib/i18n/format";
import { pickLocalized } from "@/lib/i18n/pickLocalized";
import { ensureSeatingI18n } from "@/lib/i18n-admin-event-seating";
import { cn } from "@/lib/utils";

ensureSeatingI18n();

const ALL = "__all__";
const PAGE = 50;

/** Prefiks identyfikatora przeciagania - plotno rozpoznaje po nim uczestnika. */
export const CANDIDATE_DRAG_PREFIX = "seat-candidate:";

export interface SeatingTicketOption {
  id: string;
  label: string;
}

export function candidateName(row: SeatingCandidateRow): string {
  return `${row.first_name} ${row.last_name}`.trim();
}

function CandidateItem({
  row,
  armed,
  onArm,
}: {
  row: SeatingCandidateRow;
  armed: boolean;
  onArm: (row: SeatingCandidateRow | null) => void;
}) {
  const { t, i18n } = useTranslation();
  const lang = uiLang(i18n.language);
  const name = candidateName(row);
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `${CANDIDATE_DRAG_PREFIX}${row.registration_id}`,
    data: { registrationId: row.registration_id, name },
  });
  const ticket = pickLocalized(row, "ticket_name", lang);
  const meta = [row.company, ticket].filter((part) => part !== null && part !== "").join(" · ");

  return (
    <li
      ref={setNodeRef}
      className={cn(
        "flex items-center gap-2 rounded-[6px] border border-border bg-card p-2",
        armed ? "ring-2 ring-brand" : null,
        isDragging ? "opacity-60" : null,
      )}
    >
      <button
        type="button"
        className="cursor-grab touch-none text-muted-foreground"
        aria-label={t("adminEventSeating.attendees.drag", { name })}
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-4 w-4" aria-hidden="true" />
      </button>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{name}</p>
        {meta === "" ? null : <p className="truncate text-xs text-muted-foreground">{meta}</p>}
        <p className="text-xs text-muted-foreground">
          {row.seat_id === null
            ? t("adminEventSeating.attendees.noSeat")
            : t("adminEventSeating.attendees.seat", { label: row.seat_label })}
        </p>
      </div>
      {armed ? (
        <Badge variant="secondary">{t("adminEventSeating.attendees.armed")}</Badge>
      ) : null}
      <Button
        size="sm"
        variant={armed ? "default" : "outline"}
        aria-pressed={armed}
        aria-label={t("adminEventSeating.attendees.arm", { name })}
        onClick={() => onArm(armed ? null : row)}
      >
        <Search className="h-4 w-4" aria-hidden="true" />
      </Button>
    </li>
  );
}

export interface SeatingAttendeesPanelProps {
  eventId: string;
  mapId: string;
  tickets: readonly SeatingTicketOption[];
  armedId: string | null;
  onArm: (row: SeatingCandidateRow | null) => void;
}

export function SeatingAttendeesPanel({ eventId, mapId, tickets, armedId, onArm }: SeatingAttendeesPanelProps) {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const [onlyUnassigned, setOnlyUnassigned] = useState(true);
  const [ticketId, setTicketId] = useState(ALL);
  const [limit, setLimit] = useState(PAGE);

  const query = {
    mapId,
    q,
    ticketTypeId: ticketId === ALL ? null : ticketId,
    onlyUnassigned,
    limit,
    offset: 0,
  };
  const candidates = useSeatingCandidates(eventId, query);
  const rows = candidates.data?.rows ?? [];
  const total = candidates.data?.total ?? 0;
  const filtered = q !== "" || ticketId !== ALL || onlyUnassigned;

  const submit = () => {
    setQ(search.trim());
    setLimit(PAGE);
  };

  return (
    <section aria-labelledby="seating-attendees-title" className="space-y-3">
      <div className="flex items-baseline justify-between gap-2">
        <h3 id="seating-attendees-title" className="text-sm font-semibold">
          {t("adminEventSeating.attendees.title")}
        </h3>
        <span className="text-xs text-muted-foreground">
          {t("adminEventSeating.attendees.count", { count: total })}
        </span>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="seating-attendees-q">{t("adminEventSeating.attendees.search")}</Label>
        <div className="flex gap-2">
          <Input
            id="seating-attendees-q"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") submit();
            }}
          />
          <Button variant="outline" size="sm" onClick={submit} aria-label={t("adminEventSeating.attendees.search")}>
            <Search className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
      </div>
      {tickets.length === 0 ? null : (
        <div className="space-y-1.5">
          <Label htmlFor="seating-attendees-ticket">{t("adminEventSeating.attendees.ticket")}</Label>
          <FormSelect
            id="seating-attendees-ticket"
            value={ticketId}
            options={[
              { value: ALL, label: t("adminEventSeating.attendees.allTickets") },
              ...tickets.map((ticket) => ({ value: ticket.id, label: ticket.label })),
            ]}
            onValueChange={(value) => {
              setTicketId(value);
              setLimit(PAGE);
            }}
          />
        </div>
      )}
      <AdminFormSwitchRow
        label={t("adminEventSeating.attendees.onlyUnassigned")}
        checked={onlyUnassigned}
        onCheckedChange={(value) => {
          setOnlyUnassigned(value);
          setLimit(PAGE);
        }}
      />
      <AdminCatalogListState
        isLoading={candidates.isLoading}
        loadingLabel={t("adminEventSeating.attendees.loading")}
        errorMessage={candidates.error === null ? null : adminSeatingErrorMessage(candidates.error)}
        isEmpty={rows.length === 0}
        emptyLabel={
          filtered ? t("adminEventSeating.attendees.emptyFiltered") : t("adminEventSeating.attendees.empty")
        }
      >
        <ul className="max-h-[60vh] space-y-2 overflow-y-auto pr-1">
          {rows.map((row) => (
            <CandidateItem
              key={row.registration_id}
              row={row}
              armed={row.registration_id === armedId}
              onArm={onArm}
            />
          ))}
        </ul>
        {rows.length < total ? (
          <Button variant="outline" size="sm" className="w-full" onClick={() => setLimit(limit + PAGE)}>
            {t("adminEventSeating.attendees.loadMore")}
          </Button>
        ) : null}
      </AdminCatalogListState>
    </section>
  );
}
