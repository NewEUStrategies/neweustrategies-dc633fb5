// Simultaneous PL/EN reading-time preview for the `read_minutes` hint - the
// same core + settings (/admin/reading-time) as the public site. Extracted 1:1
// from admin.posts.$slug so the memoised computation lives beside the form
// state it derives from.
import { useMemo } from "react";
import { computeBilingualReadingStats, type ReadingStats } from "@/lib/readingTime";
import { useReadingTimeSettings } from "@/hooks/useReadingTimeSettings";
import type { PostForm } from "../types";

export function useBilingualReadingStats(form: PostForm | null): {
  pl: ReadingStats;
  en: ReadingStats;
} {
  const readingTimeSettings = useReadingTimeSettings();
  return useMemo(
    () =>
      computeBilingualReadingStats(
        {
          pl: {
            html: form?.content_pl ?? "",
            docs: [form?.builder_data, form?.blocks_data?.pl],
            extraText: form?.excerpt_pl ?? undefined,
          },
          en: {
            html: form?.content_en ?? "",
            docs: [form?.builder_data, form?.blocks_data?.en],
            extraText: form?.excerpt_en ?? undefined,
          },
        },
        readingTimeSettings,
      ),
    [
      form?.content_pl,
      form?.content_en,
      form?.builder_data,
      form?.blocks_data,
      form?.excerpt_pl,
      form?.excerpt_en,
      readingTimeSettings,
    ],
  );
}
