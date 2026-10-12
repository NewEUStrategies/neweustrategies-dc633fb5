// Organizm: PUBLICZNY program wydarzenia - DANE i ZAPIS na sesję.
//
// RYSUNEK NIE STOI TUTAJ. Kompaktową tablicę programu (kolumna pomocnicza,
// zakładki dni, filtr nurtu, bloki sesji rozdzielone linią) rysuje
// `EventAgendaBoardView`, bo TEN SAM rysunek musi pokazać podgląd studia, który
// nie może wołać `event_agenda` (bramka `status = 'published'`) ani nieść
// żywego zapisu na sesję. Dwa niezależne rysunki tego samego programu już raz
// kosztowały właściciela „stary layout w studiu”.
//
// TEN PLIK WNOSI WYŁĄCZNIE ŹRÓDŁO I AKCJĘ. Zapytanie `event_agenda` liczy w tej
// samej chwili zajętość, mój zapis i `access_state`; mutacja zapisu unieważnia
// to zapytanie, zamiast zgadywać liczby miejsc lokalnie.
//
// PUSTY PROGRAM NIE RYSUJE OBUDOWY. Bez ani jednej sesji nie ma czego szukać
// ani co filtrować, więc zostaje jedno zdanie pod nagłówkiem, który należy do
// `EventPageSections`.
//
// OKNA PROFILU TYLKO NA ZAKŁADCE. `profiles` (podaje trasa `/agenda`) owija
// tablicę w `EventDirectoryProvider`: wiersz prelegenta i znaczek partnera
// otwierają okno, a klik w sesję w oknie odsłania jej blok na tablicy.
// Przegląd wydarzenia rysuje ten sam organizm BEZ tej flagi - bez dostawcy,
// bez zapytań katalogu i bez przycisków, więc wygląda jak dotąd. Dostawca stoi
// tutaj, a nie w trasie, bo bramka parytetu podglądu (`eventPreviewPublicParity`)
// pilnuje, żeby trasy nie składały własnych kawałków strony.
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { Skeleton } from "@/components/ui/skeleton";
import { uiLang } from "@/lib/i18n/format";
import { useAuth } from "@/hooks/useAuth";
import { agendaSessionAnchor, type AgendaSession } from "@/lib/events/agendaSurface";
import { useEventAgenda, useSessionSignup } from "@/lib/events/usePublicEvent";
import { usePublicEventDirectory } from "@/lib/events/usePublicEventDirectory";
import { publicEventErrorMessage } from "@/lib/events/publicEventErrors";
import {
  EventAgendaBoardView,
  type AgendaRevealRequest,
} from "@/components/events/public/organisms/EventAgendaBoardView";
import { EventDirectoryProvider } from "@/components/events/public/directory/EventDirectoryContext";
import { ensureI18n as ensureEventFrontI18n } from "@/lib/i18n-event-front";

ensureEventFrontI18n();

/** Kotwica bloku sesji w adresie - `#event-session-<id>` (wiersze sesji w oknach innych zakładek). */
const SESSION_HASH_PREFIX = `#${agendaSessionAnchor("")}`;

export function EventAgendaSection({
  slug,
  enabled = true,
  profiles = false,
}: {
  slug: string;
  enabled?: boolean;
  /** Okna profilu osoby i instytucji - wyłącznie zakładka „Agenda" (patrz nagłówek). */
  profiles?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const lang = uiLang(i18n.language);
  const { user } = useAuth();
  const signedIn = user !== null;

  const agendaQuery = useEventAgenda(slug, enabled);
  // `mutate` z TanStack Query jest stabilny, a obiekt mutacji - nie (nowy przy
  // każdej zmianie stanu), więc uchwyty niżej zależą od samej funkcji.
  const { mutate, isPending: signupPending } = useSessionSignup(slug);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [revealRequest, setRevealRequest] = useState<AgendaRevealRequest | null>(null);

  const sessions = agendaQuery.data ?? [];

  // STABILNE UCHWYTY ZAPISU. Karta sesji jest `memo` - nowa strzałka przy
  // każdym renderze (np. gdy zmienia się `pendingId`) przerysowywałaby każdy
  // blok dnia zamiast jednego, którego zapis jest w locie.
  const runSignup = useCallback(
    (session: AgendaSession, status: "registered" | "cancelled") => {
      if (!signedIn) {
        toast.info(t("eventFront.agenda.actions.signIn"));
        return;
      }
      setPendingId(session.id);
      mutate(
        { sessionId: session.id, status },
        {
          onSuccess: (result) => {
            setPendingId(null);
            if (result.status === "registered")
              toast.success(t("eventFront.agenda.toasts.registered"));
            else if (result.status === "waitlist")
              toast.success(t("eventFront.agenda.toasts.waitlist"));
            else toast.success(t("eventFront.agenda.toasts.cancelled"));
            if (result.promoted) toast.info(t("eventFront.agenda.toasts.promoted"));
          },
          onError: (error) => {
            setPendingId(null);
            toast.error(publicEventErrorMessage(error));
          },
        },
      );
    },
    [signedIn, t, mutate],
  );
  const onSignup = useCallback(
    (session: AgendaSession) => runSignup(session, "registered"),
    [runSignup],
  );
  const onCancel = useCallback(
    (session: AgendaSession) => runSignup(session, "cancelled"),
    [runSignup],
  );

  // Licznik w prośbie: ta sama sesja wybrana drugi raz (po przewinięciu gdzie
  // indziej) to NOWA prośba, którą tablica ma obsłużyć.
  const requestReveal = useCallback((sessionId: string) => {
    setRevealRequest((current) => ({ sessionId, nonce: (current?.nonce ?? 0) + 1 }));
  }, []);

  // ODNOŚNIK Z INNEJ ZAKŁADKI. Wiersz sesji w oknie profilu na „Prelegentach"
  // czy „Uczestnikach" prowadzi tu z kotwicą `#event-session-<id>`. Sesja
  // z innego dnia nie istnieje w DOM, dopóki tablica nie przełączy zakładki
  // dnia - sama kotwica przeglądarki trafiałaby więc w próżnię. Czytamy ją
  // po załadowaniu programu (efekt: na serwerze adresu z kotwicą nie ma).
  // Identyfikator sesji to uuid wpisany w kotwicę wprost - bez dekodowania,
  // które na zniekształconym adresie rzuciłoby wyjątek w efekcie.
  // Prośba idzie dopiero do tablicy NARYSOWANEJ: tablica uznaje prośbę zastaną
  // przy montażu za obsłużoną, a zapytanie w stanie błędu trzyma dane z pamięci
  // (`isError` przy niepustym `sessions`) i rysuje komunikat zamiast tablicy.
  const boardShown = sessions.length > 0 && !agendaQuery.isError;
  useEffect(() => {
    if (!profiles || !boardShown) return;
    const hash = window.location.hash;
    if (!hash.startsWith(SESSION_HASH_PREFIX)) return;
    requestReveal(hash.slice(SESSION_HASH_PREFIX.length));
  }, [profiles, boardShown, requestReveal]);

  if (agendaQuery.isPending) {
    return (
      <div className="space-y-3" aria-busy="true" aria-label={t("eventFront.agenda.loading")}>
        <Skeleton className="h-9 w-56" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  if (agendaQuery.isError) {
    return (
      <p className="rounded-[6px] border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
        {publicEventErrorMessage(agendaQuery.error)}
      </p>
    );
  }

  if (sessions.length === 0) {
    return <p className="text-sm text-muted-foreground">{t("eventFront.sections.agenda.empty")}</p>;
  }

  const board = (
    <EventAgendaBoardView
      sessions={sessions}
      lang={lang}
      signedIn={signedIn}
      pendingId={signupPending ? pendingId : null}
      onSignup={onSignup}
      onCancel={onCancel}
      revealRequest={revealRequest}
    />
  );

  return (
    <div className="space-y-4">
      {profiles ? (
        <AgendaProfiles slug={slug} lang={lang} sessions={sessions} onSessionSelect={requestReveal}>
          {board}
        </AgendaProfiles>
      ) : (
        board
      )}

      {signupPending && pendingId === null && (
        <p className="inline-flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          {t("eventFront.agenda.actions.working")}
        </p>
      )}
    </div>
  );
}

/**
 * Dostawca okien profilu nad tablicą programu.
 *
 * PROGRAM JEST WŁASNYM ŹRÓDŁEM KATALOGU. Zakładka ma już `event_agenda`
 * (z zapisami wołającego), więc katalog nie pyta o program drugi raz;
 * prelegentów (biogram, instytucja) i partnerów (opis, strona) dociąga
 * dopiero pierwszy sygnał zamiaru - najechanie albo fokus na wierszu osoby
 * czy znaczku partnera (`onActivate`). Samo wejście na zakładkę nie kosztuje
 * ani jednego dodatkowego wywołania RPC.
 *
 * KLIK W STRONĘ PARTNERA Z OKNA NIE JEST LICZONY (`sponsorPlacement` pusty).
 * Raport sponsora przyjmuje z miejsc agendy wyłącznie wyświetlenia
 * (`sponsorExposure.ts`), a podpisanie kliknięcia inną zakładką fałszowałoby
 * raport, z którego partner rozlicza wydarzenie.
 */
function AgendaProfiles({
  slug,
  lang,
  sessions,
  onSessionSelect,
  children,
}: {
  slug: string;
  lang: "pl" | "en";
  sessions: readonly AgendaSession[];
  onSessionSelect: (sessionId: string) => void;
  children: ReactNode;
}) {
  const [enrich, setEnrich] = useState(false);
  // Stały uchwyt: dostawca liczy z niego `prime`, a nowy `prime` to nowa
  // wartość kontekstu - przerysowanie każdego wyzwalacza na tablicy.
  const activate = useCallback(() => setEnrich(true), []);
  const { directory, eventId } = usePublicEventDirectory({
    slug,
    lang,
    enrich,
    own: { sessions },
  });
  return (
    <EventDirectoryProvider
      directory={directory}
      slug={slug}
      eventId={eventId}
      onSessionSelect={onSessionSelect}
      onActivate={activate}
    >
      {children}
    </EventDirectoryProvider>
  );
}
