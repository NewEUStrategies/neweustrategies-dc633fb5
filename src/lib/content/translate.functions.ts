// Server fn tłumaczenia roboczego PL->EN (B4). STATELESS z założenia:
// przyjmuje bieżące pola PL z edytora, zwraca szkic pól EN - NIC nie zapisuje
// do bazy. Tłumaczenie ląduje w formularzu edytora, redakcja weryfikuje
// i dopiero zapis utrwala (żaden automat nie publikuje tekstu bez człowieka).
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireStaff } from "@/integrations/supabase/require-staff";
import { rateLimit } from "./../server/rate-limit.server";
import { buildSegments, type TranslateOutput } from "./translateSegments";
import { safeParseBlocks } from "@/lib/blocks/schema";
import type { Block } from "@/lib/blocks/types";

const TranslateInputSchema = z.object({
  title_pl: z.string().max(300).default(""),
  excerpt_pl: z.string().max(2000).nullable().default(null),
  takeaways_pl: z.array(z.string().max(500)).max(7).default([]),
  seo_title_pl: z.string().max(300).nullable().default(null),
  seo_description_pl: z.string().max(500).nullable().default(null),
  content_pl: z.string().max(200_000).nullable().default(null),
  /** Dokument bloków PL ({version:1, blocks}) - walidowany safeParseBlocks. */
  blocks_doc_pl: z.unknown().nullable().default(null),
});

export const translatePostDraft = createServerFn({ method: "POST" })
  .middleware([requireStaff])
  .inputValidator((i: unknown) => TranslateInputSchema.parse(i ?? {}))
  .handler(async ({ data, context }): Promise<TranslateOutput> => {
    const { userId } = context;
    // Tłumaczenie woła zewnętrzny model - ostrzejszy limit niż zapisy.
    if (!(await rateLimit({ scope: "post.translate", subjectId: userId, max: 10 }))) {
      throw new Error("Rate limit exceeded - please slow down");
    }

    let blocks: Block[] | null = null;
    if (data.blocks_doc_pl) {
      const parsed = safeParseBlocks(data.blocks_doc_pl);
      if (!parsed) throw new Error("Invalid blocks document");
      blocks = parsed.blocks;
    }

    const segmented = buildSegments({
      title_pl: data.title_pl,
      excerpt_pl: data.excerpt_pl,
      takeaways_pl: data.takeaways_pl,
      seo_title_pl: data.seo_title_pl,
      seo_description_pl: data.seo_description_pl,
      content_pl: data.content_pl,
      blocks_pl: blocks,
    });
    if (segmented.texts.length === 0) {
      throw new Error("Brak treści PL do przetłumaczenia / no Polish content to translate");
    }

    // Import dynamiczny: moduł server-only (sekrety) nie może trafić do
    // bundla klienta przez graf importów route'ów.
    const { translateSegmentsPlToEn } = await import("@/lib/server/aiTranslate.server");
    const translated = await translateSegmentsPlToEn(segmented.texts);
    return segmented.apply(translated);
  });
