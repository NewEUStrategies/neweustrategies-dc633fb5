// Client-side interests management. Uses RLS-backed `user_follows` for
// signed-in users, falls back to localStorage for anonymous visitors so the
// recommendation engine can be primed before sign-in.
import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

const ANON_KEY = "nes.interests.anon.v1";

type InterestTargetType = "category" | "tag";

export interface InterestItem {
  id: string;
  type: InterestTargetType;
  label: string;
  slug: string;
  /** Dla kategorii: id kategorii-rodzica (np. Region, Specjalizacja). */
  parentId?: string | null;
  /** Zdenormalizowana etykieta rodzica w bieżącym języku - używana do
   *  grupowania widgetów (JoinUsForm) po obszarach. `null` dla top-level. */
  parentLabel?: string | null;
  /** Slug rodzica - używany jako klucz custom field w CRM (interests_<slug>). */
  parentSlug?: string | null;
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
        supabase
          .from("categories")
          .select("id, slug, name_pl, name_en, parent_id")
          .order("name_pl"),
        supabase.from("tags").select("id, slug, name").order("name"),
      ]);
      // Rozwiąż etykietę rodzica po `parent_id` żeby móc grupować kategorie
      // po obszarach (np. Region -> Afryka, Specjalizacja -> Dyplomacja).
      const byId = new Map<string, { name_pl: string | null; name_en: string | null; slug: string }>();
      for (const c of cats ?? []) {
        byId.set(c.id as string, {
          name_pl: (c.name_pl as string | null) ?? null,
          name_en: (c.name_en as string | null) ?? null,
          slug: c.slug as string,
        });
      }
      const resolveParent = (pid: string | null) => {
        if (!pid) return { label: null, slug: null } as const;
        const p = byId.get(pid);
        if (!p) return { label: null, slug: null } as const;
        return {
          label: (lang === "en" ? p.name_en : p.name_pl) || p.name_pl || p.slug,
          slug: p.slug,
        } as const;
      };
      return {
        categories: (cats ?? []).map((c) => {
          const parent = resolveParent((c.parent_id as string | null) ?? null);
          return {
            id: c.id as string,
            type: "category" as const,
            slug: c.slug as string,
            label:
              (lang === "en" ? (c.name_en as string | null) : (c.name_pl as string | null)) ||
              (c.name_pl as string | null) ||
              (c.slug as string),
            parentId: (c.parent_id as string | null) ?? null,
            parentLabel: parent.label,
            parentSlug: parent.slug,
          };
        }),
        tags: (tags ?? []).map((t) => ({
          id: t.id as string,
          type: "tag" as const,
          slug: t.slug as string,
          label: t.name as string,
          parentId: null,
          parentLabel: null,
          parentSlug: null,
        })),
      };
    },
  });

  // Realtime: refresh catalog when admins add/edit/remove categories or tags.
  // Uniquely-named channel per hook instance so multiple mounted widgets don't
  // reuse a subscribed channel (which throws
  // "cannot add postgres_changes callbacks ... after subscribe()").
  useEffect(() => {
    const channel = supabase.channel(
      `interests-catalog-rt-${Math.random().toString(36).slice(2, 10)}`,
    );
    channel
      .on("postgres_changes", { event: "*", schema: "public", table: "categories" }, () => {
        void qc.invalidateQueries({ queryKey: ["interests-catalog"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "tags" }, () => {
        void qc.invalidateQueries({ queryKey: ["interests-catalog"] });
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [qc]);

  return query;
}

function useCurrentUserId() {
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
        categoryIds: (data ?? [])
          .filter((r) => r.target_type === "category")
          .map((r) => r.target_id),
        tagIds: (data ?? []).filter((r) => r.target_type === "tag").map((r) => r.target_id),
      };
    },
  });

  const save = useCallback(
    async (next: AnonStored) => {
      if (!userId) {
        writeAnon(next);
        qc.setQueryData(["my-interests", "anon"], next);
        // Rekomendacje gościa czytają anon zainteresowania z localStorage -
        // bez inwalidacji stary wynik wisiałby do końca staleTime.
        void qc.invalidateQueries({ queryKey: ["recommended-posts"] });
        return { ok: true as const, anon: true as const };
      }
      // Compute diff vs current to avoid wiping unrelated follows (author).
      const current = (query.data ?? { categoryIds: [], tagIds: [] }) as AnonStored;
      const curCat = new Set(current.categoryIds);
      const curTag = new Set(current.tagIds);
      const nextCat = new Set(next.categoryIds);
      const nextTag = new Set(next.tagIds);

      const toInsert: { user_id: string; target_type: "category" | "tag"; target_id: string }[] =
        [];
      const toDelete: { type: "category" | "tag"; id: string }[] = [];
      nextCat.forEach((id) => {
        if (!curCat.has(id))
          toInsert.push({ user_id: userId, target_type: "category", target_id: id });
      });
      nextTag.forEach((id) => {
        if (!curTag.has(id)) toInsert.push({ user_id: userId, target_type: "tag", target_id: id });
      });
      curCat.forEach((id) => {
        if (!nextCat.has(id)) toDelete.push({ type: "category", id });
      });
      curTag.forEach((id) => {
        if (!nextTag.has(id)) toDelete.push({ type: "tag", id });
      });

      if (toInsert.length) {
        // Upsert z ignoreDuplicates: równoległy zapis (np. FollowButton albo
        // merge po zalogowaniu) nie wywraca całej partii na kluczu unikalnym.
        const { error } = await supabase.from("user_follows").upsert(toInsert, {
          onConflict: "user_id,target_type,target_id",
          ignoreDuplicates: true,
        });
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
      // user_follows czytają dwie rodziny kluczy (useInterests i useFollows)
      // oraz liczniki profilu i feedy personalizacji - odświeżamy wszystkie.
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["my-interests"] }),
        qc.invalidateQueries({ queryKey: ["follows"] }),
        qc.invalidateQueries({ queryKey: ["profile-counts"] }),
        qc.invalidateQueries({ queryKey: ["recommended-posts"] }),
        qc.invalidateQueries({ queryKey: ["followed-feed"] }),
      ]);
      return { ok: true as const, anon: false as const };
    },
    [userId, qc, query.data],
  );

  // Merge anon -> zalogowany dzieje się na poziomie aplikacji (AuthProvider ->
  // mergeAnonPersonalization), nie w tym hooku: działa więc także wtedy, gdy
  // żaden widżet zainteresowań nie jest zamontowany, a nieudany zapis nie
  // kasuje już lokalnych danych.

  return useMemo(() => ({ ...query, save, userId, isAnonymous: !userId }), [query, save, userId]);
}
