import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useSiteSetting } from "@/lib/useSiteSetting";
import { useHeaderProfile } from "@/lib/profile/useHeaderProfile";
import { normalize, pickGreeting, DEFAULT_GREETINGS, type Lang, type NameEntry, type GreetingsDictionary } from "./greetings";

interface ProfileLite {
  first_name: string | null;
  last_name: string | null;
  display_name: string | null;
}

function deriveFirstName(p: ProfileLite | null, meta: Record<string, unknown> | undefined, email: string | null): string {
  const candidates: Array<string | null | undefined> = [
    p?.first_name,
    (meta?.first_name as string | undefined),
    (meta?.given_name as string | undefined),
    p?.display_name?.trim().split(/\s+/)[0],
    (meta?.full_name as string | undefined)?.trim().split(/\s+/)[0],
    (meta?.name as string | undefined)?.trim().split(/\s+/)[0],
    email ? email.split("@")[0].split(/[._\-+0-9]/)[0] : null,
  ];
  for (const c of candidates) {
    const v = (c ?? "").trim();
    if (v && v.length >= 2 && /[a-zA-Ząćęłńóśźż]/i.test(v)) {
      return v.charAt(0).toUpperCase() + v.slice(1).toLowerCase();
    }
  }
  return "";
}

/**
 * Resolves a personalized, time-of-day greeting for the current user.
 *
 * No request waterfall: a greeting is returned synchronously as soon as the
 * session is known (name derived from auth metadata / email), while the
 * profile row (shared with the account menu via useHeaderProfile - one fetch
 * for the whole header) and the vocative dictionary entry resolve in parallel
 * and upgrade the text in place. Previously this awaited profile -> then
 * dictionary sequentially before showing anything.
 */
export function useGreeting(): string | null {
  const { user } = useAuth();
  const { i18n } = useTranslation();
  const lang: Lang = (i18n.language ?? "pl").startsWith("en") ? "en" : "pl";
  const overrides = useSiteSetting<GreetingsDictionary>("greetings", DEFAULT_GREETINGS);

  const { data: profile } = useHeaderProfile(user?.id);

  const meta = (user?.user_metadata ?? {}) as Record<string, unknown>;
  const first = user ? deriveFirstName(profile ?? null, meta, user.email ?? null) : "";
  const normalized = first ? normalize(first) : "";

  // Vocative / gender entry, cached per normalized name (names repeat across
  // users and sessions; the dictionary is effectively immutable content).
  const { data: entry } = useQuery({
    queryKey: ["name-dictionary", normalized],
    enabled: !!normalized,
    staleTime: 24 * 60 * 60_000,
    gcTime: 60 * 60_000,
    queryFn: async (): Promise<NameEntry | null> => {
      const { data } = await supabase
        .from("name_dictionary")
        .select("name, name_normalized, gender, vocative_pl, vocative_en")
        .eq("name_normalized", normalized)
        .limit(1)
        .maybeSingle<NameEntry>();
      return data ?? null;
    },
  });

  if (!user?.id) return null;
  return pickGreeting({
    lang,
    firstName: first || null,
    entry: entry ?? null,
    seed: user.id,
    overrides,
  });
}
