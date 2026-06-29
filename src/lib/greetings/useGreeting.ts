import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { normalize, pickGreeting, type Lang, type NameEntry } from "./greetings";

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
 * Returns a synchronous fallback immediately, then upgrades to a vocative-aware
 * variant once the name dictionary entry is resolved.
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
        .select("first_name, last_name, display_name")
        .eq("id", user.id)
        .maybeSingle<ProfileLite>();

      const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
      const first = deriveFirstName(profile ?? null, meta, user.email ?? null);

      // Sync fallback right away (plain name, no vocative yet).
      if (!cancelled) {
        setGreeting(pickGreeting({ lang, firstName: first || null, entry: null, seed: user.id }));
      }

      // Upgrade with dictionary entry (vocative_pl / vocative_en, gender).
      if (first) {
        const { data } = await supabase
          .from("name_dictionary")
          .select("name, name_normalized, gender, vocative_pl, vocative_en")
          .eq("name_normalized", normalize(first))
          .limit(1)
          .maybeSingle<NameEntry>();
        if (!cancelled) {
          setGreeting(pickGreeting({ lang, firstName: first, entry: data ?? null, seed: user.id }));
        }
      }
    })();

    return () => { cancelled = true; };
  }, [user?.id, user?.email, lang]);

  return greeting;
}
