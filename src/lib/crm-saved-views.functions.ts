// Server functions dla zapisanych widoków list w panelu admina (encje:
// company, lead, contact). Config trzymamy jako JSON string dla stabilnej
// serializacji przez TanStack RPC. RLS w `saved_views` gwarantuje, że
// użytkownik widzi/modyfikuje wyłącznie własne widoki w swoim tenancie.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireCrmStaff } from "@/integrations/supabase/require-staff";
import { looseTable } from "@/lib/supabase/looseQuery";

const ENTITY = z.enum(["company", "lead", "contact"]);

const ListInput = z.object({ entity: ENTITY });

/** Wiersz z identyfikatorem - jedyne pole czytane po zapisie widoku. */
function hasId(row: unknown): row is { id: string } {
  return (
    row !== null && typeof row === "object" && typeof (row as { id?: unknown }).id === "string"
  );
}

export const listSavedViews = createServerFn({ method: "POST" })
  .middleware([requireCrmStaff])
  .validator((d) => ListInput.parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await looseTable(context, "saved_views")
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
  .middleware([requireCrmStaff])
  .validator((d) => UpsertInput.parse(d))
  .handler(async ({ data, context }) => {
    if (data.id) {
      const { error } = await looseTable(context, "saved_views")
        .update({ name: data.name, config: data.config, is_shared: data.is_shared })
        .eq("id", data.id);
      if (error) throw new Error(error.message);
      return { ok: true, id: data.id };
    }
    const { data: row, error } = await looseTable(context, "saved_views")
      .insert({
        entity: data.entity,
        name: data.name,
        config: data.config,
        is_shared: data.is_shared,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { ok: true, id: hasId(row) ? row.id : null };
  });

const DeleteInput = z.object({ id: z.string().uuid() });

export const deleteSavedView = createServerFn({ method: "POST" })
  .middleware([requireCrmStaff])
  .validator((d) => DeleteInput.parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await looseTable(context, "saved_views").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
