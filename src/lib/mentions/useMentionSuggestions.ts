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
// najczęstszym adresatem), duplikaty odpadają po slugu - ale zajmują najwyżej
// cztery miejsca, gdy katalog publiczny ma coś do dodania (patrz
// `mergeClubMentionSuggestions`): firmy przychodzą WYŁĄCZNIE z katalogu.
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

/**
 * Ile miejsc listy katalog publiczny dostaje na pewno, gdy pytamy w klubie.
 * Dwa - lista zostaje rozmową z członkami, a firma da się wzmiankować.
 */
export const CLUB_MENTION_PUBLIC_SLOTS = 2;

/**
 * Scalenie podpowiedzi w klubie: członkowie pierwsi, katalog publiczny dalej.
 *
 * DLACZEGO NIE ZWYKŁE `mergeMentionSuggestions([members, targets])`.
 * `club_mention_members` dopasowuje frazę W DOWOLNYM miejscu imienia, a pusta
 * fraza oddaje sześciu najaktywniejszych - w klubie z sześcioma członkami samo
 * „@" albo „@ba" (Urban, Albano) zajmowało całą listę i firma, którą katalog
 * postawił na pierwszym miejscu, nie miała jak się pokazać. Firm nie zna
 * żadne inne źródło, więc użytkownik nie mógł jej wzmiankować, dopóki nie
 * dopisał tylu liter, żeby odsiać członków.
 *
 * Gdy wszystko się mieści, kolejność jest ta sama co dotąd. Gdy nie, członkowie
 * zajmują najwyżej `limit - CLUB_MENTION_PUBLIC_SLOTS` miejsc (więcej, gdy
 * katalog ma mniej do dodania), a pierwsze miejsca katalogu dostają FIRMY - to
 * ich brak był problemem; osoby z katalogu idą dalej w jego kolejności.
 */
export function mergeClubMentionSuggestions(
  members: readonly MentionSuggestion[],
  targets: readonly MentionSuggestion[],
  limit: number = MENTION_SUGGESTION_LIMIT,
): MentionSuggestion[] {
  // Najpierw same duplikaty (bez limitu), żeby policzyć, ile naprawdę jest czego.
  const uniqueMembers = mergeMentionSuggestions([members], Number.POSITIVE_INFINITY);
  const memberSlugs = new Set(uniqueMembers.map((item) => item.slug.toLowerCase()));
  const others = mergeMentionSuggestions([targets], Number.POSITIVE_INFINITY).filter(
    (item) => !memberSlugs.has(item.slug.toLowerCase()),
  );
  // Wszystko się mieści albo nie ma członków: kolejność jak dotąd - członkowie,
  // potem katalog w swojej kolejności.
  if (uniqueMembers.length === 0 || uniqueMembers.length + others.length <= limit) {
    return mergeMentionSuggestions([uniqueMembers, others], limit);
  }
  const reserved = Math.min(CLUB_MENTION_PUBLIC_SLOTS, others.length, limit);
  const memberCount = Math.min(uniqueMembers.length, limit - reserved);
  // Lista się nie mieści, więc katalog i tak traci miejsca: zarezerwowane idą
  // najpierw do firm, dalej katalog w swojej kolejności (duplikaty odpadają
  // w scaleniu).
  const organizations = others.filter((item) => item.kind === "organization");
  return mergeMentionSuggestions(
    [uniqueMembers.slice(0, memberCount), organizations.slice(0, reserved), others],
    limit,
  );
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
        return mergeClubMentionSuggestions(members, targets);
      },
    },
    client,
  );
}
