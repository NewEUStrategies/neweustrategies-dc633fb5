// Autozapis szkicu tematu w localStorage.
//
// BLAD, KTORY TO NAPRAWIA. Kompozytor przyjmuje do 20 000 znakow i stoi na
// WLASNEJ trasie, wiec traci sie go tak samo latwo jak kazda inna strone:
// omylkowe "wstecz", klikniety odnosnik w naglowku, odswiezenie po utracie
// sieci, zamkniecie karty na telefonie przy przelaczaniu aplikacji. Do tej pory
// kazde z tych zdarzen kasowalo cala prace bez sladu - a to jest powierzchnia,
// na ktorej ludzie pisza najdluzsze teksty w calym serwisie.
//
// DLACZEGO localStorage, A NIE BAZA. Szkic nie jest tresc do wspoldzielenia:
// nie ma go czytac nikt inny, nie ma go widziec moderacja, nie ma go byc
// w eksporcie RODO jako "wypowiedz". Tabela szkicow oznaczalaby nowy byt
// z wlasnym cyklem zycia, RLS i sprzataniem - koszt nieproporcjonalny do
// problemu "nie zgub tego, co wpisano w formularz".
//
// KLUCZ JEST PER KLUB, nie globalny: dwa kluby to dwa rozne rozpoczete teksty,
// a wspolny klucz kazalby jednemu nadpisac drugi. Nie jest za to per GRUPA -
// zmiana dzialu w trakcie pisania jest normalnym ruchem i nie moze gubic tresci.
//
// SZKIC WYGASA. Tydzien to gorna granica sensownego "wroce do tego" - starszy
// wpis czesciej dezorientuje ("skad to sie tu wzielo?"), niz pomaga. Wygasly
// szkic jest kasowany przy odczycie, nie przez osobny job.
import { useCallback, useEffect, useRef, useState } from "react";

const PREFIX = "nes.club.threadDraft.";
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
/** Zapisujemy po ciszy w pisaniu, nie po kazdym znaku. */
const DEBOUNCE_MS = 600;

export interface ThreadDraft {
  title: string;
  body: string;
  savedAt: number;
}

function keyFor(clubId: string): string {
  return `${PREFIX}${clubId}`;
}

/**
 * Odczyt jest defensywny na trzy sposoby: brak `localStorage` (SSR, tryb
 * prywatny w starszych przegladarkach), nieparsowalna zawartosc (recznie
 * zmieniony wpis, kolizja z inna wersja formatu) i wpis przeterminowany.
 * Kazdy z nich konczy sie `null`, a nie wyjatkiem w renderze.
 */
function readDraft(clubId: string): ThreadDraft | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(keyFor(clubId));
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const title = "title" in parsed && typeof parsed.title === "string" ? parsed.title : "";
    const body = "body" in parsed && typeof parsed.body === "string" ? parsed.body : "";
    const savedAt = "savedAt" in parsed && typeof parsed.savedAt === "number" ? parsed.savedAt : 0;
    if (title.trim() === "" && body.trim() === "") return null;
    if (savedAt <= 0 || Date.now() - savedAt > MAX_AGE_MS) {
      window.localStorage.removeItem(keyFor(clubId));
      return null;
    }
    return { title, body, savedAt };
  } catch {
    return null;
  }
}

export interface ThreadDraftHandle {
  /** Szkic zastany przy wejsciu na formularz (`null` = nie bylo czego wznawiac). */
  restored: ThreadDraft | null;
  /** Znacznik ostatniego zapisu - interfejs pokazuje "zapisano o ...". */
  savedAt: number | null;
  /** Odrzucenie szkicu: czysci pamiec i chowa pasek wznowienia. */
  discard: () => void;
  /** Publikacja sie udala - szkic nie ma juz czego chronic. */
  clear: () => void;
}

/**
 * Zapisuje `{title, body}` po `DEBOUNCE_MS` ciszy i zwraca szkic zastany przy
 * MONTOWANIU (odczytany raz, w inicjalizatorze `useState`) - odczyt przy kazdym
 * renderze nadpisywalby to, co uzytkownik wlasnie pisze.
 */
export function useThreadDraft(
  clubId: string | undefined,
  title: string,
  body: string,
): ThreadDraftHandle {
  const [restored, setRestored] = useState<ThreadDraft | null>(() =>
    clubId === undefined ? null : readDraft(clubId),
  );
  const [savedAt, setSavedAt] = useState<number | null>(null);
  // `cleared` przezywa zmiany propsow: po udanej publikacji efekt nie moze
  // zapisac szkicu z pol, ktore dopiero za chwile wyczysci nawigacja.
  const cleared = useRef(false);

  // Klub rozwiazuje sie asynchronicznie (najpierw slug, potem karta), wiec
  // szkic czasem trzeba doczytac PO pierwszym renderze - ale tylko raz i tylko
  // gdy formularz jest jeszcze pusty.
  const bootstrapped = useRef(false);
  useEffect(() => {
    if (clubId === undefined || bootstrapped.current) return;
    bootstrapped.current = true;
    if (title.trim() !== "" || body.trim() !== "") return;
    setRestored(readDraft(clubId));
  }, [clubId, title, body]);

  useEffect(() => {
    if (clubId === undefined || cleared.current) return;
    if (typeof window === "undefined") return;
    const empty = title.trim() === "" && body.trim() === "";
    const timer = window.setTimeout(() => {
      // Sprawdzenie MUSI być też tutaj, nie tylko przy planowaniu. `clear()`
      // po udanej publikacji przychodzi typowo w środku odliczania - timer
      // zaplanowany, gdy flaga była jeszcze fałszywa, i tak by wystrzelił
      // i zapisał tekst, który przed chwilą trafił do bazy.
      if (cleared.current) return;
      try {
        if (empty) {
          window.localStorage.removeItem(keyFor(clubId));
          setSavedAt(null);
          return;
        }
        const stamp = Date.now();
        window.localStorage.setItem(
          keyFor(clubId),
          JSON.stringify({ title, body, savedAt: stamp }),
        );
        setSavedAt(stamp);
      } catch {
        // Brak miejsca albo zablokowany magazyn - autozapis jest wygoda,
        // nie kontraktem; cisza jest tu lepsza niz komunikat o bledzie
        // przy KAZDYM nacisnieciu klawisza.
      }
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [clubId, title, body]);

  const forget = useCallback(() => {
    if (clubId === undefined || typeof window === "undefined") return;
    try {
      window.localStorage.removeItem(keyFor(clubId));
    } catch {
      // jw.
    }
  }, [clubId]);

  const discard = useCallback(() => {
    forget();
    setRestored(null);
    setSavedAt(null);
  }, [forget]);

  const clear = useCallback(() => {
    cleared.current = true;
    forget();
    setRestored(null);
    setSavedAt(null);
  }, [forget]);

  return { restored, savedAt, discard, clear };
}
