// /admin/community/events - CRUD wydarzeń + zmiana statusu + akcja przypomnień.
//
// i18n: cały panel szedł wcześniej przez ręczne `isPl ? "..." : "..."` (sto
// wyrażeń warunkowych, `isPl` przekazywane w dół jako props). Teraz jedno
// źródło prawdy w `i18n-admin-community-events.ts`; `isPl` zostało wyłącznie
// tam, gdzie faktycznie wybiera JĘZYK TREŚCI z bliźniaczych kolumn
// (`title_pl`/`title_en`) - i tam też przez kanoniczny `pickLocalized`, więc
// puste tłumaczenie nie renderuje już pustego wiersza.
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { format } from "date-fns";
import { Calendar, Plus, Trash2, Users, Save, Ban, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { FloatingInput, FloatingTextarea } from "@/components/ui/floating-input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  createEvent,
  deleteEvent,
  fetchAdminEvents,
  runEventReminders,
  updateEvent,
  updateEventStatus,
  EVENT_KINDS,
  EVENT_KIND_LABEL_KEYS,
  EVENT_STATUS_LABEL_KEYS,
  isEventKind,
  isEventStatus,
  type EventRow,
  type EventStatus,
} from "@/lib/admin/community";
import { EventSpeakersManager } from "@/components/admin/community/EventSpeakersManager";
import { pickLocalized, type LocaleCode } from "@/lib/i18n/pickLocalized";
import { ensureI18n as ensureAdminCommunityEventsI18n } from "@/lib/i18n-admin-community-events";

export const Route = createFileRoute("/admin/community/events")({
  head: () => ({ meta: [{ title: "Events · Community · Admin" }] }),
  component: AdminCommunityEvents,
});

const STATUS_TONE: Record<EventStatus, string> = {
  draft: "bg-muted text-muted-foreground",
  published: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  cancelled: "bg-destructive/15 text-destructive",
};

function AdminCommunityEvents() {
  ensureAdminCommunityEventsI18n();
  const { t, i18n } = useTranslation();
  // Tylko do wyboru języka TREŚCI (bliźniacze kolumny), nie do etykiet UI.
  const lang: LocaleCode = (i18n.language ?? "pl").startsWith("en") ? "en" : "pl";
  const qc = useQueryClient();
  const [status, setStatus] = useState<EventStatus | "all">("all");
  const [q, setQ] = useState("");
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<EventRow | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const eventsQ = useQuery({
    queryKey: ["admin-community-events", status, q],
    queryFn: () => fetchAdminEvents({ status, q }),
    staleTime: 15_000,
  });

  const statusM = useMutation({
    mutationFn: ({ id, next }: { id: string; next: EventStatus }) => updateEventStatus(id, next),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-community-events"] });
      qc.invalidateQueries({ queryKey: ["admin-community-stats"] });
      toast.success(t("adminCommunityEvents.toasts.updated"));
    },
    onError: () => toast.error(t("adminCommunityEvents.toasts.updateFailed")),
  });

  const deleteM = useMutation({
    mutationFn: (id: string) => deleteEvent(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-community-events"] });
      toast.success(t("adminCommunityEvents.toasts.deleted"));
      setConfirmDeleteId(null);
    },
    onError: () => toast.error(t("adminCommunityEvents.toasts.failed")),
  });

  const remindersM = useMutation({
    mutationFn: runEventReminders,
    onSuccess: (count) => toast.success(t("adminCommunityEvents.toasts.remindersSent", { count })),
    onError: () => toast.error(t("adminCommunityEvents.toasts.failed")),
  });

  const rows = eventsQ.data ?? [];

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center gap-3 justify-between">
        <div>
          <h2 className="text-xl font-semibold">{t("adminCommunityEvents.title")}</h2>
          <p className="text-sm text-muted-foreground">{t("adminCommunityEvents.subtitle")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={status} onValueChange={(v) => setStatus(v as EventStatus | "all")}>
            <SelectTrigger className="w-[160px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("adminCommunityEvents.filterAll")}</SelectItem>
              {Object.entries(EVENT_STATUS_LABEL_KEYS).map(([value, labelKey]) => (
                <SelectItem key={value} value={value}>
                  {t(labelKey)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("adminCommunityEvents.searchPlaceholder")}
            className="w-[200px]"
          />
          <Button
            variant="outline"
            size="sm"
            onClick={() => remindersM.mutate()}
            disabled={remindersM.isPending}
          >
            <Calendar className="w-4 h-4 mr-2" />
            {t("adminCommunityEvents.remindersAction")}
          </Button>
          <Button onClick={() => setCreating(true)} size="sm">
            <Plus className="w-4 h-4 mr-2" />
            {t("adminCommunityEvents.newAction")}
          </Button>
        </div>
      </header>

      <Card>
        <CardContent className="p-0">
          {eventsQ.isLoading ? (
            <div className="p-6 text-sm text-muted-foreground">
              {t("adminCommunityEvents.loading")}
            </div>
          ) : rows.length === 0 ? (
            <div className="p-6 text-sm text-muted-foreground text-center">
              {t("adminCommunityEvents.empty")}
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {rows.map((e) => (
                <li key={e.id} className="p-3 hover:bg-muted/40 flex items-start gap-3">
                  <div className="flex-1 min-w-0 space-y-1">
                    <div className="flex items-center gap-2 text-sm">
                      <button
                        type="button"
                        onClick={() => setEditing(e)}
                        className="font-medium truncate hover:underline text-left"
                      >
                        {pickLocalized(e, "title", lang) || e.slug}
                      </button>
                      {/* Plakietki pokazywały surowe wartości kolumn (`draft`,
                          `in_person`) w obu językach - teraz idą przez te same
                          klucze co filtr i selekt rodzaju. Nieznana wartość
                          (dopisany wariant w bazie) renderuje się dosłownie,
                          zamiast zniknąć. */}
                      <Badge
                        className={
                          isEventStatus(e.status) ? STATUS_TONE[e.status] : "bg-muted text-current"
                        }
                      >
                        {isEventStatus(e.status) ? t(EVENT_STATUS_LABEL_KEYS[e.status]) : e.status}
                      </Badge>
                      <Badge variant="outline" className="text-[10px]">
                        {isEventKind(e.kind) ? t(EVENT_KIND_LABEL_KEYS[e.kind]) : e.kind}
                      </Badge>
                      {e.visibility === "members" && (
                        <Badge variant="outline" className="text-[10px]">
                          <Users className="w-3 h-3 mr-1" />
                          {t("adminCommunityEvents.membersOnlyBadge")}
                        </Badge>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {format(new Date(e.starts_at), "yyyy-MM-dd HH:mm")} · /{e.slug}
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    {e.status !== "published" && (
                      <Button
                        variant="ghost"
                        size="icon"
                        title={t("adminCommunityEvents.actions.publish")}
                        onClick={() => statusM.mutate({ id: e.id, next: "published" })}
                      >
                        <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                      </Button>
                    )}
                    {e.status !== "cancelled" && (
                      <Button
                        variant="ghost"
                        size="icon"
                        title={t("adminCommunityEvents.actions.cancelEvent")}
                        onClick={() => statusM.mutate({ id: e.id, next: "cancelled" })}
                      >
                        <Ban className="w-4 h-4 text-destructive" />
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-destructive"
                      title={t("adminCommunityEvents.actions.deleteEvent")}
                      onClick={() => setConfirmDeleteId(e.id)}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {creating && (
        <CreateEventDialog
          onClose={() => setCreating(false)}
          onCreated={() => {
            qc.invalidateQueries({ queryKey: ["admin-community-events"] });
            setCreating(false);
          }}
        />
      )}

      {editing && (
        <EditEventDialog
          event={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: ["admin-community-events"] });
            setEditing(null);
          }}
        />
      )}

      <Dialog open={!!confirmDeleteId} onOpenChange={(open) => !open && setConfirmDeleteId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("adminCommunityEvents.deleteTitle")}</DialogTitle>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDeleteId(null)}>
              {t("adminCommunityEvents.common.cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={() => confirmDeleteId && deleteM.mutate(confirmDeleteId)}
              disabled={deleteM.isPending}
            >
              {t("adminCommunityEvents.common.delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function CreateEventDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { t } = useTranslation();
  const [slug, setSlug] = useState("");
  const [titlePl, setTitlePl] = useState("");
  const [titleEn, setTitleEn] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [kind, setKind] = useState<string>("webinar");
  const [visibility, setVisibility] = useState<"public" | "members">("public");

  const createM = useMutation({
    mutationFn: () =>
      createEvent({
        slug,
        title_pl: titlePl,
        title_en: titleEn,
        starts_at: new Date(startsAt).toISOString(),
        kind,
        visibility,
      }),
    onSuccess: () => {
      toast.success(t("adminCommunityEvents.toasts.created"));
      onCreated();
    },
    onError: (e) => toast.error(String((e as Error).message)),
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("adminCommunityEvents.createTitle")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <FloatingInput
            label="Slug"
            value={slug}
            onChange={(e) => setSlug(e.target.value.toLowerCase())}
          />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <FloatingInput
              label={t("adminCommunityEvents.fields.titlePl")}
              value={titlePl}
              onChange={(e) => setTitlePl(e.target.value)}
            />
            <FloatingInput
              label={t("adminCommunityEvents.fields.titleEn")}
              value={titleEn}
              onChange={(e) => setTitleEn(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <FloatingInput
              label={t("adminCommunityEvents.fields.startsAt")}
              type="datetime-local"
              value={startsAt}
              onChange={(e) => setStartsAt(e.target.value)}
            />
            <div className="grid gap-1.5">
              <Label htmlFor="event-kind">{t("adminCommunityEvents.fields.kind")}</Label>
              <Select value={kind} onValueChange={setKind}>
                <SelectTrigger id="event-kind">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {EVENT_KINDS.map((value) => (
                    <SelectItem key={value} value={value}>
                      {t(EVENT_KIND_LABEL_KEYS[value])}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="event-visibility">{t("adminCommunityEvents.fields.visibility")}</Label>
            <Select
              value={visibility}
              onValueChange={(v) => setVisibility(v as "public" | "members")}
            >
              <SelectTrigger id="event-visibility">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="public">
                  {t("adminCommunityEvents.visibility.public")}
                </SelectItem>
                <SelectItem value="members">
                  {t("adminCommunityEvents.visibility.members")}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("adminCommunityEvents.common.cancel")}
          </Button>
          <Button
            onClick={() => createM.mutate()}
            disabled={createM.isPending || !slug || !titlePl || !titleEn || !startsAt}
          >
            <Save className="w-4 h-4 mr-2" />
            {t("adminCommunityEvents.createAction")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditEventDialog({
  event,
  onClose,
  onSaved,
}: {
  event: EventRow;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const [titlePl, setTitlePl] = useState(event.title_pl);
  const [titleEn, setTitleEn] = useState(event.title_en);
  const [descPl, setDescPl] = useState(event.description_pl ?? "");
  const [descEn, setDescEn] = useState(event.description_en ?? "");
  const [startsAt, setStartsAt] = useState(format(new Date(event.starts_at), "yyyy-MM-dd'T'HH:mm"));
  const [joinUrl, setJoinUrl] = useState(event.join_url ?? "");
  const [capacity, setCapacity] = useState<string>(event.capacity?.toString() ?? "");
  const [rsvpOpensAt, setRsvpOpensAt] = useState<string>(
    event.rsvp_opens_at ? format(new Date(event.rsvp_opens_at), "yyyy-MM-dd'T'HH:mm") : "",
  );
  const [earlyRsvpRank, setEarlyRsvpRank] = useState<string>(
    event.early_rsvp_rank?.toString() ?? "",
  );
  // Bilet płatny: cena trzymana jest w groszach/centach, ale redaktor wpisuje
  // kwotę w jednostkach głównych. Pusto = wydarzenie bezpłatne (RSVP).
  const [ticketPrice, setTicketPrice] = useState<string>(
    event.ticket_price_cents && event.ticket_price_cents > 0
      ? (event.ticket_price_cents / 100).toFixed(2)
      : "",
  );
  const [ticketCurrency, setTicketCurrency] = useState<string>(event.ticket_currency || "PLN");

  const saveM = useMutation({
    mutationFn: () =>
      updateEvent(event.id, {
        title_pl: titlePl,
        title_en: titleEn,
        description_pl: descPl || null,
        description_en: descEn || null,
        starts_at: new Date(startsAt).toISOString(),
        join_url: joinUrl || null,
        capacity: capacity ? Number(capacity) : null,
        rsvp_opens_at: rsvpOpensAt ? new Date(rsvpOpensAt).toISOString() : null,
        early_rsvp_rank: earlyRsvpRank ? Number(earlyRsvpRank) : null,
        ticket_price_cents: ticketPrice.trim()
          ? Math.max(0, Math.round(Number(ticketPrice.replace(",", ".")) * 100))
          : null,
        ticket_currency: ticketCurrency || "PLN",
      }),
    onSuccess: () => {
      toast.success(t("adminCommunityEvents.toasts.saved"));
      onSaved();
    },
    onError: (e) => toast.error(String((e as Error).message)),
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("adminCommunityEvents.editTitle")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <FloatingInput
              label={t("adminCommunityEvents.fields.titlePl")}
              value={titlePl}
              onChange={(e) => setTitlePl(e.target.value)}
            />
            <FloatingInput
              label={t("adminCommunityEvents.fields.titleEn")}
              value={titleEn}
              onChange={(e) => setTitleEn(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <FloatingTextarea
              label={t("adminCommunityEvents.fields.descriptionPl")}
              rows={4}
              value={descPl}
              onChange={(e) => setDescPl(e.target.value)}
            />
            <FloatingTextarea
              label={t("adminCommunityEvents.fields.descriptionEn")}
              rows={4}
              value={descEn}
              onChange={(e) => setDescEn(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <FloatingInput
              label={t("adminCommunityEvents.fields.startsAt")}
              type="datetime-local"
              value={startsAt}
              onChange={(e) => setStartsAt(e.target.value)}
            />
            <FloatingInput
              label={t("adminCommunityEvents.fields.capacity")}
              type="number"
              value={capacity}
              onChange={(e) => setCapacity(e.target.value)}
            />
            <FloatingInput
              label="Join URL"
              value={joinUrl}
              onChange={(e) => setJoinUrl(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <FloatingInput
                label={t("adminCommunityEvents.fields.rsvpOpensAt")}
                type="datetime-local"
                value={rsvpOpensAt}
                onChange={(e) => setRsvpOpensAt(e.target.value)}
              />
              <p className="pl-1 text-[11px] text-muted-foreground">
                {t("adminCommunityEvents.fields.rsvpOpensAtHint")}
              </p>
            </div>
            <div className="space-y-1.5">
              <FloatingInput
                label={t("adminCommunityEvents.fields.earlyRsvpRank")}
                type="number"
                min={0}
                value={earlyRsvpRank}
                onChange={(e) => setEarlyRsvpRank(e.target.value)}
              />
              <p className="pl-1 text-[11px] text-muted-foreground">
                {t("adminCommunityEvents.fields.earlyRsvpRankHint")}
              </p>
            </div>
          </div>

          {/* Bilet płatny: kwota jest źródłem prawdy dla checkoutu (server
              wylicza ją z tego wiersza), więc pusta wartość = wstęp wolny. */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <FloatingInput
                label={t("adminCommunityEvents.fields.ticketPrice")}
                type="number"
                min={0}
                step="0.01"
                value={ticketPrice}
                onChange={(e) => setTicketPrice(e.target.value)}
              />
              <p className="pl-1 text-[11px] text-muted-foreground">
                {t("adminCommunityEvents.fields.ticketPriceHint")}
              </p>
            </div>
            <div className="space-y-1.5">
              <label className="block text-[11px] text-muted-foreground" htmlFor="ticket-currency">
                {t("adminCommunityEvents.fields.ticketCurrency")}
              </label>
              <select
                id="ticket-currency"
                value={ticketCurrency}
                onChange={(e) => setTicketCurrency(e.target.value)}
                className="h-10 w-full rounded-[6px] border border-input bg-background px-3 text-[0.8125rem]"
              >
                <option value="PLN">PLN</option>
                <option value="EUR">EUR</option>
              </select>
            </div>
          </div>

          {/* Prelegenci wydarzenia (event_speakers) + profil prelegenta
              (speaker_profiles z mostem do CRM). */}
          <div className="rounded-[6px] border border-border/60 bg-muted/20 p-3">
            <EventSpeakersManager eventId={event.id} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("adminCommunityEvents.common.cancel")}
          </Button>
          <Button onClick={() => saveM.mutate()} disabled={saveM.isPending}>
            <Save className="w-4 h-4 mr-2" />
            {t("adminCommunityEvents.common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
