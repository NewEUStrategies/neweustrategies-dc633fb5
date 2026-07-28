import type { SupabaseClient } from "@supabase/supabase-js";

import { polishVocative, type PolishGender } from "@/lib/i18n/polishVocative";

export interface ResolvedRecipientName {
  firstName: string | null;
  gender: PolishGender;
  vocativePl: string | null;
}

const EMPTY: ResolvedRecipientName = { firstName: null, gender: "unknown", vocativePl: null };

function pickFirstToken(value?: string | null): string | null {
  const token = (value ?? "").trim().split(/\s+/)[0] ?? "";
  return token.length > 1 ? token : null;
}

/**
 * Ustala imię odbiorcy maila:
 * 1. metadane użytkownika (auth),
 * 2. imię podane w formularzu newslettera (newsletter_subscribers.first_name / display_name),
 * a następnie odmianę w wołaczu ze słownika imion z panelu admina (name_dictionary).
 */
export async function resolveRecipientName(
  supabase: SupabaseClient,
  email: string,
  metaName?: string | null,
  metaGender: PolishGender = "unknown",
): Promise<ResolvedRecipientName> {
  let firstName = pickFirstToken(metaName);
  let gender: PolishGender = metaGender;

  if (!firstName && email) {
    const { data } = await supabase
      .from("newsletter_subscribers")
      .select("first_name, display_name")
      .ilike("email", email)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    firstName = pickFirstToken(data?.first_name) ?? pickFirstToken(data?.display_name);
  }

  if (!firstName) return EMPTY;

  const normalized = firstName.toLocaleLowerCase("pl-PL");
  const { data: dict } = await supabase
    .from("name_dictionary")
    .select("gender, vocative_pl")
    .or(`name_normalized.eq.${normalized},key.eq.${normalized}`)
    .limit(1)
    .maybeSingle();

  if (dict?.gender === "male" || dict?.gender === "female") gender = dict.gender;

  const dictVocative = (dict?.vocative_pl ?? "").trim();
  const vocativePl = dictVocative || polishVocative(firstName, gender);

  return { firstName, gender, vocativePl: vocativePl || null };
}
