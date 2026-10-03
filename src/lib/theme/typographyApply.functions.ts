// Server fn: zastosowanie globalnych ustawień typografii do już
// opublikowanych wpisów. Nie zmienia treści merytorycznej - usuwa wyłącznie
// zaszytą inline typografię (font-size / line-height / font-family /
// letter-spacing), dzięki czemu wpis zaczyna dziedziczyć tokeny z Opcji motywu
// i wygląda identycznie na froncie oraz w canvasie Gutenberga.
//
// Tryb `dryRun` (domyślny) tylko raportuje, ile wpisów wymaga migracji.
//
// DEFEKT, który ten plik zamyka (wydanie 11, „naprawić albo usunąć migrację
// typografii"): odczyt szedł klientem użytkownika z założeniem, że „RLS +
// tenant scoping" zawęzi go do tenanta admina. Oba założenia były fałszywe:
//   * kolumny ciała (`content_pl/en`, `blocks_data`, `builder_data`) są
//     odebrane roli `authenticated` (20260702200000), więc SELECT kończył się
//     `permission denied` - skan nie działał w ogóle;
//   * opublikowane wpisy są czytelne publicznie we WSZYSTKICH tenantach, więc
//     nawet z prawem do kolumn filtr robiłoby wyłącznie RLS, a ten tenanta nie
//     zawęża dla treści publicznych.
// Teraz odczyt idzie service_role z JAWNYM `.eq("tenant_id")` (tenant z
// profilu, nigdy z wejścia) - ta sama doktryna co `posts-migrate` i
// `getMediaUsage` - a zapis zostaje pod RLS wołającego i musi trafić w wiersz.
import { createServerFn } from "@tanstack/react-start";
import { requireAdmin } from "@/integrations/supabase/require-staff";
import { buildTypographyPatch, type TypographyPostInput } from "@/lib/theme/typographyApply";
import { resolveUserTenantId } from "@/lib/server/userTenant.server";

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

/**
 * Rozmiar partii skanu. Treści wpisów bywają wielokilobajtowe, a archiwum
 * liczy tysiące pozycji - jedno zapytanie bez limitu trzymałoby całe archiwum
 * w pamięci workera naraz.
 * @internal eksport wyłącznie dla testu granicy partii.
 */
export const TYPOGRAPHY_SCAN_BATCH = 100;

const POST_COLUMNS =
  "id, slug, title_pl, title_en, content_pl, content_en, blocks_data, builder_data";

export const applyTypographyToPublished = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((input: Partial<ApplyTypographyInput> | undefined): ApplyTypographyInput => ({
    dryRun: input?.dryRun !== false,
  }))
  .handler(async ({ data, context }): Promise<ApplyTypographyResult> => {
    const { supabase, userId } = context;
    // Kolumny ciała są odebrane roli `authenticated`, więc odczyt idzie
    // service_role. Service_role omija RLS - jawny filtr tenanta JEST tu całą
    // granicą, dlatego brak tenanta kończy się wyjątkiem przed pierwszym
    // zapytaniem o wpisy.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const tenantId = await resolveUserTenantId(supabaseAdmin, userId);

    let scanned = 0;
    let affected = 0;
    let updated = 0;
    const preview: ApplyTypographyResult["posts"] = [];

    for (let from = 0; ; from += TYPOGRAPHY_SCAN_BATCH) {
      // Stabilny porządek po kluczu: zapis nie zmienia ani statusu, ani
      // `deleted_at`, więc kolejne partie nie przesuwają się pod skanem.
      const { data: rows, error } = await supabaseAdmin
        .from("posts")
        .select(POST_COLUMNS)
        .eq("tenant_id", tenantId)
        .eq("status", "published")
        .is("deleted_at", null)
        .order("id", { ascending: true })
        .range(from, from + TYPOGRAPHY_SCAN_BATCH - 1);
      if (error) throw new Error(error.message);
      const batch = rows ?? [];
      scanned += batch.length;

      for (const row of batch) {
        const patch = buildTypographyPatch({
          id: row.id,
          slug: row.slug,
          title: row.title_pl || row.title_en || row.slug,
          content_pl: row.content_pl,
          content_en: row.content_en,
          blocks_data: row.blocks_data as TypographyPostInput["blocks_data"],
          builder_data: row.builder_data as TypographyPostInput["builder_data"],
        });
        if (!patch) continue;
        affected += 1;
        if (preview.length < 20)
          preview.push({ id: patch.id, slug: patch.slug, title: patch.title });
        if (data.dryRun) continue;

        const { id, slug: _slug, title: _title, ...fields } = patch;
        // Zapis klientem WOŁAJĄCEGO (RLS), zawężony także po tenancie.
        // `select("id")` zamienia cichy filtr polityki (0 wierszy, brak błędu)
        // w jawny błąd - inaczej raport liczyłby wpis jako zaktualizowany.
        const { data: written, error: updateError } = await supabase
          .from("posts")
          .update(fields)
          .eq("id", id)
          .eq("tenant_id", tenantId)
          .select("id");
        if (updateError) throw new Error(updateError.message);
        if (!written?.length) throw new Error(`Post ${id} was not updated (access denied)`);
        updated += 1;
      }

      if (batch.length < TYPOGRAPHY_SCAN_BATCH) break;
    }

    return { dryRun: data.dryRun, scanned, affected, updated, posts: preview };
  });
