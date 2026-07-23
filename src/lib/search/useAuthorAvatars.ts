// Batch-fetch avatarów autorów z profiles_public dla listy podpowiedzi
// - wspólne dla widgetu nagłówkowego, autosuggest na /search i SearchOverlay.
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { AutosuggestItem } from "@/lib/queries/archives";

export function useAuthorAvatars(items: AutosuggestItem[]) {
  const [avatars, setAvatars] = useState<Record<string, string | null>>({});
  useEffect(() => {
    const ids = Array.from(
      new Set(
        items
          .filter((it) => it.kind === "author" && it.id && !(it.id in avatars))
          .map((it) => it.id as string),
      ),
    );
    if (ids.length === 0) return;
    let cancelled = false;
    void (async () => {
      const { data } = await supabase
        .from("profiles_public")
        .select("id, avatar_url")
        .in("id", ids);
      if (cancelled) return;
      const next: Record<string, string | null> = {};
      for (const id of ids) next[id] = null;
      for (const row of (data ?? []) as { id: string; avatar_url: string | null }[]) {
        next[row.id] = row.avatar_url ?? null;
      }
      setAvatars((prev) => ({ ...prev, ...next }));
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);
  return avatars;
}
