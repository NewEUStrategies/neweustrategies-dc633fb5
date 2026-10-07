// Podpowiedzi osób i firm do @wzmianki. Źródłem jest publiczny, tenant-owy RPC
// search_mention_targets (SECURITY DEFINER + current_tenant_id()/public_tenant_id()). Dzięki temu:
//   * IZOLACJA TENANTA jest wymuszona w bazie (podpowiedzi nigdy nie zawierają
//     osób ani firm z innego obszaru roboczego), bez filtra tenant_id w kliencie;
//   * PRYWATNOŚĆ: RPC zwraca wyłącznie publiczne profile osób oraz firmy CRM
//     z PUBLICZNYM ŚLADEM - organizacje opublikowanych wpisów i opublikowanych
//     sponsorów opublikowanych wydarzeń (migracja 20261003150000). Lead ani
//     prospekt nie trafia do podpowiedzi nikomu, także redakcji; z firmy wychodzi
//     tylko nazwa, logo, strona i branża, bez PII i notatek.
//
// ZAKRES KLUBU (`scope`). Publiczny katalog zna wyłącznie autorów redakcyjnych
// i ekspertów, więc zwykły członek klubu nie dawał się wzmiankować w rozmowie
// we własnym klubie. Z zakresem pytamy RÓWNOLEGLE drugi RPC,
// `club_mention_members`, który oddaje aktywnych, odnajdywalnych członków
// TEGO klubu - za bramką `can_see_members`, więc osoba spoza klubu nie
// wyliczy nim składu. Członkowie idą PIERWSI (w rozmowie w klubie to oni są
// najczęstszym adresatem), duplikaty odpadają po slugu.
//
// Zapytanie jest debounce'owane u wołającego; przy braku funkcji w bazie albo
// błędzie sieci KAŻDE źródło degraduje się osobno do pustej listy - awaria
// jednego nie gasi podpowiedzi z drugiego.
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useMentionQueryClient } from "./queryClient";

export interface MentionSuggestion {
  kind: "person" | "organization";
  slug: string;
  name: string;
  avatarUrl: string | null;
  logoUrl: string | null;
  website: string | null;
  subtitle: string | null;
  verified: boolean;
}

/** Zawężenie podpowiedzi do rozmowy w konkretnym klubie. */
export interface MentionSuggestionScope {
  clubId: string;
}

/** Ile podpowiedzi pokazujemy naraz (lista pozostaje zwięzła i nawigowalna). */
export const MENTION_SUGGESTION_LIMIT = 6;

/** Wspólny kształt wiersza obu RPC (`search_mention_targets`, `club_mention_members`). */
interface MentionTargetRow {
  kind: string | null;
  slug: string | null;
  label: string | null;
  avatar_url: string | null;
  logo_url: string | null;
  website: string | null;
  subtitle: string | null;
  verified: boolean | null;
}

function toSuggestions(rows: readonly MentionTargetRow[] | null | undefined): MentionSuggestion[] {
  const out: MentionSuggestion[] = [];
  for (const r of rows ?? []) {
    if (r.kind !== "person" && r.kind !== "organization") continue;
    if (typeof r.slug !== "string" || r.slug.length === 0) continue;
    out.push({
      kind: r.kind === "organization" ? "organization" : "person",
      slug: r.slug,
      name: r.label || r.slug,
      avatarUrl: r.avatar_url || null,
      logoUrl: r.logo_url || null,
      website: r.website || null,
      subtitle: r.subtitle || null,
      verified: r.verified === true,
    });
  }
  return out;
}

/**
 * Scalenie źródeł: kolejność list = priorytet, duplikat po slugu (bez względu
 * na wielkość liter - baza i parser wzmianek porównują slugi małymi literami)
 * zostaje w PIERWSZYM źródle, a wynik jest przycięty do limitu.
 */
export function mergeMentionSuggestions(
  sources: ReadonlyArray<readonly MentionSuggestion[]>,
  limit: number = MENTION_SUGGESTION_LIMIT,
): MentionSuggestion[] {
  const seen = new Set<string>();
  const out: MentionSuggestion[] = [];
  for (const source of sources) {
    for (const item of source) {
      if (out.length >= limit) return out;
      const key = item.slug.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(item);
    }
  }
  return out;
}

async function searchPublicTargets(q: string): Promise<MentionSuggestion[]> {
  try {
    const { data, error } = await supabase.rpc("search_mention_targets", {
      _q: q.length > 0 ? q : undefined,
      _limit: MENTION_SUGGESTION_LIMIT,
    });
    if (error) throw error;
    return toSuggestions(data);
  } catch {
    // Odporność przed wdrożeniem migracji / przy błędzie sieci: brak podpowiedzi.
    return [];
  }
}

async function searchClubMembers(clubId: string, q: string): Promise<MentionSuggestion[]> {
  try {
    const { data, error } = await supabase.rpc("club_mention_members", {
      p_club_id: clubId,
      p_q: q.length > 0 ? q : undefined,
      p_limit: MENTION_SUGGESTION_LIMIT,
    });
    if (error) throw error;
    return toSuggestions(data);
  } catch {
    return [];
  }
}

// Poza drzewem QueryClientProvider (izolowany render pola w testach/podglądzie)
// degradujemy do braku podpowiedzi zamiast rzucać - pole tekstowe ma działać.
export function useMentionSuggestions(
  query: string | null,
  lang: "pl" | "en",
  scope?: MentionSuggestionScope | null,
) {
  const { client, hasProvider } = useMentionQueryClient();
  // query === null oznacza „kursor nie stoi w obrębie wzmianki" - nie pytamy.
  const enabled = query !== null && hasProvider;
  const q = (query ?? "").trim();
  const clubId = scope?.clubId?.trim() ?? "";
  return useQuery(
    {
      // Zakres jest CZĘŚCIĄ klucza: ta sama fraza w dwóch klubach to dwa różne
      // zbiory członków, a bez zakresu - trzeci, publiczny.
      queryKey: ["mention-suggestions", q, lang, clubId === "" ? "public" : clubId] as const,
      enabled,
      staleTime: 60_000,
      queryFn: async (): Promise<MentionSuggestion[]> => {
        if (clubId === "") return mergeMentionSuggestions([await searchPublicTargets(q)]);
        const [members, targets] = await Promise.all([
          searchClubMembers(clubId, q),
          searchPublicTargets(q),
        ]);
        return mergeMentionSuggestions([members, targets]);
      },
    },
    client,
  );
}
