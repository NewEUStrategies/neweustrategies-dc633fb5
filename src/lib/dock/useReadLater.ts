// Kolejka „Do przeczytania później" (user_read_later). Izolację pilnuje RLS
// (user_id + tenant_id), unikalny indeks nie dopuszcza duplikatu tego samego
// materiału u tej samej osoby.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { dockKeys } from "./keys";
import { normalizeReadLaterState, type ReadLaterItem, type ReadLaterState } from "./types";

const SELECT = "id, entity_type, entity_id, title, url, state, note, read_at, created_at";

interface ReadLaterRowDb {
  id: string;
  entity_type: string;
  entity_id: string;
  title: string | null;
  url: string | null;
  state: string;
  note: string | null;
  read_at: string | null;
  created_at: string;
}

const ENTITY_TYPES = ["post", "page", "event", "document", "external"] as const;
type ReadLaterEntity = (typeof ENTITY_TYPES)[number];

function normalizeEntity(value: string): ReadLaterEntity {
  return ENTITY_TYPES.includes(value as ReadLaterEntity) ? (value as ReadLaterEntity) : "external";
}

export function useReadLater() {
  const { user } = useAuth();
  return useQuery({
    queryKey: dockKeys.readLater(user?.id),
    enabled: !!user,
    queryFn: async (): Promise<ReadLaterItem[]> => {
      const { data, error } = await supabase
        .from("user_read_later")
        .select(SELECT)
        .order("created_at", { ascending: false })
        .limit(300);
      if (error) throw error;
      return (data ?? []).map((row) => {
        const r = row as ReadLaterRowDb;
        return {
          ...r,
          entity_type: normalizeEntity(r.entity_type),
          state: normalizeReadLaterState(r.state),
        } satisfies ReadLaterItem;
      });
    },
  });
}

export function useUnreadLaterCount(): number {
  const { data } = useReadLater();
  return (data ?? []).filter((item) => item.state === "unread").length;
}

export interface ReadLaterDraft {
  entityType: ReadLaterEntity;
  entityId: string;
  title?: string | null;
  url?: string | null;
}

export function useAddReadLater() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (draft: ReadLaterDraft) => {
      if (!user) throw new Error("Not authenticated");
      const { error } = await supabase.from("user_read_later").insert({
        user_id: user.id,
        entity_type: draft.entityType,
        entity_id: draft.entityId,
        title: draft.title ?? null,
        url: draft.url ?? null,
      });
      // Ten sam materiał dwa razy w kolejce to nie błąd użytkownika.
      if (error && !String(error.message).toLowerCase().includes("duplicate")) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: dockKeys.readLater(user?.id) }),
  });
}

export function useSetReadLaterState() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async ({ id, state }: { id: string; state: ReadLaterState }) => {
      const { error } = await supabase
        .from("user_read_later")
        .update({ state, read_at: state === "read" ? new Date().toISOString() : null })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: dockKeys.readLater(user?.id) }),
  });
}

export function useRemoveReadLater() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("user_read_later").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: dockKeys.readLater(user?.id) }),
  });
}
