// Client-side interests management. Uses RLS-backed `user_follows` for
// signed-in users, falls back to localStorage for anonymous visitors so the
// recommendation engine can be primed before sign-in.
import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

const ANON_KEY = "nes.interests.anon.v1";

export type InterestTargetType = "category" | "tag";

export interface InterestItem {
  id: string;
  type: InterestTargetType;
  label: string;
  slug: string;
}

export interface InterestCatalog {
  categories: InterestItem[];
  tags: InterestItem[];
}

interface AnonStored {
  categoryIds: string[];
  tagIds: string[];
}

function readAnon(): AnonStored {
  if (typeof window === "undefined") return { categoryIds: [], tagIds: [] };
  try {
    const raw = window.localStorage.getItem(ANON_KEY);
    if (!raw) return { categoryIds: [], tagIds: [] };
    const parsed = JSON.parse(raw) as AnonStored;
    return {
      categoryIds: Array.isArray(parsed.categoryIds) ? parsed.categoryIds : [],
      tagIds: Array.isArray(parsed.tagIds) ? parsed.tagIds : [],
    };
  } catch {
    return { categoryIds: [], tagIds: [] };
  }
}

function writeAnon(v: AnonStored) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(ANON_KEY, JSON.stringify(v));
  } catch {
    /* quota / private mode */
  }
}

export function useInterestCatalog(lang: "pl" | "en" = "pl") {
  const qc = useQueryClient();
  const query = useQuery<InterestCatalog>({
    queryKey: ["interests-catalog", lang],
    staleTime: 60_000,
    queryFn: async () => {
      const [{ data: cats }, { data: tags }] = await Promise.all([
        supabase.from("categories").select("id, slug, name_pl, name_en").order("name_pl"),
        supabase.from("tags").select("id, slug, name").order("name"),
      ]);
      return {
        categories: (cats ?? []).map((c) => ({
          id: c.id,
          type: "category" as const,
          slug: c.slug,
          label: (lang === "en" ? c.name_en : c.name_pl) || c.name_pl || c.slug,
        })),
        tags: (tags ?? []).map((t) => ({
          id: t.id,
          type: "tag" as const,
          slug: t.slug,
          label: t.name,
        })),
      };
    },
  });

  // Realtime: refresh catalog when admins add/edit/remove categories or tags.
  useEffect(() => {
    const channel = supabase
      .channel("interests-catalog-rt")
      .on("postgres_changes", { event: "*", schema: "public", table: "categories" }, () => {
        void qc.invalidateQueries({ queryKey: ["interests-catalog"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "tags" }, () => {
        void qc.invalidateQueries({ queryKey: ["interests-catalog"] });
      })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [qc]);

  return query;
}


export function useCurrentUserId() {
  const [uid, setUid] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    supabase.auth.getUser().then(({ data }) => {
      if (!cancelled) setUid(data.user?.id ?? null);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setUid(session?.user?.id ?? null);
    });
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);
  return uid;
}

export function useMyInterests() {
  const userId = useCurrentUserId();
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: ["my-interests", userId ?? "anon"],
    staleTime: 30_000,
    queryFn: async (): Promise<AnonStored> => {
      if (!userId) return readAnon();
      const { data, error } = await supabase
        .from("user_follows")
        .select("target_type, target_id")
        .eq("user_id", userId)
        .in("target_type", ["category", "tag"]);
      if (error) throw error;
      return {
        categoryIds: (data ?? []).filter((r) => r.target_type === "category").map((r) => r.target_id),
        tagIds: (data ?? []).filter((r) => r.target_type === "tag").map((r) => r.target_id),
      };
    },
  });

  const save = useCallback(
    async (next: AnonStored) => {
      if (!userId) {
        writeAnon(next);
        qc.setQueryData(["my-interests", "anon"], next);
        return { ok: true as const, anon: true as const };
      }
      // Compute diff vs current to avoid wiping unrelated follows (author).
      const current = (query.data ?? { categoryIds: [], tagIds: [] }) as AnonStored;
      const curCat = new Set(current.categoryIds);
      const curTag = new Set(current.tagIds);
      const nextCat = new Set(next.categoryIds);
      const nextTag = new Set(next.tagIds);

      const toInsert: { user_id: string; target_type: "category" | "tag"; target_id: string }[] = [];
      const toDelete: { type: "category" | "tag"; id: string }[] = [];
      nextCat.forEach((id) => { if (!curCat.has(id)) toInsert.push({ user_id: userId, target_type: "category", target_id: id }); });
      nextTag.forEach((id) => { if (!curTag.has(id)) toInsert.push({ user_id: userId, target_type: "tag", target_id: id }); });
      curCat.forEach((id) => { if (!nextCat.has(id)) toDelete.push({ type: "category", id }); });
      curTag.forEach((id) => { if (!nextTag.has(id)) toDelete.push({ type: "tag", id }); });

      if (toInsert.length) {
        const { error } = await supabase.from("user_follows").insert(toInsert);
        if (error) return { ok: false as const, error: error.message };
      }
      for (const d of toDelete) {
        const { error } = await supabase
          .from("user_follows")
          .delete()
          .eq("user_id", userId)
          .eq("target_type", d.type)
          .eq("target_id", d.id);
        if (error) return { ok: false as const, error: error.message };
      }
      await qc.invalidateQueries({ queryKey: ["my-interests"] });
      await qc.invalidateQueries({ queryKey: ["recommended-posts"] });
      return { ok: true as const, anon: false as const };
    },
    [userId, qc, query.data],
  );

  // If a user logs in with anon-stored interests, automatically merge them.
  useEffect(() => {
    if (!userId) return;
    const anon = readAnon();
    if (!anon.categoryIds.length && !anon.tagIds.length) return;
    (async () => {
      const merged = {
        categoryIds: Array.from(new Set([...(query.data?.categoryIds ?? []), ...anon.categoryIds])),
        tagIds: Array.from(new Set([...(query.data?.tagIds ?? []), ...anon.tagIds])),
      };
      await save(merged);
      writeAnon({ categoryIds: [], tagIds: [] });
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  return useMemo(
    () => ({ ...query, save, userId, isAnonymous: !userId }),
    [query, save, userId],
  );
}
