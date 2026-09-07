// Notatnik użytkownika (user_notes). Odczyt i zapis idą przez klienta
// przeglądarkowego, a izolację pilnuje RLS: `user_id = auth.uid()` oraz
// `tenant_id = current_tenant_id()`. Klient świadomie NIE podaje tenant_id -
// wypełnia go baza w kontekście tenanta żądania (tak samo jak user_bookmarks).
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { dockKeys } from "./keys";
import { normalizeNoteColor, type NoteColor, type UserNote } from "./types";
import { isNoteEntityType, isStorableEntityId, type NoteEntityType } from "./noteContext";

const SELECT =
  "id, title, body, color, pinned, entity_type, entity_id, entity_title, entity_url, created_at, updated_at";

interface NoteRowDb {
  id: string;
  title: string;
  body: string;
  color: string;
  pinned: boolean;
  entity_type: string | null;
  entity_id: string | null;
  entity_title: string | null;
  entity_url: string | null;
  created_at: string;
  updated_at: string;
}

function toNote(row: NoteRowDb): UserNote {
  return {
    ...row,
    color: normalizeNoteColor(row.color),
    entity_type: isNoteEntityType(row.entity_type) ? row.entity_type : null,
  };
}

export function useNotes() {
  const { user } = useAuth();
  return useQuery({
    queryKey: dockKeys.notes(user?.id),
    enabled: !!user,
    queryFn: async (): Promise<UserNote[]> => {
      const { data, error } = await supabase
        .from("user_notes")
        .select(SELECT)
        .order("pinned", { ascending: false })
        .order("updated_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []).map((row) => toNote(row as NoteRowDb));
    },
  });
}

export interface NoteDraft {
  title: string;
  body: string;
  color?: NoteColor;
  pinned?: boolean;
  /** Powiązanie z materiałem platformy - opcjonalne, ustawiane z kontekstu strony. */
  entity?: {
    entityType: NoteEntityType;
    entityId: string;
    title: string;
    url: string | null;
  } | null;
}

export function useCreateNote() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (draft: NoteDraft) => {
      if (!user) throw new Error("Not authenticated");
      const { error } = await supabase.from("user_notes").insert({
        user_id: user.id,
        title: draft.title.trim().slice(0, 200),
        body: draft.body.trim().slice(0, 20_000),
        color: normalizeNoteColor(draft.color),
        pinned: draft.pinned ?? false,
        entity_type:
          draft.entity && isStorableEntityId(draft.entity.entityId)
            ? draft.entity.entityType
            : null,
        entity_id:
          draft.entity && isStorableEntityId(draft.entity.entityId) ? draft.entity.entityId : null,
        entity_title: draft.entity ? draft.entity.title.slice(0, 300) : null,
        entity_url: draft.entity?.url ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: dockKeys.notes(user?.id) }),
  });
}

export function useUpdateNote() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<NoteDraft> }) => {
      const update: {
        title?: string;
        body?: string;
        color?: string;
        pinned?: boolean;
        entity_type?: string | null;
        entity_id?: string | null;
        entity_title?: string | null;
        entity_url?: string | null;
      } = {};
      if (patch.title !== undefined) update.title = patch.title.trim().slice(0, 200);
      if (patch.body !== undefined) update.body = patch.body.trim().slice(0, 20_000);
      if (patch.color !== undefined) update.color = normalizeNoteColor(patch.color);
      if (patch.pinned !== undefined) update.pinned = patch.pinned;
      if (patch.entity !== undefined) {
        const linked =
          patch.entity && isStorableEntityId(patch.entity.entityId) ? patch.entity : null;
        update.entity_type = linked ? linked.entityType : null;
        update.entity_id = linked ? linked.entityId : null;
        update.entity_title = linked ? linked.title.slice(0, 300) : null;
        update.entity_url = linked ? linked.url : null;
      }
      if (Object.keys(update).length === 0) return;
      const { error } = await supabase.from("user_notes").update(update).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: dockKeys.notes(user?.id) }),
  });
}

export function useDeleteNote() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("user_notes").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: dockKeys.notes(user?.id) }),
  });
}
