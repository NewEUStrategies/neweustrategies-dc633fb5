// Organizm: notatnik. Tytuł, treść, kolor karteczki, przypięcie, edycja
// w miejscu i usuwanie (user_notes przez RLS użytkownika).
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { NotebookPen, Pin, PinOff, Trash2 } from "lucide-react";
import { DockPanelShell } from "../DockPanelShell";
import { DockEmptyState } from "../atoms/DockEmptyState";
import {
  useCreateNote,
  useDeleteNote,
  useNotes,
  useUpdateNote,
} from "@/lib/dock/useNotes";
import { NOTE_COLORS, type NoteColor, type UserNote } from "@/lib/dock/types";
import { cn } from "@/lib/utils";

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
          {note.body ? (
            <p className="whitespace-pre-wrap break-words text-xs text-foreground/80">{note.body}</p>
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
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");

  const notes = notesQ.data ?? [];

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (title.trim().length === 0 && body.trim().length === 0) return;
    create.mutate({ title, body });
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
        <button
          type="submit"
          disabled={create.isPending}
          className="w-full rounded-[6px] bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-50"
        >
          {t("dock.notes.add")}
        </button>
      </form>

      {notesQ.isError ? (
        <DockEmptyState>{t("dock.error")}</DockEmptyState>
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
