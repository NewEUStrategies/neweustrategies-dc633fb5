// /admin/community/events — CRUD wydarzeń + zmiana statusu + akcja przypomnień.
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
import { Textarea } from "@/components/ui/textarea";
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
  type EventRow,
  type EventStatus,
} from "@/lib/admin/community";

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
  const { i18n } = useTranslation();
  const isPl = (i18n.language ?? "pl").startsWith("pl");
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
      toast.success(isPl ? "Zaktualizowano" : "Updated");
    },
    onError: () => toast.error(isPl ? "Błąd zapisu" : "Update failed"),
  });

  const deleteM = useMutation({
    mutationFn: (id: string) => deleteEvent(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-community-events"] });
      toast.success(isPl ? "Usunięto" : "Deleted");
      setConfirmDeleteId(null);
    },
    onError: () => toast.error(isPl ? "Błąd" : "Failed"),
  });

  const remindersM = useMutation({
    mutationFn: runEventReminders,
    onSuccess: (count) =>
      toast.success(isPl ? `Wysłano ${count} przypomnień` : `Sent ${count} reminders`),
    onError: () => toast.error(isPl ? "Błąd" : "Failed"),
  });

  const rows = eventsQ.data ?? [];

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center gap-3 justify-between">
        <div>
          <h2 className="text-xl font-semibold">{isPl ? "Wydarzenia" : "Events"}</h2>
          <p className="text-sm text-muted-foreground">
            {isPl
              ? "Zarządzaj webinarami, briefingami i innymi wydarzeniami."
              : "Manage webinars, briefings and other events."}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={status} onValueChange={(v) => setStatus(v as EventStatus | "all")}>
            <SelectTrigger className="w-[160px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{isPl ? "Wszystkie" : "All"}</SelectItem>
              <SelectItem value="draft">{isPl ? "Robocze" : "Drafts"}</SelectItem>
              <SelectItem value="published">{isPl ? "Opublikowane" : "Published"}</SelectItem>
              <SelectItem value="cancelled">{isPl ? "Anulowane" : "Cancelled"}</SelectItem>
            </SelectContent>
          </Select>
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={isPl ? "Szukaj…" : "Search…"}
            className="w-[200px]"
          />
          <Button
            variant="outline"
            size="sm"
            onClick={() => remindersM.mutate()}
            disabled={remindersM.isPending}
          >
            <Calendar className="w-4 h-4 mr-2" />
            {isPl ? "Przypomnienia" : "Reminders"}
          </Button>
          <Button onClick={() => setCreating(true)} size="sm">
            <Plus className="w-4 h-4 mr-2" />
            {isPl ? "Nowe" : "New"}
          </Button>
        </div>
      </header>

      <Card>
        <CardContent className="p-0">
          {eventsQ.isLoading ? (
            <div className="p-6 text-sm text-muted-foreground">
              {isPl ? "Ładowanie…" : "Loading…"}
            </div>
          ) : rows.length === 0 ? (
            <div className="p-6 text-sm text-muted-foreground text-center">
              {isPl ? "Brak wydarzeń." : "No events."}
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
                        {isPl ? e.title_pl : e.title_en}
                      </button>
                      <Badge className={STATUS_TONE[e.status as EventStatus]}>{e.status}</Badge>
                      <Badge variant="outline" className="text-[10px]">
                        {e.kind}
                      </Badge>
                      {e.visibility === "members" && (
                        <Badge variant="outline" className="text-[10px]">
                          <Users className="w-3 h-3 mr-1" />
                          {isPl ? "członkowie" : "members"}
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
                        title={isPl ? "Opublikuj" : "Publish"}
                        onClick={() => statusM.mutate({ id: e.id, next: "published" })}
                      >
                        <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                      </Button>
                    )}
                    {e.status !== "cancelled" && (
                      <Button
                        variant="ghost"
                        size="icon"
                        title={isPl ? "Anuluj" : "Cancel"}
                        onClick={() => statusM.mutate({ id: e.id, next: "cancelled" })}
                      >
                        <Ban className="w-4 h-4 text-destructive" />
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-destructive"
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
          isPl={isPl}
          onClose={() => setCreating(false)}
          onCreated={() => {
            qc.invalidateQueries({ queryKey: ["admin-community-events"] });
            setCreating(false);
          }}
        />
      )}

      {editing && (
        <EditEventDialog
          isPl={isPl}
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
            <DialogTitle>{isPl ? "Usunąć wydarzenie?" : "Delete event?"}</DialogTitle>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDeleteId(null)}>
              {isPl ? "Anuluj" : "Cancel"}
            </Button>
            <Button
              variant="destructive"
              onClick={() => confirmDeleteId && deleteM.mutate(confirmDeleteId)}
              disabled={deleteM.isPending}
            >
              {isPl ? "Usuń" : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function CreateEventDialog({
  isPl,
  onClose,
  onCreated,
}: {
  isPl: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [slug, setSlug] = useState("");
  const [titlePl, setTitlePl] = useState("");
  const [titleEn, setTitleEn] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [kind, setKind] = useState("webinar");
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
      toast.success(isPl ? "Utworzono" : "Created");
      onCreated();
    },
    onError: (e) => toast.error(String((e as Error).message)),
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{isPl ? "Nowe wydarzenie" : "New event"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid gap-1.5">
            <Label>Slug</Label>
            <Input
              value={slug}
              onChange={(e) => setSlug(e.target.value.toLowerCase())}
              placeholder="np. webinar-eu-tech-2026"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label>{isPl ? "Tytuł PL" : "Title PL"}</Label>
              <Input value={titlePl} onChange={(e) => setTitlePl(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label>{isPl ? "Tytuł EN" : "Title EN"}</Label>
              <Input value={titleEn} onChange={(e) => setTitleEn(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label>{isPl ? "Start" : "Starts at"}</Label>
              <Input
                type="datetime-local"
                value={startsAt}
                onChange={(e) => setStartsAt(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label>{isPl ? "Rodzaj" : "Kind"}</Label>
              <Select value={kind} onValueChange={setKind}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="webinar">webinar</SelectItem>
                  <SelectItem value="briefing">briefing</SelectItem>
                  <SelectItem value="roundtable">roundtable</SelectItem>
                  <SelectItem value="ama">ama</SelectItem>
                  <SelectItem value="in_person">in_person</SelectItem>
                  <SelectItem value="hybrid">hybrid</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label>{isPl ? "Widoczność" : "Visibility"}</Label>
            <Select
              value={visibility}
              onValueChange={(v) => setVisibility(v as "public" | "members")}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="public">{isPl ? "Publiczne" : "Public"}</SelectItem>
                <SelectItem value="members">
                  {isPl ? "Tylko członkowie" : "Members only"}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {isPl ? "Anuluj" : "Cancel"}
          </Button>
          <Button
            onClick={() => createM.mutate()}
            disabled={createM.isPending || !slug || !titlePl || !titleEn || !startsAt}
          >
            <Save className="w-4 h-4 mr-2" />
            {isPl ? "Utwórz" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditEventDialog({
  isPl,
  event,
  onClose,
  onSaved,
}: {
  isPl: boolean;
  event: EventRow;
  onClose: () => void;
  onSaved: () => void;
}) {
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
      }),
    onSuccess: () => {
      toast.success(isPl ? "Zapisano" : "Saved");
      onSaved();
    },
    onError: (e) => toast.error(String((e as Error).message)),
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isPl ? "Edycja wydarzenia" : "Edit event"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label>{isPl ? "Tytuł PL" : "Title PL"}</Label>
              <Input value={titlePl} onChange={(e) => setTitlePl(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label>{isPl ? "Tytuł EN" : "Title EN"}</Label>
              <Input value={titleEn} onChange={(e) => setTitleEn(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label>{isPl ? "Opis PL" : "Description PL"}</Label>
              <Textarea rows={4} value={descPl} onChange={(e) => setDescPl(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label>{isPl ? "Opis EN" : "Description EN"}</Label>
              <Textarea rows={4} value={descEn} onChange={(e) => setDescEn(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="grid gap-1.5">
              <Label>{isPl ? "Start" : "Starts at"}</Label>
              <Input
                type="datetime-local"
                value={startsAt}
                onChange={(e) => setStartsAt(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label>{isPl ? "Pojemność" : "Capacity"}</Label>
              <Input type="number" value={capacity} onChange={(e) => setCapacity(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label>Join URL</Label>
              <Input value={joinUrl} onChange={(e) => setJoinUrl(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label>{isPl ? "Otwarcie rejestracji" : "Registration opens"}</Label>
              <Input
                type="datetime-local"
                value={rsvpOpensAt}
                onChange={(e) => setRsvpOpensAt(e.target.value)}
              />
              <p className="text-[11px] text-muted-foreground">
                {isPl
                  ? "Pusto = rejestracja od publikacji."
                  : "Empty = registration open from publish."}
              </p>
            </div>
            <div className="grid gap-1.5">
              <Label>{isPl ? "Ranga wcześniejszego dostępu" : "Early-access tier rank"}</Label>
              <Input
                type="number"
                min={0}
                value={earlyRsvpRank}
                onChange={(e) => setEarlyRsvpRank(e.target.value)}
                placeholder={isPl ? "np. 10 (członek)" : "e.g. 10 (member)"}
              />
              <p className="text-[11px] text-muted-foreground">
                {isPl
                  ? "Warstwy o tej randze i wyższej rejestrują się przed otwarciem."
                  : "Tiers at this rank and above can register before opening."}
              </p>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {isPl ? "Anuluj" : "Cancel"}
          </Button>
          <Button onClick={() => saveM.mutate()} disabled={saveM.isPending}>
            <Save className="w-4 h-4 mr-2" />
            {isPl ? "Zapisz" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
