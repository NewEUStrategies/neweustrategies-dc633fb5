// Combobox profilu platformy (profiles_public) - wspoldzielony picker dla
// edytorow widgetow (prelegent sesji w event-schedule, host w meeting-booking).
// Wybor podpina zywy profil (userId); rodzic decyduje, co zrobic ze snapshotem.
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";

export interface ProfileHit {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
}

/** Combobox profilu platformy (profiles_public) - podpina prelegenta sesji
 *  pod zywy profil (userId); snapshot imienia/zdjecia zostaje fallbackiem. */
export function ProfilePicker({
  value,
  onPick,
  onClear,
  lang,
}: {
  value: string;
  onPick: (hit: ProfileHit) => void;
  onClear: () => void;
  lang: "pl" | "en";
}) {
  const l = (pl: string, en: string) => (lang === "pl" ? pl : en);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const rootRef = useRef<HTMLDivElement | null>(null);

  const { data: bound } = useQuery({
    queryKey: ["schedule-profile-bound", value] as const,
    enabled: !!value,
    staleTime: 60_000,
    queryFn: async (): Promise<ProfileHit | null> => {
      const { data } = await supabase
        .from("profiles_public")
        .select("id, display_name, avatar_url")
        .eq("id", value)
        .maybeSingle();
      return (data as ProfileHit | null) ?? null;
    },
  });

  const { data: hits = [] } = useQuery({
    queryKey: ["schedule-profile-search", search] as const,
    enabled: open,
    staleTime: 30_000,
    queryFn: async (): Promise<ProfileHit[]> => {
      const q = search.trim();
      let query = supabase
        .from("profiles_public")
        .select("id, display_name, avatar_url")
        .order("display_name")
        .limit(10);
      if (q.length >= 2) query = query.ilike("display_name", `%${q}%`);
      const { data } = await query;
      return ((data ?? []) as ProfileHit[]).filter((p) => p.id);
    },
  });

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);

  return (
    <div ref={rootRef} className="space-y-1">
      <div className="relative">
        <Input
          value={open ? search : (bound?.display_name ?? (value ? value : ""))}
          onChange={(e) => {
            setSearch(e.target.value);
            if (!open) setOpen(true);
          }}
          onFocus={() => {
            setSearch("");
            setOpen(true);
          }}
          placeholder={l("Szukaj profilu…", "Search profile…")}
          className="h-8 pr-7 text-xs"
        />
        {value && (
          <button
            type="button"
            onClick={() => {
              onClear();
              setOpen(false);
            }}
            className="absolute right-1 top-1/2 inline-flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded text-xs text-destructive hover:bg-destructive/10"
            aria-label={l("Odepnij profil", "Unlink profile")}
          >
            ×
          </button>
        )}
      </div>
      {open && (
        <div className="space-y-0.5 rounded border border-border bg-popover p-1 text-popover-foreground shadow-md">
          <div className="max-h-48 space-y-0.5 overflow-y-auto">
            {hits.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => {
                  onPick(p);
                  setOpen(false);
                }}
                className="flex w-full items-center gap-2 truncate rounded px-2 py-1.5 text-left text-xs hover:bg-muted"
              >
                {p.avatar_url ? (
                  <img src={p.avatar_url} alt="" className="h-5 w-5 rounded-[6px] object-cover" />
                ) : (
                  <span className="h-5 w-5 rounded-[6px] bg-muted" />
                )}
                <span className="truncate">{p.display_name || p.id}</span>
              </button>
            ))}
            {!hits.length && (
              <div className="px-2 py-1 text-[11px] text-muted-foreground">
                {l("Brak wyników.", "No results.")}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
