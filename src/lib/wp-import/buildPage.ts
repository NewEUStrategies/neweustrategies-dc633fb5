// Wspólny builder strony z pary PL/EN - używany przez OBIE ścieżki importu
// WordPressa: konektor WP.com (`wpImportPages`) i upload eksportu WXR
// (`wpImportFromWxr`).
//
// DEFEKT, który ten moduł zamyka: treść EN była gubiona po cichu.
//  * ścieżka WXR konwertowała `content_en_html`, a następnie ją wyrzucała
//    (`void convEn`) - komentarz obok obiecywał zapis do `content_en`, którego
//    nikt nie robił; cała gałąź EN żyła dodatkowo wewnątrz `if (mirror)`, więc
//    przy wyłączonym ściąganiu mediów EN nie był nawet konwertowany,
//  * ścieżka konektora brała z pary EN wyłącznie tytuł i zapowiedź, a
//    `wpEn.content` przepadało bez śladu,
//  * w obu przypadkach import raportował czyste „zaimportowano" - redakcja
//    dowiadywała się o braku wersji angielskiej dopiero na produkcji.
//
// Teraz obie ścieżki idą jedną drogą: konwersja PL i EN zawsze, mirror mediów
// z obu wersji w jednym przebiegu, zapis do `content_pl` / `content_en` i
// jawny `enBody` w wyniku importu.
//
// Podział ról w schemacie `pages` pozostaje bez zmian: `builder_data` to
// kanoniczny UKŁAD strony (jeden na stronę), a `content_pl` / `content_en` to
// treść per język - czyta ją silnik `html` (ContentRenderer), skan użycia
// mediów, kontrola linków i przepływ tłumaczeń w edytorze.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { BuilderDocument } from "@/lib/builder/types";
import { convertHtmlToBuilder, type ConversionResult } from "@/lib/wp-import/convert";

/**
 * Los treści EN - wchodzi do rezultatu importu, żeby nigdy nie był niewidoczny.
 *  - "none":      pary EN nie było (nic do zrobienia),
 *  - "persisted": treść EN przekonwertowana i zapisana do `content_en`,
 *  - "empty":     EN dostarczone, ale po konwersji nic z niego nie zostało.
 */
export type EnBodyOutcome = "none" | "persisted" | "empty";

export const EN_BODY_EMPTY_WARNING =
  "Wersja EN nie zawierała treści po konwersji - zapisano wyłącznie tytuł i zapowiedź EN.";

export interface SourceBody {
  title: string;
  contentHtml: string;
  excerpt: string;
}

export interface SourceBodyPl extends SourceBody {
  cover: string | null;
}

export interface BuiltPage {
  builderDoc: BuilderDocument;
  title_pl: string;
  title_en: string;
  excerpt_pl: string | null;
  excerpt_en: string | null;
  /** Wyczyszczony HTML PL. */
  content_pl: string | null;
  /** Wyczyszczony HTML EN - dotąd konwertowany i wyrzucany. */
  content_en: string | null;
  cover_image_url: string | null;
  mediaMirrored: number;
  warnings: string[];
  source: ConversionResult["source"];
  enBody: EnBodyOutcome;
}

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, "").trim();
}

/** Klasyfikacja losu treści EN - jedno miejsce dla obu ścieżek importu. */
export function classifyEnBody(hasEnSource: boolean, convertedEnHtml: string): EnBodyOutcome {
  if (!hasEnSource) return "none";
  return convertedEnHtml.trim() ? "persisted" : "empty";
}

export async function buildPageFromHtmlPair(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  userId: string,
  pl: SourceBodyPl,
  en: SourceBody | null,
  mirror: boolean,
  includeExternal: boolean,
): Promise<BuiltPage> {
  const conv = convertHtmlToBuilder(pl.contentHtml ?? "");
  const warnings = [...conv.warnings];

  let builderDoc = conv.doc;
  let contentPl = conv.cleanedHtml;
  let cover = pl.cover ?? null;
  let mediaMirrored = 0;
  // Konwersja EN ZAWSZE - niezależnie od `mirror`.
  let contentEn = en ? convertHtmlToBuilder(en.contentHtml ?? "").cleanedHtml : "";

  if (mirror) {
    const { mirrorWpMedia, rewriteBuilderDoc, rewriteHtml } =
      await import("@/lib/server/wp-media.server");
    // Obie wersje w jednym przebiegu - media z treści EN też mają wylądować w
    // bibliotece, a nie zostać hotlinkiem do starego WordPressa.
    const combinedHtml = `${conv.cleanedHtml}\n${contentEn}`;
    const {
      map,
      warnings: mw,
      mirroredCount,
      reusedCount,
    } = await mirrorWpMedia({
      html: combinedHtml,
      extraUrls: cover ? [cover] : [],
      tenantId,
      userId,
      supabase,
      includeExternal,
    });
    mediaMirrored = mirroredCount + reusedCount;
    warnings.push(...mw);
    builderDoc = rewriteBuilderDoc(builderDoc, map);
    contentPl = rewriteHtml(contentPl, map);
    if (cover) cover = rewriteHtml(cover, map);
    if (contentEn) contentEn = rewriteHtml(contentEn, map);
  }

  const enBody = classifyEnBody(en !== null, contentEn);
  if (enBody === "empty") warnings.push(EN_BODY_EMPTY_WARNING);

  return {
    builderDoc,
    title_pl: stripTags(pl.title || ""),
    title_en: en ? stripTags(en.title || "") : "",
    excerpt_pl: stripTags(pl.excerpt || "") || null,
    excerpt_en: en ? stripTags(en.excerpt || "") || null : null,
    content_pl: contentPl.trim() || null,
    content_en: contentEn.trim() || null,
    cover_image_url: cover,
    mediaMirrored,
    warnings,
    source: conv.source,
    enBody,
  };
}
