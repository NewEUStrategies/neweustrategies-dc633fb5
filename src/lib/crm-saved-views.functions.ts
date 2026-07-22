// Server functions dla zapisanych widoków list w panelu admina (encje:
// company, lead, contact). Config trzymamy jako JSON string dla stabilnej
// serializacji przez TanStack RPC. RLS w `saved_views` gwarantuje, że
// użytkownik widzi/modyfikuje wyłącznie własne widoki w swoim tenancie.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireStaff } from "@/integrations/supabase/require-staff";

const ENTITY = z.enum(["company", "lead", "contact"]);

const ListInput = z.object({ entity: ENTITY });

interface SupaClient {
  from: (t: string) => {
    select: (s: string) => {
      eq: (
        c: string,
        v: string,
      ) => {
        order: (
          c: string,
          o: { ascending: boolean },
        ) => Promise<{
          data: Array<{
            id: string;
            name: string;
            config: unknown;
            is_shared: boolean;
            sort_order: number;
            user_id: string;
            updated_at: string;
          }> | null;
          error: { message: string } | null;
        }>;
      };
    };
    insert: (v: unknown) => {
      select: (s: string) => {
        single: () => Promise<{
          data: { id: string } | null;
          error: { message: string } | null;
        }>;
      };
    };
    update: (v: unknown) => {
      eq: (c: string, v: string) => Promise<{ error: { message: string } | null }>;
    };
    delete: () => {
      eq: (c: string, v: string) => Promise<{ error: { message: string } | null }>;
    };
  };
}

export const listSavedViews = createServerFn({ method: "POST" })
  .middleware([requireStaff])
  .inputValidator((d) => ListInput.parse(d))
  .handler(async ({ data, context }) => {
    const supa = context.supabase as unknown as SupaClient;
    const { data: rows, error } = await supa
      .from("saved_views")
      .select("id, name, config, is_shared, sort_order, user_id, updated_at")
      .eq("entity", data.entity)
      .order("sort_order", { ascending: true });
    if (error) throw new Error(error.message);
    return { json: JSON.stringify(rows ?? []) };
  });

const UpsertInput = z.object({
  id: z.string().uuid().optional(),
  entity: ENTITY,
  name: z.string().trim().min(1).max(80),
  config: z.unknown(),
  is_shared: z.boolean().optional().default(false),
});

export const upsertSavedView = createServerFn({ method: "POST" })
  .middleware([requireStaff])
  .inputValidator((d) => UpsertInput.parse(d))
  .handler(async ({ data, context }) => {
    const supa = context.supabase as unknown as SupaClient;
    if (data.id) {
      const { error } = await supa
        .from("saved_views")
        .update({ name: data.name, config: data.config, is_shared: data.is_shared })
        .eq("id", data.id);
      if (error) throw new Error(error.message);
      return { ok: true, id: data.id };
    }
    const { data: row, error } = await supa
      .from("saved_views")
      .insert({
        entity: data.entity,
        name: data.name,
        config: data.config,
        is_shared: data.is_shared,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { ok: true, id: row?.id ?? null };
  });

const DeleteInput = z.object({ id: z.string().uuid() });

export const deleteSavedView = createServerFn({ method: "POST" })
  .middleware([requireStaff])
  .inputValidator((d) => DeleteInput.parse(d))
  .handler(async ({ data, context }) => {
    const supa = context.supabase as unknown as SupaClient;
    const { error } = await supa.from("saved_views").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
