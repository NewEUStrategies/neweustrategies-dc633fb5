// PRZEGLĄD wydarzenia - treść zakładki „Strona główna” pod powłoką
// `/events/$slug`. URL bez zmian: `/events/<slug>`.
//
// SKĄD SIĘ TU WZIĄŁ CAŁY TEN KOD. Do tej zmiany siedział w `events.$slug.tsx`,
// który był liściem trasy. Powłoka musiała stać się układem z `<Outlet />` dla
// pięciu zakładek, więc przegląd zszedł o poziom niżej - dokładnie tym samym
// podziałem, co `events.tsx` + `events.index.tsx` piętro wyżej. ANI JEDEN blok
// nie zmienił zachowania: RSVP jest nadal trój-stanowe (going / interested /
// cancelled), ponowne kliknięcie tego samego statusu nadal cofa do 'cancelled',
// komplet miejsc nadal degraduje 'going' SERWEROWO do 'waitlist' (kolejka FIFO
// w rsvp_event), a nagranie po wydarzeniu nadal stoi za bramką warstwy
// rozstrzyganą w get_event_access.
//
// UKŁAD TRÓJKOLUMNOWY MIESZKA W `EventOverviewLayout`, NIE TUTAJ. Ta trasa wnosi
// TREŚĆ kolumn (dane z bazy, decyzje reguł, powierzchnie z zapytaniami), a siatkę
// - zmierzoną ze wzorca 1 : 2 : 1 - rysuje jeden komponent, bo DOKŁADNIE tę samą
// siatkę musi pokazać podgląd w studiu. Dopóki siedziała w tym pliku, podgląd
// miał przepisaną własną (jedna kolumna `max-w-3xl`) i właściciel widział
// w panelu „stary layout”, mimo że nowy był na `main`. Proporcje, kolejność
// w DOM-ie i to, czego z wzorca nie odwzorowujemy (karta profilu widza po lewej,
// baner promocyjny po prawej - brak źródła danych), są opisane przy komponencie.
import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  Calendar,
  MapPin,
  Users,
  ShieldQuestion,
  Video,
  Star,
  BadgeCheck,
  Lock,
  Clock,
  Ticket,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

import {
  fetchEventAccess,
  fetchEventPageHeader,
  fetchEventRsvpCounts,
  fetchEventWaitlistPosition,
  fetchPublicEventBySlug,
  rsvpEvent,
  type RsvpRequestStatus,
} from "@/lib/community/publicQueries";
import {
  canSignalInterest,
  isLegacyRsvpDecision,
  resolveRegistrationSurface,
  rsvpRefusalMessageKey,
  waitlistPositionOf,
} from "@/lib/events/registrationSurface";
import { eventRegistrationActionFrom } from "@/components/events/eventRegistrationAction";
import { EventRegistrationSurface } from "@/components/events/molecules/EventRegistrationSurface";
import { useCommunityModules } from "@/lib/community/useCommunityModules";
import { confirmFreeRsvpEmail } from "@/lib/events/rsvp-email.functions";
import { eventTimeZoneLabel, formatEventDateTime } from "@/lib/events/timezone";
import { useMembershipTiers, tierName, tierHasFeature, useCurrentTier } from "@/lib/billing/tiers";
import { useAuth } from "@/hooks/useAuth";
import { EventGroupButton } from "@/components/network/EventGroupButton";
import { EventSpeakersSection } from "@/components/events/EventSpeakersSection";
import {
  EventOverviewDescription,
  EventOverviewLayout,
  EventOverviewTitle,
} from "@/components/events/public/organisms/EventOverviewLayout";
import { EventPageSections } from "@/components/events/public/organisms/EventPageSections";
import { EventMenuNav } from "@/components/events/public/organisms/EventMenuNav";
import { EventHomeSectionLinks } from "@/components/events/public/organisms/EventHomeSectionLinks";
import { EventSponsorTiers } from "@/components/events/public/organisms/EventSponsorTiers";
import { EventMetaCard, EventMetaRow } from "@/components/events/public/molecules/EventMetaCard";
import { EventVideoHeader } from "@/components/events/public/molecules/EventVideoHeader";
import { EventBookmarkButton } from "@/components/events/public/molecules/EventBookmarkButton";
import { SectionLockCard } from "@/components/events/public/molecules/SectionLockCard";
import { publicEventKeys, useEventSections } from "@/lib/events/usePublicEvent";
import { findEventSection, sectionHeadingKey } from "@/lib/events/eventSections";
import { AddToCalendar } from "@/components/community/AddToCalendar";
import { Button } from "@/components/ui/button";
import { EventTicketPurchase } from "@/components/community/EventTicketPurchase";
import { EventTicketCard } from "@/components/community/EventTicketCard";
import { useEventSeatsRealtime } from "@/hooks/useEventSeatsRealtime";
import { formatMoney } from "@/lib/billing/types";
import type { EventPracticalInfo } from "@/lib/events/eventPractical";
import { getRequestUrl } from "@/lib/seo/request";
import { splitUrl } from "@/lib/seo/meta";
import { publicEventJsonLd, safeJsonLd } from "@/lib/seo/jsonld";
import { ensureI18n as ensureCommunityI18n } from "@/lib/i18n-community";
import { ensureI18n as ensureEventFrontI18n } from "@/lib/i18n-event-front";

type RsvpStatus = "going" | "interested" | "cancelled" | "waitlist";

export const Route = createFileRoute("/events/$slug/")({
  component: EventOverview,
});

function EventOverview() {
  ensureCommunityI18n();
  ensureEventFrontI18n();
  const { slug } = useParams({ from: "/events/$slug/" });
  const { t, i18n } = useTranslation();
  const lang = (i18n.language.startsWith("en") ? "en" : "pl") as "pl" | "en";
  const modules = useCommunityModules();
  const { user } = useAuth();
  const qc = useQueryClient();

  // TEN SAM KLUCZ, CO W POWŁOCE - react-query oddaje migawkę z cache, więc to
  // nie jest drugie zapytanie ani druga chwila w czasie.
  const eventQ = useQuery({
    queryKey: ["public-event", slug],
    queryFn: () => fetchPublicEventBySlug(slug),
    enabled: modules.events_enabled,
  });
  const eventId = eventQ.data?.id ?? null;

  // Nagłówek strony w JEDNYM wywołaniu (event_page_header). To jedyne źródło
  // trybu i przepływu zapisów: kolumny `registration_mode`,
  // `registration_flow` i `external_registration_url` NIE SĄ w allowliście
  // kolumnowej z migracji 20260803191905, więc zapytanie tabelaryczne o nie
  // kończy się odmową uprawnień. Klucz zawiera użytkownika, bo RPC
  // personalizuje odpowiedź (`my_*`, `tier_locked`, `chatham_house_locked`).
  const headerQ = useQuery({
    queryKey: ["event-page-header", slug, user?.id ?? "anon"],
    queryFn: () => fetchEventPageHeader(slug),
    enabled: modules.events_enabled,
  });

  // Sekcje treści strony: kolejność, nadpisane nagłówki i ZAMKI liczy baza
  // (`event_sections`). Bez tego przełączniki sekcji w panelu organizatora
  // byłyby ozdobą, a bramka gościa (`events.guest_mode`) nie miałaby jak
  // zadziałać na froncie.
  const sectionsQ = useEventSections(slug, modules.events_enabled);

  // Własny RSVP (RLS: "rsvps owner read" - widzę tylko swój wiersz).
  const rsvpQ = useQuery({
    queryKey: ["event-rsvp", eventId, user?.id],
    queryFn: async () => {
      if (!eventId || !user) return null;
      const { data } = await supabase
        .from("event_rsvps")
        .select("id, status")
        .eq("event_id", eventId)
        .eq("user_id", user.id)
        .maybeSingle();
      return data as { id: string; status: RsvpStatus } | null;
    },
    enabled: !!eventId && !!user,
  });

  // Serwerowa ocena dostępu: linki + powód odmowy (auth/tier/rsvp).
  const accessQ = useQuery({
    queryKey: ["event-access", eventId, user?.id ?? "anon"],
    queryFn: () => fetchEventAccess(eventId!),
    enabled: !!eventId,
  });

  const countsQ = useQuery({
    queryKey: ["event-rsvp-counts", eventId],
    queryFn: () => fetchEventRsvpCounts([eventId!]),
    enabled: !!eventId,
  });

  const { seats: liveSeats } = useEventSeatsRealtime(eventId ?? undefined);

  const tiersQ = useMembershipTiers();
  const currentTierQ = useCurrentTier();

  // Pozycja FIFO na liście rezerwowej (wiersze RSVP są owner-only; liczby
  // ponad własny wiersz wyłącznie przez RPC).
  const waitlistPosQ = useQuery({
    queryKey: ["event-waitlist-position", eventId, user?.id],
    queryFn: () => fetchEventWaitlistPosition(eventId!),
    enabled: !!eventId && !!user && rsvpQ.data?.status === "waitlist",
  });

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["event-page-header", slug, user?.id ?? "anon"] });
    void qc.invalidateQueries({ queryKey: ["event-rsvp", eventId, user?.id] });
    void qc.invalidateQueries({ queryKey: ["event-access", eventId, user?.id ?? "anon"] });
    void qc.invalidateQueries({ queryKey: ["event-rsvp-counts", eventId] });
    void qc.invalidateQueries({ queryKey: ["event-waitlist-position", eventId, user?.id] });
    // Zapis czyni z gościa uczestnika, a to OTWIERA sekcje zamknięte regułą
    // `registered` - bez tego program pojawiłby się dopiero po odświeżeniu.
    void qc.invalidateQueries({ queryKey: publicEventKeys.sections(slug, user?.id ?? "anon") });
  };

  // Potwierdzenie mailowe bezpłatnego RSVP - serwer sam weryfikuje status,
  // więc wywołanie jest bezpieczne i całkowicie fail-soft (mail nie może
  // zepsuć samego zapisu na wydarzenie).
  const sendRsvpEmail = useServerFn(confirmFreeRsvpEmail);

  const rsvpM = useMutation({
    mutationFn: async (target: RsvpRequestStatus) => {
      if (!eventQ.data || !user) throw new Error("no user");
      // Ponowne kliknięcie tego samego statusu = cancel (poza samym 'cancelled').
      // Klik w aktywną listę rezerwową ponawia 'going' - to celowo idempotentne:
      // jeśli w międzyczasie zwolniło się miejsce, serwer po prostu potwierdzi
      // 'going' zamiast przypadkiem wypisać z kolejki.
      // Migracja 20260713200000 cofa granty INSERT/UPDATE/DELETE na event_rsvps -
      // jedyną ścieżką zapisu jest RPC rsvp_event (limit miejsc, kolejka FIFO,
      // bramka warstwy, egzekwowanie flagi pro_briefings).
      const nextStatus: RsvpRequestStatus =
        rsvpQ.data?.status === target && target !== "cancelled" ? "cancelled" : target;
      return rsvpEvent(eventQ.data.id, nextStatus);
    },
    onSuccess: (result) => {
      invalidate();
      if (result.status === "waitlist") {
        toast.success(
          result.waitlist_position !== null
            ? t("community.events.toastWaitlist", { position: result.waitlist_position })
            : t("community.events.toastWaitlistNoPosition"),
        );
        return;
      }
      if (result.status === "going" && eventQ.data) {
        void sendRsvpEmail({ data: { eventId: eventQ.data.id } }).catch(() => {
          /* mail jest dodatkiem - brak potwierdzenia nie unieważnia RSVP */
        });
      }
      const key =
        result.status === "going"
          ? "community.events.toastGoing"
          : result.status === "interested"
            ? "community.events.toastInterested"
            : "community.events.toastCancelled";
      toast.success(t(key));
    },
    onError: (e: unknown) => {
      // DRUGA LINIA OBRONY. Po przebudowie bloku zapisów odmowy trybu
      // (`registration disabled` / `external` / `form required` /
      // `approval required`) są z interfejsu NIEOSIĄGALNE - kontrolka wołająca
      // rsvp_event powstaje tylko wtedy, gdy reguła mówi, że wywołanie ma
      // szansę przejść. Mapowanie zostaje dla jednego realnego scenariusza:
      // uczestnik z otwartą kartą w chwili, gdy organizator zmienia tryb
      // w panelu. Jego przycisk pochodzi z migawki, która przestała być prawdą,
      // i ma dostać zdanie prawdziwe, a nie generyczny błąd.
      // Słownik i kolejność dopasowań (Chatham House PRZED członkostwem, bo
      // pierwszy komunikat zawiera drugi) żyją w lib/events/registrationSurface.
      const msg = e instanceof Error ? e.message : "";
      toast.error(t(rsvpRefusalMessageKey(msg)));
    },
  });

  // Bramkę modułu, wczytywanie i „nie znaleziono” rozstrzyga POWŁOKA
  // (`events.$slug.tsx`) - `<Outlet />` nie renderuje się, dopóki wydarzenia
  // nie ma. Ten warunek domyka wyłącznie TYP; drugi ekran ładowania w tym
  // miejscu mrugałby pod paskiem zakładek, który już stoi.
  if (!eventQ.data) return null;

  const ev = eventQ.data;
  const title = lang === "en" ? ev.title_en || ev.title_pl : ev.title_pl || ev.title_en;
  const desc = lang === "en" ? ev.description_en : ev.description_pl;
  const startsAt = new Date(ev.starts_at);
  const isPast = startsAt.getTime() < Date.now();
  // Wydarzenie płatne: bezpłatny RSVP jest wtedy wyłączony - wejściówkę
  // potwierdza dopiero webhook po opłaceniu biletu.
  const ticketCents = ev.ticket_price_cents ?? 0;
  const isPaidEvent = ticketCents > 0;
  const access = accessQ.data ?? null;
  const counts = countsQ.data?.get(ev.id);
  const going = counts?.going ?? 0;
  const waitlistCount = counts?.waitlist ?? 0;
  // Stan miejsc: autorytatywnie z backendu (realtime), z fallbackiem na liczby
  // z listy, gdy odczyt jeszcze trwa.
  const seatsLeft =
    liveSeats?.seatsLeft ?? (ev.capacity !== null ? Math.max(0, ev.capacity - going) : null);
  const isFull = liveSeats?.isFull ?? (seatsLeft !== null && seatsLeft === 0);
  const isWaitlisted = rsvpQ.data?.status === "waitlist";
  const isProBriefing = ev.kind === "briefing" && ev.visibility === "members";
  const membersOnly = ev.visibility === "members";

  // Nazwa wymaganej warstwy: najniższy aktywny tier o randze >= progu
  // (members podnosi próg do >=1; briefing Pro wskazuje tier z pro_briefings).
  const requiredTierName = (() => {
    const tiers = tiersQ.data ?? [];
    if (isProBriefing) {
      const withFlag = tiers.find(
        (tier) =>
          tier.features &&
          typeof tier.features === "object" &&
          !Array.isArray(tier.features) &&
          (tier.features as Record<string, unknown>).pro_briefings === true,
      );
      return withFlag ? tierName(withFlag, lang) : null;
    }
    if (!membersOnly && ev.min_tier_rank <= 0) return null;
    const minRank = membersOnly ? Math.max(ev.min_tier_rank, 1) : ev.min_tier_rank;
    const match = [...tiers].sort((a, b) => a.rank - b.rank).find((tier) => tier.rank >= minRank);
    return match ? tierName(match, lang) : null;
  })();

  const tierBlocked = access?.reason === "tier_required";

  // Najniższa warstwa z benefitem nagrań (flaga features.recordings) - do
  // czytelnego upsellu przy bramce nagrania.
  const recordingTierName = (() => {
    const tiers = tiersQ.data ?? [];
    const match = [...tiers]
      .sort((a, b) => a.rank - b.rank)
      .find((tier) => tierHasFeature(tier.features, "recordings"));
    return match ? tierName(match, lang) : null;
  })();

  // Okno rejestracji: data otwarcia (do zdania "zapisy otwierają się ...")
  // i plakietka wcześniejszego dostępu dla członków o randze >= early_rsvp_rank.
  // O tym, CZY pokazać kontrolkę, nie decyduje już ten rachunek - decyduje
  // `registration_state` z nagłówka, który sam uwzględnia early_rsvp_rank.
  // Tutaj zostaje wyłącznie to, czego nagłówek NIE ODDAJE: `early_rsvp_rank`.
  const rsvpOpensAt = ev.rsvp_opens_at ? new Date(ev.rsvp_opens_at) : null;
  const rsvpBeforeOpen = !!rsvpOpensAt && rsvpOpensAt.getTime() > Date.now();
  const earlyRank = ev.early_rsvp_rank ?? null;
  const myRank = currentTierQ.data?.rank ?? 0;
  const hasEarlyAccess = earlyRank !== null && myRank >= earlyRank;
  // STREFA WYDARZENIA, NIE PRZEGLĄDARKI. Godzina otwarcia zapisów stoi na tym
  // samym ekranie, co termin wydarzenia liczony przez `formatEventDateTime`
  // (:714). Liczenie jej przez `toLocaleString` dawało dwie różne strefy w
  // dwóch kartach jednej strony - uczestnik w innej strefie czytał jedną z nich
  // jako swoją. Etykieta strefy jedzie obok, bo sama godzina w obcej strefie
  // jest gorsza niż brak godziny (ten sam argument stoi w bramce EB-912).
  const whenOpens =
    ev.rsvp_opens_at === null || ev.rsvp_opens_at === undefined
      ? ""
      : formatEventDateTime(ev.rsvp_opens_at, ev.timezone, lang);

  // ── POWIERZCHNIA ZAPISÓW ────────────────────────────────────────────────
  // JEDNA decyzja z reguły czystej. Trasa nie składa już własnych warunków
  // z kolumn wydarzenia: dokładnie ten rachunek rysował wcześniej przycisk
  // zapisu na wydarzeniu w trybie `form`, czyli kontrolkę prowadzącą w ścianę.
  const header = headerQ.data ?? null;
  const surface =
    header === null
      ? null
      : resolveRegistrationSurface({
          registrationMode: header.registration_mode,
          registrationFlow: header.registration_flow,
          registrationState: header.registration_state,
          externalRegistrationUrl: header.external_registration_url,
          seatsLeft: header.seats_left,
          myRegistrationStatus: header.my_registration_status,
          myRsvpStatus: header.my_rsvp_status,
          // Dwie żywe ścieżki zapisu = dwa źródła pozycji w kolejce. Nagłówek
          // liczy kolejkę `event_registrations` (etap 4), a legacy kolejkę
          // `event_rsvps` - RPC get_event_waitlist_position. Bierzemy tę, która
          // odpowiada ścieżce, na której uczestnik naprawdę stoi.
          myWaitlistPosition: header.my_waitlist_position ?? waitlistPosQ.data ?? null,
          tierLocked: header.tier_locked,
          chathamHouseLocked: header.chatham_house_locked,
          hasEnded: header.has_ended,
          isSignedIn: !!user,
        });

  // Wariant -> kształt kontrolki. Molekuła nie dostaje ani jednego klucza i18n:
  // napis składa się tutaj, a mapowanie kształtu żyje przy molekule, żeby test
  // komponentu przechodził tą samą ścieżką co ta trasa.
  const surfaceAction =
    surface === null
      ? null
      : eventRegistrationActionFrom(
          surface.control,
          surface.control === null ? "" : t(surface.control.labelKey),
          rsvpM.isPending,
        );

  const surfaceQueuePosition = surface === null ? null : waitlistPositionOf(surface);

  // Zamek sekcji prelegentów rozstrzyga się w trasie, bo to trasa trzyma
  // komponent tej sekcji (razem z jego własnym nagłówkiem).
  const speakersSection = findEventSection(sectionsQ.data ?? [], "speakers");
  const descriptionSection = findEventSection(sectionsQ.data ?? [], "description");

  // Informacje praktyczne: kolumny, które panel zapisywał, a uczestnik ich nie
  // widział - do czasu grantu kolumnowego z migracji 20260826120000. Kształt
  // jest wspólny dla sekcji `map` i `contact`; o tym, KTÓRA z nich pokazuje
  // co (i dlaczego to nie może być jedna karta), rozstrzyga
  // `lib/events/eventPractical`.
  const practical: EventPracticalInfo = {
    streetAddress: ev.street_address,
    postalCode: ev.postal_code,
    city: ev.city,
    region: ev.region,
    country: ev.country,
    languages: ev.languages,
    socialHashtag: ev.social_hashtag,
    supportEmail: ev.support_email,
  };

  // JSON-LD wydarzenia W TREŚCI, a nie w `head()`: ta trasa nie ma loadera,
  // więc `head()` nie zna wydarzenia i wysłałby węzeł bez nazwy i bez daty.
  // Skrypt w treści jest dla crawlera równoprawny, a wzorzec ma już precedens
  // w repozytorium (`FaqBlockView`, `ReviewBlockView`). `safeJsonLd` zamyka
  // ucieczkę przez `</script>` w danych z bazy.
  //
  // STOI NA PRZEGLĄDZIE, A NIE W POWŁOCE, żeby pięć zakładek nie wysłało
  // pięciu razy tego samego węzła `Event` pod pięcioma adresami.
  const eventLd = publicEventJsonLd({
    origin: splitUrl(getRequestUrl() || `/events/${slug}`).origin,
    lang,
    event: {
      slug: ev.slug,
      name: title,
      startDate: ev.starts_at,
      endDate: ev.ends_at,
      kind: ev.kind,
      location: ev.location,
      image: ev.cover_url,
      description: desc,
      streetAddress: ev.street_address,
      postalCode: ev.postal_code,
      city: ev.city,
      region: ev.region,
      country: ev.country,
    },
  });

  const onSurfaceAction = () => {
    if (surface === null || surface.control === null) return;
    // Kolejka rezerwowa NIE jest osobnym żądaniem: klient wysyła `going`,
    // a rsvp_event sam degraduje wynik do `waitlist` pod blokadą wiersza.
    if (surface.control.action === "cancel") rsvpM.mutate("cancelled");
    else if (surface.control.action === "rsvp" || surface.control.action === "waitlist") {
      rsvpM.mutate("going");
    }
  };

  return (
    // SIATKĘ RYSUJE `EventOverviewLayout`, nie ten plik - ten sam komponent
    // rysuje ją w podglądzie studia. Dopóki trzy kolumny mieszkały tutaj,
    // podgląd miał je przepisane po swojemu (jedna kolumna `max-w-3xl`)
    // i właściciel widział w panelu „stary layout”. Proporcje 1:2:1, powody
    // kolejności w DOM-ie i to, czego z wzorca nie odwzorowujemy, są opisane
    // przy komponencie.
    <>
      {/* JSON-LD stoi POZA siatką: to nie jest treść żadnej z kolumn. */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJsonLd(eventLd) }}
      />

      <EventOverviewLayout
        main={
          <>
            {/* Nagłówek wideo ZASTĘPUJE baner okładki, a przy braku (albo błędnym)
              identyfikatorze sam rysuje okładkę - okładka pozostaje wymagana,
              bo to z niej bierze się miniatura w katalogu i w karcie
              społecznościowej (`events_video_header_requires_cover`). */}
            <EventVideoHeader
              title={title}
              coverUrl={ev.cover_url}
              videoPlatform={ev.video_header_platform}
              videoId={ev.video_header_id}
            />

            <div className="mt-4 flex flex-wrap items-center gap-2">
              {isProBriefing ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary">
                  <BadgeCheck className="h-3.5 w-3.5" aria-hidden="true" />
                  {t("community.events.proBriefing")}
                </span>
              ) : membersOnly ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary">
                  <Lock className="h-3.5 w-3.5" aria-hidden="true" />
                  {t("community.events.membersOnly")}
                </span>
              ) : null}
              {isFull && !isPast && (
                <span className="rounded-full bg-destructive/10 px-2.5 py-0.5 text-xs font-medium text-destructive">
                  {t("community.events.capacityFull")}
                </span>
              )}
              {!isPast && rsvpBeforeOpen && earlyRank !== null && (
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2.5 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-400">
                  <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                  {t("community.events.earlyForMembers")}
                </span>
              )}
            </div>

            <EventOverviewTitle>{title}</EventOverviewTitle>

            {descriptionSection === null ? null : descriptionSection.isLocked ? (
              <section id="event-description" className="mt-8 scroll-mt-24">
                <h2 className="text-lg font-semibold tracking-tight text-foreground">
                  {t(sectionHeadingKey("description"))}
                </h2>
                <div className="mt-4">
                  <SectionLockCard
                    reason={descriptionSection.lockReason}
                    sectionKey="description"
                    eventSlug={slug}
                  />
                </div>
              </section>
            ) : desc ? (
              <EventOverviewDescription>{desc}</EventOverviewDescription>
            ) : null}

            {/* SPIS PODSTRON W TREŚCI - na wzorcu (zrzut 38) stoi w kolumnie
              środkowej, pod banerem i nad poziomami partnerów. To NIE jest ta
              sama nawigacja, co pasek zakładek w powłoce: pasek jest chrome'em
              i jest na każdej zakładce, ten spis jest treścią strony głównej.
              Trzeciej kopii tych samych odnośników tu nie ma - `EventMenuNav`
              i `EventHomeSectionLinks` WYKLUCZAJĄ SIĘ.

              O TYM, KTÓRY Z NICH, DECYDUJE ORGANIZATOR (`pages_display_mode`),
              bo inaczej jego przełącznik przestałby cokolwiek rozstrzygać na
              publicznej stronie. Oba czytają DOKŁADNIE TEN SAM `event_menu`
              (jeden hook, jeden klucz cache, jeden filtr widoczności po grupach
              w bazie), więc wybór trybu zmienia WYGLĄD spisu, a nie to, do
              których podstron czytelnik ma dojście. */}
            {ev.pages_display_mode === "grid" ? (
              <EventMenuNav slug={slug} displayMode={ev.pages_display_mode} />
            ) : (
              <EventHomeSectionLinks slug={slug} />
            )}

            {/* Poziomy partnerów: sam rząd logotypów pod spisem sekcji - dokładnie
              jak na wzorcu. Pełne kafle z nazwą, opisem i plakietkami rysuje
              sekcja „Partnerzy” niżej (`EventPageSections`); oba widoki jadą
              z jednego klucza zapytania, więc to nie są dwa pobrania. */}
            <EventSponsorTiers slug={slug} />

            {/* Prelegenci wydarzenia: event_speakers + profil prelegenta/eksperta
              (RPC get_public_speakers); klik otwiera dialog profilu prelegenta.
              Sekcja ma własny nagłówek, więc zamek rozstrzyga się tutaj, a nie
              w `EventPageSections` - inaczej strona miałaby dwa nagłówki
              „Prelegenci" jeden pod drugim. */}
            {speakersSection === null ? null : speakersSection.isLocked ? (
              <section className="mt-10 scroll-mt-24" id="event-speakers">
                <h2 className="text-lg font-semibold tracking-tight text-foreground">
                  {t(sectionHeadingKey("speakers"))}
                </h2>
                <div className="mt-4">
                  <SectionLockCard
                    reason={speakersSection.lockReason}
                    sectionKey="speakers"
                    eventSlug={slug}
                  />
                </div>
              </section>
            ) : (
              <EventSpeakersSection eventId={ev.id} lang={lang} />
            )}

            {/* Program, partnerzy, materiały, dojazd i kontakt - w kolejności
              i z zamkami z bazy. Dwie ostatnie sekcje biorą treść z kolumn
              wydarzenia, więc jadą tu jako `practical`, a nie osobnym zapytaniem. */}
            <EventPageSections slug={slug} sections={sectionsQ.data ?? []} practical={practical} />

            {/* Wydarzenie jako iskra: host/staff zakłada trwały krąg czatu dla
              uczestników 'going' (komponent sam znika dla pozostałych). */}
            <EventGroupButton
              eventId={ev.id}
              hostUserId={ev.host_user_id}
              eventStatus={ev.status}
            />
          </>
        }
        right={
          <>
            {tierBlocked && (
              <div className="rounded-lg border border-primary/40 bg-primary/5 p-5">
                <p className="text-sm font-medium">
                  {requiredTierName
                    ? t("community.events.tierRequired", { tier: requiredTierName })
                    : t("community.events.tierRequiredGeneric")}
                </p>
                <Button asChild className="mt-3" size="sm">
                  <Link to="/pricing">{t("community.events.tierUpgradeCta")}</Link>
                </Button>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-3">
              {!isPast && access?.can_join && access.join_url && (
                <Button asChild variant="secondary">
                  <a href={access.join_url} target="_blank" rel="noreferrer">
                    <Video className="mr-2 h-4 w-4" aria-hidden="true" />
                    {t("community.events.joinLive")}
                  </a>
                </Button>
              )}
              {/* Wydarzenie PŁATNE: wejściówki są własną powierzchnią (płatność,
                webhook, przydział z planu), więc zastępują kontrolkę bezpłatnego
                zapisu - ale WYŁĄCZNIE wtedy, gdy reguła mówi, że ta kontrolka
                w ogóle mogłaby się udać. Przy trybie `form`, `external`, `none`
                i przy przepływie `approval` uczestnik dostaje zdanie reguły,
                a nie przycisk zakupu prowadzący w tę samą ścianę. */}
              {surface === null ? null : isPaidEvent && isLegacyRsvpDecision(surface) ? (
                <EventTicketPurchase
                  eventId={ev.id}
                  slug={ev.slug}
                  priceCents={ticketCents}
                  currency={ev.ticket_currency || "PLN"}
                  lang={lang}
                  hasTicket={rsvpQ.data?.status === "going"}
                  isPast={isPast}
                  isFull={isFull}
                  onClaimed={invalidate}
                />
              ) : (
                <EventRegistrationSurface
                  message={t(surface.messageKey, { date: whenOpens })}
                  note={
                    surfaceQueuePosition === null
                      ? null
                      : t("eventFront.waitlistPosition", { position: surfaceQueuePosition })
                  }
                  action={surfaceAction}
                  onAction={onSurfaceAction}
                  groupLabel={t("eventFront.sections.registration.heading")}
                  eventSlug={ev.slug}
                />
              )}
              {/* Sygnał zainteresowania jest OSOBNĄ decyzją, nie odmianą zapisu:
                bramka trybu z 20260823136000 obejmuje wyłącznie `going`, więc
                „zainteresowany" przechodzi także na wydarzeniu z formularzem czy
                z rejestracją zewnętrzną. Blokują go tylko bramki wspólne dla
                wszystkich statusów (warstwa, Chatham House, okno) - rozstrzyga to
                canSignalInterest, żeby i ten przycisk nie prowadził w ścianę. */}
              {user && surface !== null && canSignalInterest(surface) && (
                <Button
                  variant={rsvpQ.data?.status === "interested" ? "default" : "outline"}
                  onClick={() => rsvpM.mutate("interested")}
                  disabled={rsvpM.isPending}
                  aria-pressed={rsvpQ.data?.status === "interested"}
                >
                  <Star className="mr-2 h-4 w-4" aria-hidden="true" />
                  {t("community.events.rsvpInterested")}
                </Button>
              )}
              {!isPast && <AddToCalendar event={ev} lang={lang} />}
              <EventTicketCard
                eventId={ev.id}
                lang={lang}
                enabled={!!user && rsvpQ.data?.status === "going"}
              />
            </div>

            {!isPast && user && rsvpBeforeOpen && hasEarlyAccess && (
              <p className="text-sm text-amber-700 dark:text-amber-400" aria-live="polite">
                {t("community.events.rsvpEarlyAccessOpen", { when: whenOpens })}
              </p>
            )}
            {/* Zostaje TYLKO 'interested'. Zdania o zapisie i o liście rezerwowej
              niesie teraz wariant reguły (EventRegistrationSurface) - dublowanie ich
              tutaj dawało dwa zdania o tym samym, liczone z dwóch różnych chwil
              w czasie. 'interested' reguła świadomie pomija: sygnał
              zainteresowania nie jest zapisem, więc nie odbiera przycisku zapisu. */}
            {!isPast && user && rsvpQ.data?.status === "interested" && (
              <p className="text-sm text-primary animate-fade-in" aria-live="polite">
                {t("community.events.rsvpStatusInterested")}
              </p>
            )}
            {/* Kolejka rezerwowa nie daje wejściówki - link do transmisji pojawia
              się dopiero po awansie na 'going' (rozstrzyga get_event_access). */}
            {!isPast && isWaitlisted && access?.reason === "waitlisted" && (
              <p className="text-sm text-muted-foreground">
                {t("community.events.joinWaitlisted")}
              </p>
            )}

            {/* Nagranie po wydarzeniu: benefit warstwy (flaga recordings) - URL
              nie opuszcza bazy bez uprawnienia, tu tylko czytelny upsell. */}
            {isPast && !tierBlocked && access && access.watch_reason !== "none" && (
              <section className="rounded-lg border border-border bg-card p-5">
                <h2 className="flex items-center gap-2 text-base font-semibold">
                  <Video className="h-4 w-4" aria-hidden="true" />
                  {t("community.events.recordingGateTitle")}
                </h2>
                {access.can_watch && access.recording_url ? (
                  <Button asChild variant="secondary" className="mt-3">
                    <a href={access.recording_url} target="_blank" rel="noreferrer">
                      <Video className="mr-2 h-4 w-4" aria-hidden="true" />
                      {t("community.events.watchRecording")}
                    </a>
                  </Button>
                ) : access.watch_reason === "auth_required" ? (
                  <p className="mt-2 text-sm text-muted-foreground">
                    {t("community.events.recordingSignInHint")}
                  </p>
                ) : (
                  <>
                    <p className="mt-2 text-sm text-muted-foreground">
                      {recordingTierName
                        ? t("community.events.recordingTierRequired", { tier: recordingTierName })
                        : t("community.events.recordingTierRequiredGeneric")}
                    </p>
                    <Button asChild size="sm" className="mt-3">
                      <Link to="/pricing">{t("community.events.tierUpgradeCta")}</Link>
                    </Button>
                  </>
                )}
              </section>
            )}
          </>
        }
        left={
          <>
            {/* Zapamiętanie wydarzenia. Stan gwiazdki jedzie z nagłówka
              (`is_bookmarked`), więc nie ma tu drugiego zapytania ani drugiej
              chwili w czasie. */}
            <EventBookmarkButton eventSlug={slug} isBookmarked={header?.is_bookmarked === true} />

            <EventMetaCard>
              <EventMetaRow
                icon={<Calendar className="h-4 w-4" />}
                label={t("community.events.whenLabel")}
              >
                {/* Godzina w STREFIE WYDARZENIA, a nie w strefie przegladarki.
                  Poprzednia wersja formatowala date lokalnie i doklejala surowy
                  identyfikator IANA w nawiasie - uczestnik z Brukseli widzial
                  godzine warszawska opisana jako warszawska i musial ja przeliczyc
                  sam. Wspolny formater zyje w lib/events/timezone.ts. */}
                {formatEventDateTime(ev.starts_at, ev.timezone, lang)}
                {ev.timezone ? ` (${eventTimeZoneLabel(ev.starts_at, ev.timezone, lang)})` : null}
              </EventMetaRow>
              {ev.location && (
                <EventMetaRow
                  icon={<MapPin className="h-4 w-4" />}
                  label={t("community.events.location")}
                >
                  {ev.location}
                </EventMetaRow>
              )}
              {ev.capacity !== null && (
                <EventMetaRow
                  icon={<Users className="h-4 w-4" />}
                  label={t("community.events.capacityLabel")}
                >
                  {isFull
                    ? t("community.events.capacityFull")
                    : t("community.events.capacityLeft", { count: seatsLeft ?? 0 })}
                  {" · "}
                  {t("community.events.goingCount", { count: going })}
                  {waitlistCount > 0 && (
                    <>
                      {" · "}
                      {t("community.events.waitlistCount", { count: waitlistCount })}
                    </>
                  )}
                </EventMetaRow>
              )}
              {isPaidEvent && (
                // Etykieta idzie ze słownika (`eventFront.header.priceLabel`),
                // a nie z rozgałęzienia po języku w kodzie - to był jedyny taki
                // ternary na tej stronie i znika razem z podziałem pliku.
                <EventMetaRow
                  icon={<Ticket className="h-4 w-4" />}
                  label={t("eventFront.header.priceLabel")}
                >
                  {formatMoney(ticketCents, ev.ticket_currency || "PLN", lang)}
                </EventMetaRow>
              )}
              {ev.chatham_house && (
                <EventMetaRow icon={<ShieldQuestion className="h-4 w-4" />} label="">
                  {t("community.events.chathamHouse")}
                </EventMetaRow>
              )}
            </EventMetaCard>
          </>
        }
      />
    </>
  );
}
