// Server fn: zastosowanie globalnych ustawień typografii do już
// opublikowanych wpisów. Nie zmienia treści merytorycznej - usuwa wyłącznie
// zaszytą inline typografię (font-size / line-height / font-family /
// letter-spacing), dzięki czemu wpis zaczyna dziedziczyć tokeny z Opcji motywu
// i wygląda identycznie na froncie oraz w canvasie Gutenberga.
//
// Tryb `dryRun` (domyślny) tylko raportuje, ile wpisów wymaga migracji.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { buildTypographyPatch, type TypographyPostInput } from "@/lib/theme/typographyApply";

interface ApplyTypographyInput {
  dryRun: boolean;
}

export interface ApplyTypographyResult {
  dryRun: boolean;
  scanned: number;
  affected: number;
  updated: number;
  posts: { id: string; slug: string; title: string }[];
}

export const applyTypographyToPublished = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: Partial<ApplyTypographyInput> | undefined): ApplyTypographyInput => ({
    dryRun: input?.dryRun !== false,
  }))
  .handler(async ({ data, context }): Promise<ApplyTypographyResult> => {
    const { data: isAdmin, error: roleError } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (roleError || !isAdmin) throw new Error("Forbidden: admin required");

    // RLS + tenant scoping działa przez klienta użytkownika - świadomie NIE
    // używamy service role, żeby operacja dotyczyła wyłącznie tenanta admina.
    const { data: rows, error } = await context.supabase
      .from("posts")
      .select("id, slug, title_pl, title_en, content_pl, content_en, blocks_data, builder_data")
      .eq("status", "published")
      .is("deleted_at", null);
    if (error) throw new Error(error.message);

    const patches = (rows ?? [])
      .map((row) =>
        buildTypographyPatch({
          id: row.id,
          slug: row.slug,
          title: row.title_pl || row.title_en || row.slug,
          content_pl: row.content_pl,
          content_en: row.content_en,
          blocks_data: row.blocks_data as TypographyPostInput["blocks_data"],
          builder_data: row.builder_data as TypographyPostInput["builder_data"],
        }),
      )
      .filter((p): p is NonNullable<typeof p> => p !== null);

    let updated = 0;
    if (!data.dryRun) {
      for (const patch of patches) {
        const { id, slug: _slug, title: _title, ...fields } = patch;
        const { error: updateError } = await context.supabase
          .from("posts")
          .update(fields)
          .eq("id", id);
        if (updateError) throw new Error(updateError.message);
        updated += 1;
      }
    }

    return {
      dryRun: data.dryRun,
      scanned: rows?.length ?? 0,
      affected: patches.length,
      updated,
      posts: patches.slice(0, 20).map((p) => ({ id: p.id, slug: p.slug, title: p.title })),
    };
  });
