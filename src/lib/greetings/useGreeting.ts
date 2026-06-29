import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { normalize, pickGreeting, type Lang, type NameEntry } from "./greetings";

interface ProfileLite {
  first_name: string | null;
  display_name: string | null;
}

/**
 * Resolves a personalized, time-of-day greeting for the current user.
 * Returns null while loading so callers can show fallback chrome.
 */
export function useGreeting(): string | null {
  const { user } = useAuth();
  const { i18n } = useTranslation();
  const lang: Lang = (i18n.language ?? "pl").startsWith("en") ? "en" : "pl";
  const [greeting, setGreeting] = useState<string | null>(null);

  useEffect(() => {
    if (!user?.id) { setGreeting(null); return; }
    let cancelled = false;

    void (async () => {
      const { data: profile } = await supabase
        .from("profiles")
        .select("first_name, display_name")
        .eq("id", user.id)
        .maybeSingle<ProfileLite>();

      const first = (profile?.first_name?.trim()
        || profile?.display_name?.split(" ")[0]?.trim()
        || (user.user_metadata?.first_name as string | undefined)?.trim()
        || "");

      let entry: NameEntry | null = null;
      if (first) {
        const { data } = await supabase
          .from("name_dictionary")
          .select("name, name_normalized, gender, vocative_pl, vocative_en")
          .eq("name_normalized", normalize(first))
          .limit(1)
          .maybeSingle<NameEntry>();
        entry = data ?? null;
      }

      if (cancelled) return;
      setGreeting(pickGreeting({ lang, firstName: first || null, entry, seed: user.id }));
    })();

    return () => { cancelled = true; };
  }, [user?.id, lang]);

  return greeting;
}
