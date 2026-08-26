// Hooki powierzchni uczestnika: sekcje, agenda, zapis na sesję, partnerzy,
// materiały, zakładki.
//
// JEDNA FABRYKA KLUCZY NA CAŁĄ POWIERZCHNIĘ. Zapis na sesję zmienia agendę ORAZ
// zajętość ORAZ „moją agendę"; zakładka zmienia stronę wydarzenia ORAZ listę
// zapisanych. Gdyby każdy ekran miał własny literał klucza, po kliknięciu
// odświeżałby się tylko ten, na którym stoi kursor.
//
// UŻYTKOWNIK JEST CZĘŚCIĄ KLUCZA. `event_sections` i `event_agenda`
// PERSONALIZUJĄ odpowiedź (zamki sekcji, `my_signup_status`), więc wynik dla
// gościa nie może zostać w cache po zalogowaniu - to byłby program bez
// własnych zapisów albo, gorzej, cudzy.
//
// ZAPIS NA SESJĘ UNIEWAŻNIA CAŁĄ AGENDĘ, NIE JEDEN WIERSZ. Rezygnacja wpuszcza
// kogoś z rezerwy, więc zmienia liczniki także w sesjach, których uczestnik
// w ogóle nie dotknął.
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";

import { useAuth } from "@/hooks/useAuth";
import {
  fetchEventAgenda,
  fetchEventMenu,
  fetchEventSections,
  fetchEventSponsorMaterials,
  fetchEventSponsors,
  fetchMyBookmarks,
  fetchSessionAccess,
  submitSessionSignup,
  toggleEventBookmark,
  type BookmarkListPage,
  type BookmarkScope,
  type BookmarkToggleResult,
  type EventMenuItem,
  type SessionAccess,
  type SessionSignupResult,
} from "@/lib/events/publicEventApi";
import type { AgendaSession } from "@/lib/events/agendaSurface";
import type { EventSection } from "@/lib/events/eventSections";
import type { PublicSponsorMaterial, PublicSponsorTier } from "@/lib/events/sponsorsSurface";

/** Gość ma własną tożsamość w kluczu - inaczej dzieliłby cache z zalogowanym. */
const ANON = "anon";

export const publicEventKeys = {
  all: ["public-event-surface"] as const,
  event: (slug: string) => [...publicEventKeys.all, slug] as const,
  sections: (slug: string, viewer: string) =>
    [...publicEventKeys.event(slug), "sections", viewer] as const,
  menu: (slug: string, viewer: string) => [...publicEventKeys.event(slug), "menu", viewer] as const,
  agenda: (slug: string, viewer: string) =>
    [...publicEventKeys.event(slug), "agenda", viewer] as const,
  sponsors: (slug: string) => [...publicEventKeys.event(slug), "sponsors"] as const,
  materials: (slug: string) => [...publicEventKeys.event(slug), "materials"] as const,
  sessionAccess: (sessionId: string, viewer: string) =>
    [...publicEventKeys.all, "session-access", sessionId, viewer] as const,
  bookmarks: (viewer: string, scope: BookmarkScope, offset: number) =>
    [...publicEventKeys.all, "bookmarks", viewer, scope, offset] as const,
};

function useViewerId(): string {
  const { user } = useAuth();
  return user?.id ?? ANON;
}

/* ------------------------------------------------------------ zapytania --- */

export function useEventSections(slug: string, enabled = true): UseQueryResult<EventSection[]> {
  const viewer = useViewerId();
  return useQuery({
    queryKey: publicEventKeys.sections(slug, viewer),
    queryFn: () => fetchEventSections(slug),
    enabled: enabled && slug !== "",
    staleTime: 30_000,
  });
}

/**
 * Menu podstron wydarzenia.
 *
 * UŻYTKOWNIK JEST W KLUCZU, bo `event_menu` filtruje pozycje po grupach
 * zapisu wołającego - pozycja widoczna tylko dla partnerów nie może zostać
 * w cache gościa po zalogowaniu, a menu gościa nie może przeżyć wylogowania
 * z pozycjami, których gość widzieć nie ma prawa.
 */
export function useEventMenu(slug: string, enabled = true): UseQueryResult<EventMenuItem[]> {
  const viewer = useViewerId();
  return useQuery({
    queryKey: publicEventKeys.menu(slug, viewer),
    queryFn: () => fetchEventMenu(slug),
    enabled: enabled && slug !== "",
    // Menu zmienia się w panelu, nie w trakcie zwiedzania strony.
    staleTime: 5 * 60_000,
  });
}

export function useEventAgenda(slug: string, enabled = true): UseQueryResult<AgendaSession[]> {
  const viewer = useViewerId();
  return useQuery({
    queryKey: publicEventKeys.agenda(slug, viewer),
    queryFn: () => fetchEventAgenda(slug),
    enabled: enabled && slug !== "",
    // Krótko, bo w dniu wydarzenia liczba wolnych miejsc jest tym, po co
    // uczestnik odświeża stronę.
    staleTime: 15_000,
  });
}

export function usePublicEventSponsors(
  slug: string,
  enabled = true,
): UseQueryResult<PublicSponsorTier[]> {
  return useQuery({
    queryKey: publicEventKeys.sponsors(slug),
    queryFn: () => fetchEventSponsors(slug),
    enabled: enabled && slug !== "",
    // Migawka partnerów zmienia się rzadko i nie zależy od tego, kto patrzy.
    staleTime: 5 * 60_000,
  });
}

export function usePublicEventMaterials(
  slug: string,
  enabled = true,
): UseQueryResult<PublicSponsorMaterial[]> {
  return useQuery({
    queryKey: publicEventKeys.materials(slug),
    queryFn: () => fetchEventSponsorMaterials(slug),
    enabled: enabled && slug !== "",
    staleTime: 5 * 60_000,
  });
}

export function useSessionAccess(
  sessionId: string | null,
  enabled = true,
): UseQueryResult<SessionAccess> {
  const viewer = useViewerId();
  return useQuery({
    queryKey: publicEventKeys.sessionAccess(sessionId ?? "", viewer),
    queryFn: () => fetchSessionAccess(sessionId ?? ""),
    enabled: enabled && sessionId !== null && sessionId !== "",
    // Adres transmisji bywa krótkotrwały - nie trzymamy go dłużej niż minutę.
    staleTime: 60_000,
  });
}

export function useMyBookmarks(
  scope: BookmarkScope,
  limit: number,
  offset: number,
  enabled = true,
): UseQueryResult<BookmarkListPage> {
  const viewer = useViewerId();
  return useQuery({
    queryKey: publicEventKeys.bookmarks(viewer, scope, offset),
    queryFn: () => fetchMyBookmarks({ scope, limit, offset }),
    enabled: enabled && viewer !== ANON,
  });
}

/* -------------------------------------------------------------- mutacje --- */

export interface SessionSignupVariables {
  sessionId: string;
  status: "registered" | "cancelled";
}

export function useSessionSignup(
  slug: string,
): UseMutationResult<SessionSignupResult, Error, SessionSignupVariables> {
  const qc = useQueryClient();
  const viewer = useViewerId();
  return useMutation({
    mutationFn: (input: SessionSignupVariables) => submitSessionSignup(input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: publicEventKeys.agenda(slug, viewer) });
      // Sekcje też: zapis na sesję czyni z gościa uczestnika, a to otwiera
      // sekcje zamknięte regułą `registered`.
      void qc.invalidateQueries({ queryKey: publicEventKeys.sections(slug, viewer) });
    },
  });
}

export interface BookmarkVariables {
  eventSlug?: string;
  eventId?: string;
  state?: boolean;
}

export function useEventBookmark(): UseMutationResult<
  BookmarkToggleResult,
  Error,
  BookmarkVariables
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: BookmarkVariables) => toggleEventBookmark(input),
    onSuccess: () => {
      // Lista zapisanych zmienia się przy KAŻDYM przełączeniu, niezależnie od
      // zakresu i strony, na której stoi czytelnik.
      void qc.invalidateQueries({ queryKey: [...publicEventKeys.all, "bookmarks"] });
      // Stan gwiazdki na stronie wydarzenia mieszka w `event_page_header`
      // (`is_bookmarked`), a nie w osobnym zapytaniu - klucz nagłówka jest
      // więc CZĘŚCIĄ tej mutacji, mimo że należy do sąsiedniego modułu.
      // Prefiks bez sluga i bez użytkownika: przełączenie z listy nie wie,
      // której strony dotyczy.
      void qc.invalidateQueries({ queryKey: ["event-page-header"] });
    },
  });
}
