// Publiczna "Historia aktualizacji" analizy (A4): lista świadomych wpisów
// redakcyjnych (post_changelog), np. "20 lipca 2026 - zaktualizowano dane
// o Q2". Renderuje się wyłącznie, gdy redakcja dodała wpisy - brak sekcji
// to brak szumu. Sygnał zaufania dla żywych analiz.
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { History } from "lucide-react";
import { useId } from "react";

const HEADINGS = {
  pl: "Historia aktualizacji",
  en: "Update history",
} as const;

interface ChangelogRow {
  id: string;
  entry_date: string;
  note_pl: string;
  note_en: string | null;
}

function formatDate(iso: string, lang: "pl" | "en"): string {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(lang === "en" ? "en-GB" : "pl-PL", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

export function PostChangelog({ postId, lang }: { postId: string; lang: "pl" | "en" }) {
  const headingId = useId();
  const { data } = useQuery({
    queryKey: ["public", "post-changelog", postId] as const,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<ChangelogRow[]> => {
      const { data: rows, error } = await supabase
        .from("post_changelog")
        .select("id, entry_date, note_pl, note_en")
        .eq("post_id", postId)
        .order("entry_date", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return (rows ?? []) as ChangelogRow[];
    },
  });

  const entries = data ?? [];
  if (entries.length === 0) return null;

  return (
    <section aria-labelledby={headingId} className="border-t border-border pt-6">
      <div className="flex items-center gap-2 mb-3">
        <History className="w-4 h-4 text-muted-foreground" aria-hidden="true" />
        <h2 id={headingId} className="text-xs uppercase tracking-wide text-muted-foreground">
          {HEADINGS[lang]}
        </h2>
      </div>
      <ol className="space-y-2">
        {entries.map((entry) => (
          <li key={entry.id} className="flex gap-3 text-sm">
            <time
              dateTime={entry.entry_date}
              className="shrink-0 tabular-nums text-muted-foreground"
            >
              {formatDate(entry.entry_date, lang)}
            </time>
            <span className="text-foreground/90">
              {lang === "en" ? entry.note_en || entry.note_pl : entry.note_pl || entry.note_en}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
