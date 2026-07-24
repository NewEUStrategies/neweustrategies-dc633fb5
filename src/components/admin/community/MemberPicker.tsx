// Molekuła: wyszukiwarka + wybór członka tenanta (odbiorca odznaki itp.).
// Zastępuje wklejanie surowego UUID. Odpytuje public.profiles po nazwie
// (fallback: wklejony UUID trafia w .eq("id")); RLS ogranicza wynik do profili
// tenanta wołającego staffu, więc izolacja tenanta jest egzekwowana w bazie.
// Stringi UI podajemy propsem `labels`, żeby rodzic panował nad i18n spójnie z
// resztą ekranu (tu: dwujęzyczne etykiety inline w /admin/community/badges).
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ChatAvatar } from "@/components/chat/ChatAvatar";
import { cn } from "@/lib/utils";
import {
  isUuid,
  mapMemberRow,
  shouldQueryMembers,
  type MemberOption,
} from "@/lib/admin/memberSearch";

export interface MemberPickerLabels {
  placeholder: string;
  search: string;
  hint: string;
  loading: string;
  empty: string;
  clear: string;
}

interface MemberPickerProps {
  /** Wybrane user_id ("" = brak). Reset do "" czyści etykietę triggera. */
  value: string;
  onChange: (userId: string) => void;
  labels: MemberPickerLabels;
  disabled?: boolean;
}

export function MemberPicker({ value, onChange, labels, disabled }: MemberPickerProps) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [term, setTerm] = useState("");
  const [selected, setSelected] = useState<MemberOption | null>(null);

  // Rodzic wyzerował wartość (np. po przyznaniu) → zdejmij etykietę.
  useEffect(() => {
    if (!value) setSelected(null);
  }, [value]);

  // Debounce frazy - spójnie z wyszukiwaniem w /network i pickerach buildera.
  useEffect(() => {
    const handle = setTimeout(() => setTerm(input.trim()), 250);
    return () => clearTimeout(handle);
  }, [input]);

  const ready = shouldQueryMembers(term);
  const q = useQuery({
    queryKey: ["admin-member-search", term] as const,
    enabled: open && ready,
    staleTime: 30_000,
    queryFn: async (): Promise<MemberOption[]> => {
      const base = supabase
        .from("profiles")
        .select("id, display_name, avatar_url, slug, verified_at");
      const query = isUuid(term)
        ? base.eq("id", term)
        : base.ilike("display_name", `%${term}%`).order("display_name", { ascending: true });
      const { data, error } = await query.limit(10);
      if (error) throw error;
      return (data ?? []).map(mapMemberRow);
    },
  });

  const pick = (member: MemberOption) => {
    setSelected(member);
    onChange(member.id);
    setOpen(false);
    setInput("");
    setTerm("");
  };

  const clear = () => {
    setSelected(null);
    onChange("");
  };

  const results = q.data ?? [];

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className="flex h-10 w-full items-center justify-between gap-2 rounded-md border border-input bg-background px-3 text-sm disabled:pointer-events-none disabled:opacity-50 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={labels.placeholder}
        >
          {selected ? (
            <span className="flex min-w-0 items-center gap-2">
              <ChatAvatar name={selected.displayName} avatarUrl={selected.avatarUrl} size="xs" />
              <span className="truncate">{selected.displayName}</span>
            </span>
          ) : (
            <span className="truncate text-muted-foreground">{labels.placeholder}</span>
          )}
          {selected ? (
            <span
              role="button"
              tabIndex={0}
              aria-label={labels.clear}
              className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-destructive"
              onClick={(e) => {
                e.stopPropagation();
                clear();
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  e.stopPropagation();
                  clear();
                }
              }}
            >
              <X className="h-4 w-4" aria-hidden />
            </span>
          ) : (
            <ChevronDown className="h-4 w-4 shrink-0 opacity-60" aria-hidden />
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[min(24rem,90vw)] p-2" align="start">
        <Input
          autoFocus
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={labels.search}
          className="mb-2 h-8 text-sm"
          aria-label={labels.search}
        />
        <div className="max-h-64 overflow-y-auto">
          {!ready ? (
            <p className="p-2 text-xs text-muted-foreground">{labels.hint}</p>
          ) : q.isLoading ? (
            <p className="p-2 text-xs text-muted-foreground">{labels.loading}</p>
          ) : results.length === 0 ? (
            <p className="p-2 text-xs text-muted-foreground">{labels.empty}</p>
          ) : (
            <ul className="space-y-0.5">
              {results.map((m) => (
                <li key={m.id}>
                  <button
                    type="button"
                    onClick={() => pick(m)}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-[4px] px-2 py-1.5 text-left text-sm hover:bg-muted/60",
                      value === m.id && "bg-accent",
                    )}
                  >
                    <ChatAvatar name={m.displayName} avatarUrl={m.avatarUrl} size="xs" />
                    <span className="min-w-0 flex-1 truncate">{m.displayName}</span>
                    {m.slug && (
                      <span className="shrink-0 truncate text-[11px] text-muted-foreground">
                        @{m.slug}
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
