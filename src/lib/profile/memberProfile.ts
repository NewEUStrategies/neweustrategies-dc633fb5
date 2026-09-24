// Odczyt profilu członka (/people/<slug>) przez RPC `get_member_profile`.
// RPC jest SECURITY DEFINER, zawęża do tenanta wołającego i respektuje
// `discoverable` - gość i obcy tenant dostają `null`.
import { queryOptions } from "@tanstack/react-query";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";

const nullableText = z
  .string()
  .nullable()
  .optional()
  .transform((v) => v ?? null);

export const memberProfileSchema = z.object({
  id: z.string(),
  slug: z.string(),
  display_name: z.string(),
  avatar_url: nullableText,
  cover_url: nullableText,
  job_title: nullableText,
  company: nullableText,
  location: nullableText,
  bio_pl: nullableText,
  bio_en: nullableText,
  specialization: nullableText,
  linkedin_url: nullableText,
  website_url: nullableText,
  verified: z.boolean(),
  is_self: z.boolean(),
  is_author: z.boolean(),
});

export type MemberProfile = z.infer<typeof memberProfileSchema>;

export function parseMemberProfile(raw: unknown): MemberProfile | null {
  if (raw === null || raw === undefined) return null;
  const parsed = memberProfileSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export function memberProfileQueryOptions(slug: string, userId: string | null) {
  return queryOptions({
    queryKey: ["member-profile", slug, userId],
    enabled: userId !== null,
    staleTime: 60_000,
    queryFn: async (): Promise<MemberProfile | null> => {
      const { data, error } = await supabase.rpc("get_member_profile", { p_slug: slug });
      if (error) throw error;
      return parseMemberProfile(data);
    },
  });
}
