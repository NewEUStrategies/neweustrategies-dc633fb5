// Kalendarz redakcyjny (B1): /admin/posts/calendar - miesięczny widok
// opublikowanych i zaplanowanych wpisów nad istniejącymi statusami
// i publish_at, z przeciąganiem terminów (dnd-kit, już w zależnościach).
//
// Zasady:
//   - PUBLISHED: kropka read-only (przeciągnięcie re-datowałoby archiwum,
//     sitemapy i feedy - świadomie zablokowane),
//   - SCHEDULED: przeciągnięcie na inny dzień przenosi datę publikacji
//     (godzina zachowana), przez updatePost - bramka workflow serwera
//     i trigger DB obowiązują jak w edytorze,
//   - szkice/recenzje bez terminu: boczny panel; przeciągnięcie na dzień
//     planuje publikację (status scheduled + publish_at 09:00) - tylko
//     dla ról z prawem publikacji (UI ukrywa, serwer i tak egzekwuje).
// Czysta matematyka dat (poniedziałek pierwszym dniem tygodnia), bez
// zależności kalendarzowych.
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  DndContext,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { updatePost } from "@/lib/content.functions";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "@/lib/lucide-shim";
import { ChevronLeft, ChevronRight, CalendarDays, GripVertical } from "lucide-react";

export const Route = createFileRoute("/admin/posts/calendar")({
  component: EditorialCalendar,
});

interface CalendarPost {
  id: string;
  slug: string;
  title_pl: string;
  title_en: string;
  status: string;
  published_at: string | null;
  publish_at: string | null;
  updated_at: string;
}

/** Data wpisu w kalendarzu: scheduled -> publish_at, published -> published_at. */
function entryDate(post: CalendarPost): string | null {
  if (post.status === "scheduled") return post.publish_at;
  if (post.status === "published") return post.published_at;
  return null;
}

/** Lokalny YYYY-MM-DD (klucz komórki dnia). */
function dayKey(d: Date): string {
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/** Siatka 6 tygodni od poniedziałku obejmująca wskazany miesiąc. */
function monthGrid(anchor: Date): Date[] {
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const offset = (first.getDay() + 6) % 7; // 0 = poniedziałek
  const start = new Date(first);
  start.setDate(first.getDate() - offset);
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });
}

const WEEKDAYS = {
  pl: ["Pn", "Wt", "Śr", "Cz", "Pt", "So", "Nd"],
  en: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
} as const;

function DraggableEntry({
  post,
  lang,
  draggable,
}: {
  post: CalendarPost;
  lang: string;
  draggable: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: post.id,
    disabled: !draggable,
  });
  const title =
    (lang === "en" ? post.title_en || post.title_pl : post.title_pl || post.title_en) || post.slug;
  const scheduled = post.status === "scheduled";
  const time = entryDate(post);
  const hhmm = time
    ? new Date(time).toLocaleTimeString(lang === "en" ? "en-GB" : "pl-PL", {
        hour: "2-digit",
        minute: "2-digit",
      })
    : "";
  return (
    <div
      ref={setNodeRef}
      style={transform ? { transform: `translate(${transform.x}px, ${transform.y}px)` } : undefined}
      className={`group flex items-center gap-1 rounded px-1.5 py-1 text-[11px] leading-tight border ${
        scheduled
          ? "border-amber-500/40 bg-amber-500/10 text-amber-900 dark:text-amber-200"
          : "border-emerald-500/30 bg-emerald-500/10 text-emerald-900 dark:text-emerald-200"
      } ${isDragging ? "opacity-60 z-30 relative shadow-lg" : ""}`}
    >
      {draggable && (
        <button
          type="button"
          {...listeners}
          {...attributes}
          aria-label="Przeciągnij, aby zmienić termin"
          className="shrink-0 cursor-grab active:cursor-grabbing text-muted-foreground opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition"
        >
          <GripVertical className="w-3 h-3" aria-hidden="true" />
        </button>
      )}
      <Link
        to="/admin/posts/$slug"
        params={{ slug: post.slug }}
        className="min-w-0 flex-1 truncate hover:underline"
        title={title}
      >
        {hhmm && <span className="tabular-nums mr-1">{hhmm}</span>}
        {title}
      </Link>
    </div>
  );
}

function DayCell({
  day,
  inMonth,
  today,
  posts,
  lang,
  canPublish,
}: {
  day: Date;
  inMonth: boolean;
  today: boolean;
  posts: CalendarPost[];
  lang: string;
  canPublish: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: dayKey(day) });
  return (
    <div
      ref={setNodeRef}
      className={`min-h-24 border border-border/60 p-1 flex flex-col gap-1 transition ${
        inMonth ? "bg-card" : "bg-muted/30 text-muted-foreground"
      } ${isOver ? "ring-2 ring-brand ring-inset" : ""}`}
    >
      <span
        className={`self-end text-[11px] tabular-nums ${
          today
            ? "inline-flex h-5 w-5 items-center justify-center rounded-full bg-brand text-brand-foreground font-semibold"
            : ""
        }`}
      >
        {day.getDate()}
      </span>
      {posts.map((p) => (
        <DraggableEntry
          key={p.id}
          post={p}
          lang={lang}
          draggable={canPublish && p.status === "scheduled"}
        />
      ))}
    </div>
  );
}

function EditorialCalendar() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language ?? "pl";
  const { tenantId, isAdmin: canPublish } = useAuth();
  const qc = useQueryClient();
  const update$ = useServerFn(updatePost);
  const navigate = useNavigate();
  const [anchor, setAnchor] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [saving, setSaving] = useState(false);

  const grid = useMemo(() => monthGrid(anchor), [anchor]);
  const rangeStart = grid[0];
  const rangeEnd = new Date(grid[grid.length - 1]);
  rangeEnd.setDate(rangeEnd.getDate() + 1);

  const { data: monthPosts } = useQuery({
    enabled: !!tenantId,
    queryKey: ["admin", "posts-calendar", tenantId, dayKey(rangeStart)] as const,
    queryFn: async (): Promise<CalendarPost[]> => {
      const startIso = rangeStart.toISOString();
      const endIso = rangeEnd.toISOString();
      const { data, error } = await supabase
        .from("posts")
        .select("id, slug, title_pl, title_en, status, published_at, publish_at, updated_at")
        .eq("tenant_id", tenantId!)
        .is("deleted_at", null)
        .or(
          `and(status.eq.published,published_at.gte.${startIso},published_at.lt.${endIso}),and(status.eq.scheduled,publish_at.gte.${startIso},publish_at.lt.${endIso})`,
        )
        .limit(500);
      if (error) throw error;
      return (data ?? []) as CalendarPost[];
    },
  });

  const { data: backlog } = useQuery({
    enabled: !!tenantId && canPublish,
    queryKey: ["admin", "posts-calendar-backlog", tenantId] as const,
    queryFn: async (): Promise<CalendarPost[]> => {
      const { data, error } = await supabase
        .from("posts")
        .select("id, slug, title_pl, title_en, status, published_at, publish_at, updated_at")
        .eq("tenant_id", tenantId!)
        .is("deleted_at", null)
        .in("status", ["draft", "pending_review"])
        .order("updated_at", { ascending: false })
        .limit(30);
      if (error) throw error;
      return (data ?? []) as CalendarPost[];
    },
  });

  const byDay = useMemo(() => {
    const map = new Map<string, CalendarPost[]>();
    for (const post of monthPosts ?? []) {
      const iso = entryDate(post);
      if (!iso) continue;
      const key = dayKey(new Date(iso));
      const list = map.get(key) ?? [];
      list.push(post);
      map.set(key, list);
    }
    for (const list of map.values()) {
      list.sort((a, b) => (entryDate(a) ?? "").localeCompare(entryDate(b) ?? ""));
    }
    return map;
  }, [monthPosts]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const onDragEnd = async (event: DragEndEvent) => {
    const targetDay = event.over?.id;
    const postId = event.active.id;
    if (typeof targetDay !== "string" || typeof postId !== "string" || saving) return;
    const all = [...(monthPosts ?? []), ...(backlog ?? [])];
    const post = all.find((p) => p.id === postId);
    if (!post) return;

    // Zachowaj godzinę z dotychczasowego terminu; szkic dostaje 09:00.
    const prior = post.status === "scheduled" && post.publish_at ? new Date(post.publish_at) : null;
    const [y, m, d] = targetDay.split("-").map(Number);
    const next = new Date(y, m - 1, d, prior?.getHours() ?? 9, prior?.getMinutes() ?? 0);
    const nextIso = next.toISOString();
    const priorKey = prior ? dayKey(prior) : null;
    if (priorKey === targetDay) return;

    setSaving(true);
    try {
      await update$({
        data: { id: post.id, fields: { status: "scheduled", publish_at: nextIso } },
      });
      toast.success(
        t("admin.calendar.rescheduled", { defaultValue: "Przeniesiono termin publikacji" }),
      );
      void qc.invalidateQueries({ queryKey: ["admin", "posts-calendar"] });
      void qc.invalidateQueries({ queryKey: ["admin", "posts-calendar-backlog"] });
      void qc.invalidateQueries({ queryKey: ["admin-posts"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const monthLabel = anchor.toLocaleDateString(lang === "en" ? "en-GB" : "pl-PL", {
    month: "long",
    year: "numeric",
  });
  const todayKey = dayKey(new Date());
  const weekdays = WEEKDAYS[lang === "en" ? "en" : "pl"];

  return (
    <div className="p-4 lg:p-6 max-w-[1200px] mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => void navigate({ to: "/admin/posts" })}>
            <ArrowLeft className="w-4 h-4 mr-1" aria-hidden="true" />
            {t("admin.calendar.backToList", { defaultValue: "Lista wpisów" })}
          </Button>
          <h1 className="font-display text-xl inline-flex items-center gap-2">
            <CalendarDays className="w-5 h-5 text-brand" aria-hidden="true" />
            {t("admin.calendar.title", { defaultValue: "Kalendarz redakcyjny" })}
          </h1>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="sm"
            aria-label={t("admin.calendar.prevMonth", { defaultValue: "Poprzedni miesiąc" })}
            onClick={() => setAnchor((a) => new Date(a.getFullYear(), a.getMonth() - 1, 1))}
          >
            <ChevronLeft className="w-4 h-4" aria-hidden="true" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              const now = new Date();
              setAnchor(new Date(now.getFullYear(), now.getMonth(), 1));
            }}
          >
            {t("admin.calendar.today", { defaultValue: "Dziś" })}
          </Button>
          <Button
            variant="outline"
            size="sm"
            aria-label={t("admin.calendar.nextMonth", { defaultValue: "Następny miesiąc" })}
            onClick={() => setAnchor((a) => new Date(a.getFullYear(), a.getMonth() + 1, 1))}
          >
            <ChevronRight className="w-4 h-4" aria-hidden="true" />
          </Button>
          <span className="ml-2 text-sm font-medium capitalize">{monthLabel}</span>
        </div>
      </div>

      <div className="flex items-center gap-4 mb-3 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm border border-emerald-500/40 bg-emerald-500/20" />
          {t("admin.status.published")}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm border border-amber-500/40 bg-amber-500/20" />
          {t("admin.status.scheduled")}
        </span>
        {canPublish && (
          <span>
            {t("admin.calendar.dragHint", {
              defaultValue: "Przeciągnij zaplanowany wpis lub szkic na dzień, aby ustawić termin.",
            })}
          </span>
        )}
      </div>

      <DndContext sensors={sensors} onDragEnd={(e) => void onDragEnd(e)}>
        <div className={`grid gap-6 ${canPublish ? "lg:grid-cols-[1fr_240px]" : ""}`}>
          <div>
            <div className="grid grid-cols-7 text-center text-[11px] uppercase tracking-wide text-muted-foreground mb-1">
              {weekdays.map((weekday) => (
                <span key={weekday}>{weekday}</span>
              ))}
            </div>
            <div className="grid grid-cols-7 rounded-lg overflow-hidden border border-border">
              {grid.map((day) => {
                const key = dayKey(day);
                return (
                  <DayCell
                    key={key}
                    day={day}
                    inMonth={day.getMonth() === anchor.getMonth()}
                    today={key === todayKey}
                    posts={byDay.get(key) ?? []}
                    lang={lang}
                    canPublish={canPublish}
                  />
                );
              })}
            </div>
          </div>

          {canPublish && (
            <aside>
              <h2 className="text-xs uppercase tracking-wide text-muted-foreground mb-2">
                {t("admin.calendar.backlog", { defaultValue: "Bez terminu (szkice i recenzje)" })}
              </h2>
              <div className="space-y-1.5">
                {(backlog ?? []).length === 0 && (
                  <p className="text-xs text-muted-foreground">
                    {t("admin.calendar.backlogEmpty", { defaultValue: "Brak wpisów bez terminu." })}
                  </p>
                )}
                {(backlog ?? []).map((p) => (
                  <DraggableEntry key={p.id} post={p} lang={lang} draggable />
                ))}
              </div>
            </aside>
          )}
        </div>
      </DndContext>
    </div>
  );
}
