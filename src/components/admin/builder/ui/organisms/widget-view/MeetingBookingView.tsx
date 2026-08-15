// Widget "meeting-booking" - networking 1-1: siatka slotow godzinowych
// (grupowanych po dniu) z rezerwacja jednym kliknieciem. Tryby: sloty
// wskazanego hosta (ekspert/prelegent) lub sloty networkingowe wydarzenia.
// Zalogowany host publikuje wlasne sloty inline (panel "Dodaj slot").
// Dane per-uzytkownik (booked_by_me/is_mine) - wylacznie po stronie klienta,
// bez SSR-prefetchu i wspolnego cache (patrz naglowek meetingsQuery.ts).
// i18n PL/EN, dark/light przez tokeny, 6px rounding, akcent --speakers-accent.
import { useMemo, useState, type CSSProperties } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { WidgetContent } from "@/lib/builder/types";
import { useAuth } from "@/hooks/useAuth";
import { useBuilderMode } from "@/lib/content-model/editorCanvas";
import { AppLink } from "@/components/atoms/AppLink";
import { CalendarCheck, Clock, MapPin, Plus, Trash2, X } from "@/lib/lucide-shim";
import {
  bookMeetingSlot,
  cancelMyMeetingBooking,
  createMyMeetingSlot,
  deleteMyMeetingSlot,
  formatSlotRange,
  groupSlotsByDay,
  meetingSlotsConfigured,
  meetingSlotsInput,
  meetingSlotsQueryOptions,
  type MeetingSlotRow,
} from "@/lib/builder/meetingsQuery";
import { SpeakerAvatar } from "@/components/events/SpeakerAvatar";
import { getBool, getStr, type Lang } from "./frame";

function locStr(c: WidgetContent, base: string, lang: Lang): string {
  return getStr(c, `${base}_${lang}`) || getStr(c, `${base}_pl`) || getStr(c, `${base}_en`);
}

const DURATIONS_MIN = [15, 30, 45, 60] as const;

function SlotChip({
  slot,
  lang,
  canBook,
  canManage,
  pending,
  showHost,
  onBook,
  onCancel,
  onDelete,
}: {
  slot: MeetingSlotRow;
  lang: Lang;
  canBook: boolean;
  canManage: boolean;
  pending: boolean;
  showHost: boolean;
  onBook: () => void;
  onCancel: () => void;
  onDelete: () => void;
}) {
  const range = formatSlotRange(slot, lang);
  const base =
    "inline-flex items-center gap-1.5 rounded-[6px] border px-2.5 py-1.5 text-xs font-medium transition-colors";

  const hostBadge =
    showHost && slot.host_name ? (
      <span className="inline-flex items-center gap-1">
        <SpeakerAvatar name={slot.host_name} photoUrl={slot.host_avatar_url} size="sm" />
        <span className="max-w-[10rem] truncate">{slot.host_name}</span>
      </span>
    ) : null;

  if (slot.booked_by_me) {
    return (
      <span
        className={`${base} border-transparent bg-[color:var(--speakers-accent,var(--brand))] text-[color:var(--brand-foreground,white)]`}
      >
        <CalendarCheck aria-hidden className="h-3.5 w-3.5" />
        {range}
        {hostBadge}
        <button
          type="button"
          onClick={onCancel}
          disabled={pending}
          className="ml-1 inline-flex items-center gap-0.5 rounded-[6px] bg-black/15 px-1.5 py-0.5 text-[10px] font-semibold hover:bg-black/25 disabled:opacity-50"
        >
          <X aria-hidden className="h-3 w-3" />
          {lang === "pl" ? "Anuluj" : "Cancel"}
        </button>
      </span>
    );
  }

  if (slot.is_mine) {
    return (
      <span
        className={`${base} border-[color:var(--speakers-accent,var(--brand))]/50 bg-[color:var(--speakers-accent,var(--brand))]/5 text-foreground`}
      >
        <Clock aria-hidden className="h-3.5 w-3.5 text-brand-ink" />
        {range}
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
          {slot.is_booked
            ? lang === "pl"
              ? "zarezerwowany"
              : "booked"
            : lang === "pl"
              ? "Twój slot"
              : "your slot"}
        </span>
        {canManage && (
          <button
            type="button"
            onClick={onDelete}
            disabled={pending}
            aria-label={lang === "pl" ? "Usuń slot" : "Delete slot"}
            className="ml-0.5 rounded p-0.5 text-muted-foreground hover:text-destructive disabled:opacity-50"
          >
            <Trash2 aria-hidden className="h-3 w-3" />
          </button>
        )}
      </span>
    );
  }

  if (slot.is_booked) {
    return (
      <span className={`${base} border-border/50 bg-muted/50 text-muted-foreground line-through`}>
        {range}
        {hostBadge}
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={onBook}
      disabled={!canBook || pending}
      title={
        canBook
          ? lang === "pl"
            ? "Zarezerwuj spotkanie"
            : "Book this meeting"
          : lang === "pl"
            ? "Zaloguj się, aby zarezerwować"
            : "Sign in to book"
      }
      className={`${base} border-border/70 bg-background text-foreground enabled:hover:border-[color:var(--speakers-accent,var(--brand))]/60 enabled:hover:bg-[color:var(--speakers-accent,var(--brand))]/10 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--speakers-accent,var(--brand))]/50`}
    >
      <Clock aria-hidden className="h-3.5 w-3.5 text-brand-ink" />
      {range}
      {hostBadge}
      {slot.location && (
        <span className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground">
          <MapPin aria-hidden className="h-3 w-3" />
          {slot.location}
        </span>
      )}
    </button>
  );
}

function HostManagePanel({
  lang,
  eventId,
  pending,
  onCreate,
}: {
  lang: Lang;
  eventId: string | null;
  pending: boolean;
  onCreate: (startsAtIso: string, endsAtIso: string, location: string | null) => void;
}) {
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [duration, setDuration] = useState<number>(30);
  const [location, setLocation] = useState("");
  void eventId;

  const submit = () => {
    if (!date || !time) return;
    const start = new Date(`${date}T${time}`);
    if (Number.isNaN(start.getTime())) return;
    const end = new Date(start.getTime() + duration * 60_000);
    onCreate(start.toISOString(), end.toISOString(), location.trim() || null);
  };

  return (
    <div className="rounded-[6px] border border-dashed border-[color:var(--speakers-accent,var(--brand))]/40 bg-[color:var(--speakers-accent,var(--brand))]/5 p-3">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {lang === "pl" ? "Opublikuj swój slot" : "Publish your slot"}
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-[11px] text-muted-foreground">
          {lang === "pl" ? "Data" : "Date"}
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="h-9 rounded-[6px] border border-border/70 bg-background px-2 text-sm text-foreground"
          />
        </label>
        <label className="flex flex-col gap-1 text-[11px] text-muted-foreground">
          {lang === "pl" ? "Godzina" : "Time"}
          <input
            type="time"
            value={time}
            onChange={(e) => setTime(e.target.value)}
            className="h-9 rounded-[6px] border border-border/70 bg-background px-2 text-sm text-foreground"
          />
        </label>
        <label className="flex flex-col gap-1 text-[11px] text-muted-foreground">
          {lang === "pl" ? "Długość" : "Duration"}
          <select
            value={duration}
            onChange={(e) => setDuration(Number(e.target.value) || 30)}
            className="h-9 rounded-[6px] border border-border/70 bg-background px-2 text-sm text-foreground"
          >
            {DURATIONS_MIN.map((m) => (
              <option key={m} value={m}>
                {m} min
              </option>
            ))}
          </select>
        </label>
        <label className="flex min-w-[10rem] flex-1 flex-col gap-1 text-[11px] text-muted-foreground">
          {lang === "pl" ? "Miejsce / link (opcjonalnie)" : "Place / link (optional)"}
          <input
            type="text"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder={lang === "pl" ? "np. stolik B2 lub link" : "e.g. table B2 or a link"}
            className="h-9 rounded-[6px] border border-border/70 bg-background px-2 text-sm text-foreground placeholder:text-muted-foreground/60"
          />
        </label>
        <button
          type="button"
          onClick={submit}
          disabled={pending || !date || !time}
          className="inline-flex h-9 items-center gap-1.5 rounded-[6px] bg-[color:var(--speakers-accent,var(--brand))] px-3 text-sm font-semibold text-[color:var(--brand-foreground,white)] transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          <Plus aria-hidden className="h-4 w-4" />
          {lang === "pl" ? "Dodaj slot" : "Add slot"}
        </button>
      </div>
    </div>
  );
}

export function MeetingBookingView({ c, lang }: { c: WidgetContent; lang: Lang }) {
  const inBuilder = useBuilderMode() !== null;
  const { user } = useAuth();
  const qc = useQueryClient();

  const heading = locStr(c, "heading", lang);
  const intro = locStr(c, "intro", lang);
  const accent = getStr(c, "accentColor");
  const allowHostManage = getBool(c, "allowHostManage", true);
  const showHost = getBool(c, "showHost", true);
  const input = meetingSlotsInput(c);
  const configured = meetingSlotsConfigured(input);

  const slotsQ = useQuery({
    ...meetingSlotsQueryOptions(c, user?.id ?? null),
    enabled: configured,
  });
  const slots = slotsQ.data ?? [];
  const days = useMemo(() => groupSlotsByDay(slots, lang), [slots, lang]);

  const invalidate = () => qc.invalidateQueries({ queryKey: ["builder-meeting-slots"] });
  const onError = (e: unknown) => {
    const msg = e instanceof Error ? e.message : "";
    if (msg.includes("already booked")) {
      toast.error(lang === "pl" ? "Ten slot został już zarezerwowany." : "This slot is taken.");
    } else if (msg.includes("own slot")) {
      toast.error(
        lang === "pl" ? "Nie można zarezerwować własnego slotu." : "You cannot book your own slot.",
      );
    } else {
      toast.error(lang === "pl" ? "Operacja nie powiodła się." : "The operation failed.");
    }
  };

  const bookM = useMutation({
    mutationFn: (slotId: string) => bookMeetingSlot(slotId),
    onSuccess: () => {
      invalidate();
      toast.success(lang === "pl" ? "Spotkanie zarezerwowane." : "Meeting booked.");
    },
    onError,
  });
  const cancelM = useMutation({
    mutationFn: (slotId: string) => cancelMyMeetingBooking(slotId),
    onSuccess: () => {
      invalidate();
      toast.success(lang === "pl" ? "Rezerwacja anulowana." : "Booking cancelled.");
    },
    onError,
  });
  const createM = useMutation({
    mutationFn: (args: { startsAt: string; endsAt: string; location: string | null }) =>
      createMyMeetingSlot({
        startsAt: args.startsAt,
        endsAt: args.endsAt,
        eventId: input.mode === "event" && input.eventId ? input.eventId : null,
        location: args.location,
      }),
    onSuccess: () => {
      invalidate();
      toast.success(lang === "pl" ? "Slot opublikowany." : "Slot published.");
    },
    onError,
  });
  const deleteM = useMutation({
    mutationFn: (slotId: string) => deleteMyMeetingSlot(slotId),
    onSuccess: () => {
      invalidate();
      toast.success(lang === "pl" ? "Slot usunięty." : "Slot deleted.");
    },
    onError,
  });

  const pending = bookM.isPending || cancelM.isPending || createM.isPending || deleteM.isPending;

  const accentStyle: CSSProperties | undefined = accent
    ? { ["--speakers-accent" as string]: accent }
    : undefined;

  if (!configured) {
    if (inBuilder) {
      return (
        <section className="cms-meeting-booking">
          <p className="rounded-[6px] border border-dashed border-border/70 p-8 text-center text-sm text-muted-foreground">
            {lang === "pl"
              ? "Wskaż hosta lub wydarzenie w panelu widgetu, aby wyświetlić sloty."
              : "Pick a host or an event in the widget panel to show slots."}
          </p>
        </section>
      );
    }
    return null;
  }

  const canManage =
    allowHostManage && !!user && (input.mode === "event" || user.id === input.hostUserId);

  return (
    <section className="cms-meeting-booking space-y-5" style={accentStyle}>
      {(heading || intro) && (
        <header className="space-y-2">
          {heading ? <h2 className="cms-block-heading text-foreground">{heading}</h2> : null}
          {intro ? <p className="max-w-2xl text-sm text-muted-foreground">{intro}</p> : null}
        </header>
      )}

      {!user && (
        <p className="text-xs text-muted-foreground">
          {lang === "pl"
            ? "Zaloguj się, aby zarezerwować spotkanie 1-1. "
            : "Sign in to book a 1-1 meeting. "}
          <AppLink href="/login" className="font-medium text-brand-ink hover:underline">
            {lang === "pl" ? "Zaloguj się" : "Sign in"}
          </AppLink>
        </p>
      )}

      {canManage && (
        <HostManagePanel
          lang={lang}
          eventId={input.mode === "event" ? input.eventId : null}
          pending={createM.isPending}
          onCreate={(startsAt, endsAt, location) => createM.mutate({ startsAt, endsAt, location })}
        />
      )}

      {slotsQ.isLoading ? (
        <div aria-hidden className="space-y-2">
          {[0, 1].map((i) => (
            <div key={i} className="h-16 animate-pulse rounded-[6px] bg-muted/60" />
          ))}
        </div>
      ) : days.length === 0 ? (
        <p className="rounded-[6px] border border-dashed border-border/70 p-8 text-center text-sm text-muted-foreground">
          {lang === "pl" ? "Brak dostępnych terminów." : "No available slots."}
        </p>
      ) : (
        <div className="space-y-4">
          {days.map((day) => (
            <div key={day.dayKey} className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {day.label}
              </h3>
              <ul className="flex flex-wrap gap-2">
                {day.slots.map((slot) => (
                  <li key={slot.id}>
                    <SlotChip
                      slot={slot}
                      lang={lang}
                      canBook={!!user}
                      canManage={canManage}
                      pending={pending}
                      showHost={showHost && input.mode === "event"}
                      onBook={() => bookM.mutate(slot.id)}
                      onCancel={() => cancelM.mutate(slot.id)}
                      onDelete={() => deleteM.mutate(slot.id)}
                    />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
