// Baza wewnętrzna ekspertów - JEDNO źródło listy osób dla obu edytorów.
//
// Widget „Karta profilu autora" (builder Elementor-like) i wariant `profile`
// bloku `author-bio` (block editor / Gutenberg) pozwalają wskazać osobę z
// wewnętrznej bazy zamiast przepisywać dane ręcznie. Publiczny katalog
// (`expertsDirectoryQueryOptions`) do tego NIE WYSTARCZA: pokazuje wyłącznie
// osoby z odznaką „ekspert" ORAZ publicznym profilem autorskim, więc redakcja
// nie mogła wskazać kogoś, kogo profil czeka jeszcze na publikację - i nie
// widziała, że taka osoba w bazie jest.
//
// Dlatego lista składa się z trzech sygnałów, scalanych po `user_id`:
//   1) odznaka `expert` (profile_badges) -> `isExpert`,
//   2) profil autorski -> stanowisko, firma, `isPublic`; z DWÓCH źródeł, bo
//      tabela bazowa nie ma już polityk odczytu publicznego (20260817120000):
//      widok author_profiles_public daje profile opublikowane, a tabela
//      author_profiles (RLS: właściciel + admin tenanta) dokłada adminowi
//      profile NIEpubliczne, czekające na publikację,
//   3) role redakcyjne (admin_list_users) -> osoby bez profilu autorskiego.
//
// `admin_list_users` jest dostępne tylko dla admina tenanta. Dla staffu bez tej
// roli (editor/author) RPC zwraca błąd - wtedy schodzimy na widok publiczny i
// oznaczamy wynik jako `restricted`, żeby panel mógł to powiedzieć wprost,
// zamiast udawać, że baza jest mniejsza niż w rzeczywistości.
import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

const TTL = 60_000;

/** Role, które w tej platformie oznaczają osobę „redakcyjną" (autor treści). */
const AUTHOR_ROLES = new Set(["author", "editor", "admin", "super_admin"]);

export interface InternalExpertEntry {
  id: string;
  name: string;
  slug: string | null;
  avatarUrl: string | null;
  jobTitle: string | null;
  company: string | null;
  /** Ma odznakę „ekspert". */
  isExpert: boolean;
  /** Profil autorski jest opublikowany (widoczny w /experts). */
  isPublic: boolean;
}

export interface InternalExpertBase {
  entries: InternalExpertEntry[];
  /** Wszystkie osoby w bazie wewnętrznej. */
  total: number;
  /** Osoby z odznaką „ekspert". */
  expertCount: number;
  /** Osoby z opublikowanym profilem autorskim. */
  publicCount: number;
  /** true = zalogowany nie ma uprawnień do pełnej listy (widok publiczny). */
  restricted: boolean;
}

interface ApRow {
  user_id: string;
  job_title: string | null;
  company: string | null;
  is_public: boolean | null;
}

/**
 * Wiersz wizytówki wspólny dla OBU źródeł: tabela bazowa typuje
 * user_id/is_public jako NOT NULL, widok author_profiles_public - wszystkie
 * kolumny jako nullable. Unia obu to wariant nullable, zawężany strażnikiem
 * przy scalaniu (bez rzutowań - kształt pilnuje kompilator).
 */
interface ApSourceRow {
  user_id: string | null;
  job_title: string | null;
  company: string | null;
  is_public: boolean | null;
}

interface UserRow {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  slug: string | null;
  roles: string[] | null;
}

const byName = (a: InternalExpertEntry, b: InternalExpertEntry) =>
  a.name.localeCompare(b.name, undefined, { sensitivity: "base" });

export const internalExpertBaseQueryOptions = () =>
  queryOptions({
    queryKey: ["admin", "internal-expert-base"] as const,
    staleTime: TTL,
    queryFn: async (): Promise<InternalExpertBase> => {
      const [badgeRes, apPublicRes, apOwnRes, adminRes] = await Promise.all([
        supabase.from("profile_badges").select("user_id").eq("badge", "expert"),
        // Profile opublikowane: publiczna projekcja (bez PII kontaktowego).
        supabase.from("author_profiles_public").select("user_id, job_title, company, is_public"),
        // Tabela bazowa: RLS wpuszcza wiersz własny oraz - dla admina -
        // wszystkie wiersze tenanta, w tym profile czekające na publikację.
        supabase.from("author_profiles").select("user_id, job_title, company, is_public"),
        supabase.rpc("admin_list_users"),
      ]);

      const expertIds = new Set((badgeRes.data ?? []).map((b) => b.user_id));

      const apByUser = new Map<string, ApRow>();
      // Kolejność scalania: wiersze z tabeli bazowej (własny/adminowe)
      // nadpisują projekcję publiczną - to te same fizyczne wiersze, ale
      // tylko tabela niesie profile niepubliczne.
      const apRows: readonly ApSourceRow[] = [
        ...(apPublicRes.data ?? []),
        ...(apOwnRes.data ?? []),
      ];
      for (const row of apRows) {
        if (row.user_id) apByUser.set(row.user_id, { ...row, user_id: row.user_id });
      }

      const restricted = !!adminRes.error;
      let people: UserRow[];

      if (!restricted) {
        people = (adminRes.data ?? []).filter(
          (r) =>
            expertIds.has(r.id) ||
            apByUser.has(r.id) ||
            (r.roles ?? []).some((role) => AUTHOR_ROLES.has(role)),
        );
      } else {
        // Fallback bez uprawnień administracyjnych: tożsamości z widoku
        // publicznego, ograniczone do osób obecnych w bazie ekspertów.
        const ids = Array.from(new Set([...expertIds, ...apByUser.keys()]));
        if (ids.length === 0) {
          return { entries: [], total: 0, expertCount: 0, publicCount: 0, restricted };
        }
        const { data } = await supabase
          .from("profiles_public")
          .select("id, slug, display_name, avatar_url")
          .in("id", ids);
        // Widok typuje id jako nullable - strażnik zawęża i odsiewa wiersze
        // bez identyfikatora zamiast rzutować kształt.
        people = (data ?? []).flatMap((p) =>
          p.id
            ? [
                {
                  id: p.id,
                  slug: p.slug,
                  display_name: p.display_name,
                  avatar_url: p.avatar_url,
                  roles: null,
                },
              ]
            : [],
        );
      }

      const entries: InternalExpertEntry[] = people
        .filter((p) => !!p.id)
        .map((p) => {
          const ap = apByUser.get(p.id);
          return {
            id: p.id,
            name: p.display_name?.trim() || p.slug || p.id,
            slug: p.slug ?? null,
            avatarUrl: p.avatar_url ?? null,
            jobTitle: ap?.job_title ?? null,
            company: ap?.company ?? null,
            isExpert: expertIds.has(p.id),
            isPublic: ap?.is_public === true,
          };
        })
        .sort(byName);

      return {
        entries,
        total: entries.length,
        expertCount: entries.filter((e) => e.isExpert).length,
        publicCount: entries.filter((e) => e.isPublic).length,
        restricted,
      };
    },
  });

/** Filtr listy: imię i nazwisko, stanowisko, firma, slug. */
export function filterInternalExperts(
  entries: readonly InternalExpertEntry[],
  query: string,
): InternalExpertEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...entries];
  return entries.filter((e) =>
    [e.name, e.jobTitle, e.company, e.slug]
      .filter((v): v is string => typeof v === "string" && v.length > 0)
      .some((v) => v.toLowerCase().includes(q)),
  );
}
