// Blok "Ankieta" - wybór istniejącej ankiety Community do osadzenia w treści.
// Ankiety tworzy się w /admin/community/polls; blok tylko wskazuje jedną po id.
// Szkic (draft) można wybrać z wyprzedzeniem - publicznie wyrenderuje się
// dopiero po otwarciu ankiety (widok publiczny filtruje open/closed).
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Block } from "@/lib/blocks/types";
import { AdminSelect } from "../AdminSelect";

interface Props {
  block: Block;
  onChange: (next: Block) => void;
}

interface PollChoice {
  id: string;
  question_pl: string;
  question_en: string;
  status: string;
}

const STATUS_LABEL: Readonly<Record<string, string>> = {
  draft: "szkic",
  open: "otwarta",
  closed: "zamknięta",
};

export function PollBlockEdit({ block, onChange }: Props) {
  const pollId = String(block.data.pollId ?? "");
  const pollsQ = useQuery({
    queryKey: ["admin", "blocks", "poll-choices"],
    queryFn: async (): Promise<PollChoice[]> => {
      const { data, error } = await supabase
        .from("polls")
        .select("id, question_pl, question_en, status")
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data ?? []) as PollChoice[];
    },
  });

  const selected = (pollsQ.data ?? []).find((p) => p.id === pollId);

  return (
    <div className="rounded-lg border border-dashed border-border p-3 space-y-2 bg-muted/20">
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Ankieta
      </div>
      <AdminSelect
        className="w-full text-xs bg-background border border-border rounded px-2 py-2 h-9"
        value={pollId}
        onChange={(e) => onChange({ ...block, data: { ...block.data, pollId: e.target.value } })}
      >
        <option value="">- wybierz ankietę -</option>
        {(pollsQ.data ?? []).map((p) => (
          <option key={p.id} value={p.id}>
            {(p.question_pl || p.question_en || p.id).slice(0, 80)} (
            {STATUS_LABEL[p.status] ?? p.status})
          </option>
        ))}
      </AdminSelect>
      {pollsQ.isLoading && <p className="text-xs text-muted-foreground">Wczytywanie ankiet...</p>}
      {pollsQ.data && pollsQ.data.length === 0 && (
        <p className="text-xs text-muted-foreground">
          Brak ankiet - utwórz je w Społeczność &gt; Ankiety.
        </p>
      )}
      {selected?.status === "draft" && (
        <p className="text-xs text-amber-600 dark:text-amber-500">
          To szkic: publicznie pojawi się dopiero po otwarciu ankiety.
        </p>
      )}
      {pollId && !pollsQ.isLoading && !selected && (
        <p className="text-xs text-destructive">
          Wybrana ankieta już nie istnieje - blok nie wyrenderuje się publicznie.
        </p>
      )}
    </div>
  );
}
