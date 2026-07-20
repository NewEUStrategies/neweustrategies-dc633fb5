// Panel "Historia aktualizacji" w edytorze wpisu (A4): świadome wpisy
// redakcyjne widoczne publicznie pod analizą. Mutacje bezpośrednio przez
// klienta Supabase - RLS (changelog staff manage) pilnuje staff + tenant,
// jak w pozostałych panelach edytora.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Trash2, Plus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import "@/lib/i18n-admin-post-panes";

interface ChangelogRow {
  id: string;
  entry_date: string;
  note_pl: string;
  note_en: string | null;
}

export function ChangelogCard({ postId }: { postId: string }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [entryDate, setEntryDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [notePl, setNotePl] = useState("");
  const [noteEn, setNoteEn] = useState("");

  const queryKey = ["admin", "post-changelog", postId] as const;
  const { data } = useQuery({
    queryKey,
    queryFn: async (): Promise<ChangelogRow[]> => {
      const { data: rows, error } = await supabase
        .from("post_changelog")
        .select("id, entry_date, note_pl, note_en")
        .eq("post_id", postId)
        .order("entry_date", { ascending: false })
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (rows ?? []) as ChangelogRow[];
    },
  });

  const addM = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("post_changelog").insert({
        post_id: postId,
        entry_date: entryDate,
        note_pl: notePl.trim(),
        note_en: noteEn.trim() ? noteEn.trim() : null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setNotePl("");
      setNoteEn("");
      void qc.invalidateQueries({ queryKey });
      void qc.invalidateQueries({ queryKey: ["public", "post-changelog", postId] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
  });

  const deleteM = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("post_changelog").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey });
      void qc.invalidateQueries({ queryKey: ["public", "post-changelog", postId] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
  });

  return (
    <div className="space-y-3">
      <p className="text-[11px] text-muted-foreground -mt-1">
        {t("adminPostPanes.changelog.hint")}
      </p>
      <div className="space-y-1.5">
        <Input
          type="date"
          value={entryDate}
          onChange={(e) => setEntryDate(e.target.value)}
          className="h-8 text-xs"
          aria-label={t("adminPostPanes.changelog.dateLabel")}
        />
        <Input
          value={notePl}
          onChange={(e) => setNotePl(e.target.value)}
          placeholder={t("adminPostPanes.changelog.notePlPlaceholder")}
          className="h-8 text-xs"
          maxLength={280}
        />
        <Input
          value={noteEn}
          onChange={(e) => setNoteEn(e.target.value)}
          placeholder={t("adminPostPanes.changelog.noteEnPlaceholder")}
          className="h-8 text-xs"
          maxLength={280}
        />
        <Button
          type="button"
          size="sm"
          className="w-full"
          disabled={!notePl.trim() || !entryDate || addM.isPending}
          onClick={() => addM.mutate()}
        >
          <Plus className="w-3.5 h-3.5 mr-1" aria-hidden="true" />
          {t("adminPostPanes.changelog.add")}
        </Button>
      </div>
      {(data ?? []).length > 0 && (
        <ul className="space-y-1.5">
          {(data ?? []).map((row) => (
            <li
              key={row.id}
              className="flex items-start justify-between gap-2 rounded border border-border/60 px-2 py-1.5 text-xs"
            >
              <div className="min-w-0">
                <span className="tabular-nums text-muted-foreground">{row.entry_date}</span>{" "}
                <span className="break-words">{row.note_pl}</span>
                {row.note_en && (
                  <span className="block text-muted-foreground break-words">EN: {row.note_en}</span>
                )}
              </div>
              <button
                type="button"
                onClick={() => deleteM.mutate(row.id)}
                disabled={deleteM.isPending}
                aria-label={t("adminPostPanes.changelog.delete")}
                className="shrink-0 text-muted-foreground hover:text-destructive transition"
              >
                <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
