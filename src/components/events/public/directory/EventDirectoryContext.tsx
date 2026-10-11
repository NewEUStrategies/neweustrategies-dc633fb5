// OKNA PROFILU NA ZAKŁADKACH MODUŁOWYCH - dostawca i wyzwalacze.
//
// JEDNO OKNO NA ZAKŁADKĘ, NIE OKNO NA KARTĘ. Dostawca trzyma stos widoków
// (osoba -> jej instytucja -> inna osoba z tej instytucji…) i rysuje jeden
// dialog. Karta prosi tylko o otwarcie widoku - nie wie, skąd okno weźmie
// fakty, bo bierze je z katalogu (`lib/events/eventDirectory.ts`), który
// zakładka złożyła ze wszystkiego, co ma w pamięci.
//
// DIALOG DOJEŻDŻA DOPIERO PRZY PIERWSZYM KLIKNIĘCIU (`lazy`). Zakładka
// publiczna płaci w chunku tylko za ten plik: kontekst i dwa przyciski.
// Widoki z materiałami prelegenta, akcjami spotkań i siecią społecznościową
// są w osobnym chunku, który pobiera klik - koszt ponosi ten, kto okno otwiera.
// Raz pobrany dialog ZOSTAJE zamontowany, bo animacja zamknięcia potrzebuje
// węzła, który jeszcze istnieje.
//
// BEZ DOSTAWCY WYZWALACZ JEST ZWYKŁYM TEKSTEM. Ten sam organizm (agenda,
// lista partnerów) stoi też na stronie głównej wydarzenia, gdzie okien nie ma -
// przycisk, który niczego nie otwiera, byłby atrapą.
import {
  createContext,
  lazy,
  Suspense,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import type { EventDirectory } from "@/lib/events/eventDirectory";
import type { SponsorPlacement } from "@/lib/events/sponsorExposure";
import { cn } from "@/lib/utils";

const EventDirectoryDialog = lazy(() =>
  import("./EventDirectoryDialog").then((module) => ({ default: module.EventDirectoryDialog })),
);

/** Widok na stosie okna: osoba po kluczu katalogu albo instytucja po kluczu nazwy. */
export type DirectoryView =
  | { kind: "person"; key: string }
  | { kind: "company"; key: string; name?: string; logoUrl?: string | null };

export interface EventDirectoryApi {
  directory: EventDirectory;
  /**
   * Sygnał zamiaru (najechanie, fokus): pobiera chunk okna i budzi źródła
   * wzbogacające, zanim padnie klik - okno otwiera się wtedy pełne.
   */
  prime: () => void;
  openPerson: (idOrKey: string) => void;
  openCompany: (key: string, seed?: { name?: string; logoUrl?: string | null }) => void;
}

const EventDirectoryContext = createContext<EventDirectoryApi | null>(null);

/** Uchwyt okien albo `null` poza zakładką modułową (strona główna, widget). */
export function useEventDirectory(): EventDirectoryApi | null {
  return useContext(EventDirectoryContext);
}

export interface EventDirectoryProviderProps {
  directory: EventDirectory;
  /** Slug wydarzenia - akcje spotkań i odnośniki do agendy. `null` w podglądzie. */
  slug: string | null;
  /** Identyfikator wydarzenia - materiały prelegenta. */
  eventId: string | null;
  /**
   * FAŁSZ = podgląd studia: odnośniki wychodzące (pełny profil, strona
   * instytucji, agenda) rysują się jako tekst - klik wyprowadziłby redaktora
   * ze studia i zgubił niezapisany szkic (zasada `PreviewNavItem`).
   */
  live?: boolean;
  /** Miejsce pomiaru kliknięcia w stronę partnera (raport sponsora). */
  sponsorPlacement?: SponsorPlacement | null;
  /** Agenda: klik w sesję zamyka okno i odsłania blok sesji na liście. */
  onSessionSelect?: (sessionId: string) => void;
  /** Pierwsze otwarcie - zakładka może wtedy dociągnąć źródła wzbogacające. */
  onActivate?: () => void;
  children: ReactNode;
}

export function EventDirectoryProvider({
  directory,
  slug,
  eventId,
  live = true,
  sponsorPlacement = null,
  onSessionSelect,
  onActivate,
  children,
}: EventDirectoryProviderProps) {
  const [stack, setStack] = useState<DirectoryView[]>([]);
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  // Refy, nie stan ani zależności: uchwyt okien (`api`) ma być STAŁY, bo czyta
  // go każda karta listy - zmiana tożsamości przy otwarciu okna przerysowałaby
  // kilkaset kart. `onActivate` w funkcji aktualizującej stan poszłoby
  // dodatkowo dwa razy w trybie ścisłym Reacta.
  const activated = useRef(false);
  const openRef = useRef(false);
  const onActivateRef = useRef(onActivate);
  useEffect(() => {
    onActivateRef.current = onActivate;
  }, [onActivate]);

  const changeOpen = useCallback((next: boolean) => {
    openRef.current = next;
    setOpen(next);
  }, []);

  const prime = useCallback(() => {
    if (activated.current) return;
    activated.current = true;
    setLoaded(true);
    onActivateRef.current?.();
  }, []);

  const show = useCallback(
    (view: DirectoryView) => {
      prime();
      // Klik z WEWNĄTRZ otwartego okna dokłada widok (powrót „Wstecz"),
      // klik z karty na stronie zaczyna stos od nowa.
      const insideDialog = openRef.current;
      setStack((current) => {
        if (!insideDialog) return [view];
        const top = current.at(-1);
        if (top !== undefined && top.kind === view.kind && top.key === view.key) return current;
        return [...current, view].slice(-8);
      });
      changeOpen(true);
    },
    [prime, changeOpen],
  );

  const api = useMemo<EventDirectoryApi>(
    () => ({
      directory,
      prime,
      openPerson: (idOrKey) => show({ kind: "person", key: idOrKey }),
      openCompany: (key, seed) => show({ kind: "company", key, ...seed }),
    }),
    [directory, prime, show],
  );

  return (
    <EventDirectoryContext.Provider value={api}>
      {children}
      {loaded ? (
        <Suspense fallback={null}>
          <EventDirectoryDialog
            open={open}
            onOpenChange={changeOpen}
            stack={stack}
            onBack={() => setStack((current) => current.slice(0, -1))}
            onNavigate={show}
            directory={directory}
            slug={slug}
            eventId={eventId}
            live={live}
            sponsorPlacement={sponsorPlacement}
            onSessionSelect={
              onSessionSelect === undefined
                ? undefined
                : (sessionId) => {
                    changeOpen(false);
                    onSessionSelect(sessionId);
                  }
            }
          />
        </Suspense>
      ) : null}
    </EventDirectoryContext.Provider>
  );
}

/**
 * Przycisk otwierający profil osoby - albo sam tekst bez dostawcy.
 *
 * `className` opisuje wygląd W OBU stanach, więc karta wygląda tak samo, gdy
 * okna nie ma (strona główna); przycisk dokłada tylko kursor i obrys skupienia.
 */
export function DirectoryPersonTrigger({
  personKey,
  label,
  className,
  children,
}: {
  personKey: string | null;
  /** Nazwa dostępna przycisku - musi nieść nazwisko (kilkanaście „Otwórz" to szum). */
  label: string;
  className?: string;
  children: ReactNode;
}) {
  const directory = useEventDirectory();
  if (directory === null || personKey === null) {
    return <span className={className}>{children}</span>;
  }
  return (
    <button
      type="button"
      aria-label={label}
      aria-haspopup="dialog"
      onPointerEnter={directory.prime}
      onFocus={directory.prime}
      onClick={() => directory.openPerson(personKey)}
      className={cn(DIRECTORY_TRIGGER_CLASS, className)}
    >
      {children}
    </button>
  );
}

/** Przycisk otwierający okno instytucji - albo sam tekst bez dostawcy. */
export function DirectoryCompanyTrigger({
  orgKey,
  name,
  logoUrl,
  label,
  className,
  children,
}: {
  orgKey: string | null;
  name: string;
  logoUrl?: string | null;
  label: string;
  className?: string;
  children: ReactNode;
}) {
  const directory = useEventDirectory();
  if (directory === null || orgKey === null) {
    return <span className={className}>{children}</span>;
  }
  return (
    <button
      type="button"
      aria-label={label}
      aria-haspopup="dialog"
      onPointerEnter={directory.prime}
      onFocus={directory.prime}
      onClick={() => directory.openCompany(orgKey, { name, logoUrl })}
      className={cn(DIRECTORY_TRIGGER_CLASS, className)}
    >
      {children}
    </button>
  );
}

/** Wspólny obrys skupienia wyzwalaczy - ten sam na każdej zakładce. */
export const DIRECTORY_TRIGGER_CLASS =
  "cursor-pointer text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";
