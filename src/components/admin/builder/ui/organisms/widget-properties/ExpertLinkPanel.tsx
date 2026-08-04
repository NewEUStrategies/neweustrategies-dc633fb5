// Organizm: panel „Powiązany ekspert" współdzielony przez edytory widgetów
// `team-member` i `author-profile-card`. Jedna kontrolka wyboru osoby (katalog
// ekspertów), odświeżanie danych, link do profilu publicznego, odłączenie oraz
// skrót do utworzenia nowego profilu w adminie.
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { RefreshCw, ExternalLink, Link2Off, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PropField } from "../../atoms";
import { expertsDirectoryQueryOptions } from "@/lib/experts/directory";
import { fetchExpertHydration, type ExpertHydration } from "@/lib/experts/hydration";

const NONE = "__none__";

interface Props {
  lang: "pl" | "en";
  authorId: string;
  authorSlug: string;
  /** Wywoływane po wczytaniu danych osoby - edytor mapuje je na swoje pola. */
  onApply: (h: ExpertHydration) => void;
  onClear: () => void;
  hint?: string;
}

export function ExpertLinkPanel({ lang, authorId, authorSlug, onApply, onClear, hint }: Props) {
  const [busy, setBusy] = useState(false);
  const { data: dir } = useQuery(expertsDirectoryQueryOptions());
  const experts = useMemo(() => dir?.experts ?? [], [dir]);
  const pl = lang === "pl";

  const load = async (id: string, silent = false) => {
    setBusy(true);
    try {
      const h = await fetchExpertHydration(id);
      if (!h) {
        toast.error(pl ? "Nie znaleziono eksperta" : "Expert not found");
        return;
      }
      onApply(h);
      if (!silent) {
        toast.success(pl ? "Dane eksperta wczytane" : "Expert data loaded", {
          description: pl
            ? "Możesz nadpisać poszczególne pola poniżej."
            : "You can override individual fields below.",
        });
      }
    } catch (err) {
      toast.error(pl ? "Błąd wczytywania" : "Loading error", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2 rounded-[6px] border border-border/60 bg-muted/30 p-3">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {pl ? "Powiązany ekspert" : "Linked expert"}
      </div>
      <PropField
        label={pl ? "Wybierz z katalogu ekspertów" : "Pick from experts directory"}
        hint={
          hint ??
          (pl
            ? "Wybranie osoby wypełni pola karty danymi z profilu eksperta. Ręczne wpisy poniżej mają pierwszeństwo."
            : "Selecting a person populates the card from the expert profile. Manual entries below take precedence.")
        }
      >
        <Select
          value={authorId || NONE}
          onValueChange={(v) => (v === NONE ? onClear() : void load(v))}
          disabled={busy}
        >
          <SelectTrigger className="h-8 text-xs">
            <SelectValue placeholder={pl ? "- Brak -" : "- None -"} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE} className="text-xs">
              {pl ? "- Brak (dane ręczne) -" : "- None (manual) -"}
            </SelectItem>
            {experts.map((e) => (
              <SelectItem key={e.id} value={e.id} className="text-xs">
                {e.display_name ?? e.slug ?? e.id}
                {e.job_title ? ` - ${e.job_title}` : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </PropField>

      <div className="flex flex-wrap items-center gap-2 pt-1">
        {authorId && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            onClick={() => void load(authorId, true)}
            disabled={busy}
          >
            <RefreshCw className="mr-1 h-3 w-3" />
            {pl ? "Odśwież dane" : "Refresh data"}
          </Button>
        )}
        <a
          href="/admin/authors"
          target="_blank"
          rel="noreferrer noopener"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <UserPlus className="h-3 w-3" />
          {pl ? "Utwórz nowy profil" : "Create new profile"}
        </a>
        {authorId && authorSlug && (
          <a
            href={`/author/${authorSlug}`}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <ExternalLink className="h-3 w-3" />
            {pl ? "Zobacz profil publiczny" : "View public profile"}
          </a>
        )}
        {authorId && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 text-xs text-muted-foreground"
            onClick={onClear}
            disabled={busy}
          >
            <Link2Off className="mr-1 h-3 w-3" />
            {pl ? "Odłącz" : "Unlink"}
          </Button>
        )}
      </div>
    </div>
  );
}
