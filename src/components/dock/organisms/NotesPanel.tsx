// Organizm: notatnik. Tytuł, treść, kolor karteczki, przypięcie, edycja
// w miejscu i usuwanie (user_notes przez RLS użytkownika).
//
// STAN OCZEKIWANIA MÓWI PRAWDĘ - jak w panelu zadań: „Notatnik jest pusty"
// pojawiało się także wtedy, gdy notatki były jeszcze w drodze.
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { FileText, Link2Off, NotebookPen, Pin, PinOff, Trash2 } from "lucide-react";
import { DockPanelShell } from "../DockPanelShell";
import { DockEmptyState } from "../atoms/DockEmptyState";
import { useCreateNote, useDeleteNote, useNotes, useUpdateNote } from "@/lib/dock/useNotes";
import { NOTE_COLORS, type NoteColor, type UserNote } from "@/lib/dock/types";
import { useNoteContext } from "@/lib/dock/noteContext";
import { cn } from "@/lib/utils";
import "@/lib/i18n-dock";

const SWATCH: Record<NoteColor, string> = {
  amber: "bg-amber-200 dark:bg-amber-500/40",
  rose: "bg-rose-200 dark:bg-rose-500/40",
  sky: "bg-sky-200 dark:bg-sky-500/40",
  emerald: "bg-emerald-200 dark:bg-emerald-500/40",
  violet: "bg-violet-200 dark:bg-violet-500/40",
  slate: "bg-slate-200 dark:bg-slate-500/40",
};

function NoteCard({ note }: { note: UserNote }) {
  const { t } = useTranslation();
  const update = useUpdateNote();
  const remove = useDeleteNote();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(note.title);
  const [body, setBody] = useState(note.body);

  return (
    <li className={cn("rounded-[8px] p-3", SWATCH[note.color])}>
      {editing ? (
        <div className="space-y-2">
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            aria-label={t("dock.notes.newTitle")}
            className="w-full rounded-[6px] border border-input bg-background px-2 py-1 text-sm text-foreground"
          />
          <textarea
            value={body}
            onChange={(event) => setBody(event.target.value)}
            rows={4}
            aria-label={t("dock.notes.newBody")}
            className="w-full rounded-[6px] border border-input bg-background px-2 py-1 text-sm text-foreground"
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                update.mutate({ id: note.id, patch: { title, body } });
                setEditing(false);
              }}
              className="rounded-[6px] bg-primary px-2.5 py-1 text-xs font-semibold text-primary-foreground"
            >
              {t("dock.notes.save")}
            </button>
            <button
              type="button"
              onClick={() => {
                setTitle(note.title);
                setBody(note.body);
                setEditing(false);
              }}
              className="rounded-[6px] border border-border bg-background px-2.5 py-1 text-xs text-foreground"
            >
              {t("dock.notes.cancel")}
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-1">
          <div className="flex items-start gap-2">
            <p className="min-w-0 flex-1 break-words text-sm font-semibold text-foreground">
              {note.title || t("dock.notes.newTitle")}
            </p>
            <button
              type="button"
              onClick={() => update.mutate({ id: note.id, patch: { pinned: !note.pinned } })}
              aria-label={note.pinned ? t("dock.notes.unpin") : t("dock.notes.pin")}
              className="rounded-[6px] p-1 text-foreground/70 hover:text-foreground"
            >
              {note.pinned ? (
                <PinOff className="h-3.5 w-3.5" aria-hidden />
              ) : (
                <Pin className="h-3.5 w-3.5" aria-hidden />
              )}
            </button>
            <button
              type="button"
              onClick={() => remove.mutate(note.id)}
              aria-label={t("dock.notes.remove")}
              className="rounded-[6px] p-1 text-foreground/70 hover:text-destructive"
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden />
            </button>
          </div>
          {note.entity_id ? (
            <div className="flex items-center gap-1 pt-1">
              {note.entity_url ? (
                <a
                  href={note.entity_url}
                  className="inline-flex min-w-0 items-center gap-1 rounded-[6px] bg-background/70 px-1.5 py-0.5 text-[11px] font-medium text-foreground/80 hover:text-foreground"
                >
                  <FileText className="h-3 w-3 shrink-0" aria-hidden />
                  <span className="truncate">{note.entity_title || t("dock.notes.linked")}</span>
                </a>
              ) : (
                <span className="inline-flex min-w-0 items-center gap-1 rounded-[6px] bg-background/70 px-1.5 py-0.5 text-[11px] font-medium text-foreground/80">
                  <FileText className="h-3 w-3 shrink-0" aria-hidden />
                  <span className="truncate">{note.entity_title || t("dock.notes.linked")}</span>
                </span>
              )}
              <button
                type="button"
                onClick={() => update.mutate({ id: note.id, patch: { entity: null } })}
                aria-label={t("dock.notes.unlink")}
                title={t("dock.notes.unlink")}
                className="rounded-[6px] p-1 text-foreground/60 hover:text-foreground"
              >
                <Link2Off className="h-3 w-3" aria-hidden />
              </button>
            </div>
          ) : null}
          {note.body ? (
            <p className="whitespace-pre-wrap break-words text-xs text-foreground/80">
              {note.body}
            </p>
          ) : null}
          <div className="flex items-center gap-1 pt-1">
            {NOTE_COLORS.map((color) => (
              <button
                key={color}
                type="button"
                onClick={() => update.mutate({ id: note.id, patch: { color } })}
                aria-label={`${t("dock.notes.color")}: ${color}`}
                className={cn(
                  "h-4 w-4 rounded-full ring-1 ring-border",
                  SWATCH[color],
                  note.color === color && "ring-2 ring-foreground",
                )}
              />
            ))}
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="ml-auto rounded-[6px] px-2 py-0.5 text-[11px] font-medium text-foreground/80 hover:text-foreground"
            >
              {t("dock.notes.edit")}
            </button>
          </div>
        </div>
      )}
    </li>
  );
}

export function NotesPanel({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const notesQ = useNotes();
  const create = useCreateNote();
  const context = useNoteContext();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [attach, setAttach] = useState(true);
  const [scope, setScope] = useState<"all" | "material">("all");

  // Zależnością jest `notesQ.data`, a NIE `data ?? []` - patrz ten sam
  // komentarz w panelu zadań.
  const data = notesQ.data;
  const notes = useMemo(() => {
    const all = data ?? [];
    if (scope !== "material" || !context) return all;
    return all.filter((note) => note.entity_id === context.entityId);
  }, [data, scope, context]);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (title.trim().length === 0 && body.trim().length === 0) return;
    create.mutate({
      title,
      body,
      entity:
        attach && context
          ? {
              entityType: context.entityType,
              entityId: context.entityId,
              title: context.title,
              url: context.url,
            }
          : null,
    });
    setTitle("");
    setBody("");
  };

  return (
    <DockPanelShell
      title={t("dock.notes.title")}
      icon={<NotebookPen className="h-4 w-4" />}
      onClose={onClose}
    >
      <form onSubmit={submit} className="space-y-2 border-b border-border p-3">
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder={t("dock.notes.newTitle")}
          aria-label={t("dock.notes.newTitle")}
          className="w-full rounded-[6px] border border-input bg-background px-3 py-2 text-sm text-foreground"
        />
        <textarea
          value={body}
          onChange={(event) => setBody(event.target.value)}
          placeholder={t("dock.notes.newBody")}
          aria-label={t("dock.notes.newBody")}
          rows={3}
          className="w-full rounded-[6px] border border-input bg-background px-3 py-2 text-sm text-foreground"
        />
        {context ? (
          <label className="flex items-start gap-2 rounded-[6px] bg-muted/60 px-2 py-1.5 text-[11px] text-foreground">
            <input
              type="checkbox"
              checked={attach}
              onChange={(event) => setAttach(event.target.checked)}
              className="mt-0.5 h-3.5 w-3.5 rounded-[4px] border-input accent-[hsl(var(--primary))]"
            />
            <span className="min-w-0">
              <span className="block font-medium">{t("dock.notes.attach")}</span>
              <span className="block truncate text-muted-foreground">{context.title}</span>
            </span>
          </label>
        ) : null}
        <button
          type="submit"
          disabled={create.isPending}
          className="w-full rounded-[6px] bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-50"
        >
          {t("dock.notes.add")}
        </button>
      </form>

      {context ? (
        <div className="flex gap-1 border-b border-border px-3 py-2">
          {(["all", "material"] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setScope(value)}
              className={cn(
                "rounded-[6px] px-2.5 py-1 text-xs font-medium",
                scope === value
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t(`dock.notes.scope.${value}`)}
            </button>
          ))}
        </div>
      ) : null}

      {notesQ.isError ? (
        <DockEmptyState>{t("dock.error")}</DockEmptyState>
      ) : notesQ.isPending ? (
        <ul aria-busy="true" className="space-y-2 p-3">
          {["h-20", "h-16", "h-24"].map((height) => (
            <li key={height} className={cn("skeleton-shimmer rounded-[8px]", height)} />
          ))}
        </ul>
      ) : notes.length === 0 ? (
        <DockEmptyState icon={<NotebookPen className="h-6 w-6" aria-hidden />}>
          {t("dock.notes.empty")}
        </DockEmptyState>
      ) : (
        <ul className="space-y-2 p-3">
          {notes.map((note) => (
            <NoteCard key={note.id} note={note} />
          ))}
        </ul>
      )}
    </DockPanelShell>
  );
}
