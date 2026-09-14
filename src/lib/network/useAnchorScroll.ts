// Przewinięcie do wiersza wskazanego fragmentem adresu - wspólne dla KAŻDEJ
// powierzchni, która renderuje kotwice z `anchors.ts`.
//
// PO CO HOOK, A NIE EFEKT W TRASIE. Pierwsza wersja tej naprawy siedziała
// w `profile.index.tsx` i wołała `resolveAnchorId` w JEDNEJ klatce animacji po
// zmianie zakładki. Przegląd (Codex, PR #361) słusznie wskazał, że to nie
// wystarcza, i ma rację w trzech osobnych punktach:
//
//   1. ZIMNE WEJŚCIE. `useProfileEditor` renderuje najpierw stan ładowania,
//      a trzy zapytania o wprowadzenia są asynchroniczne - w chwili tej jednej
//      klatki wiersza NIE MA JESZCZE w DOM. Pojedyncza próba trafiała więc
//      w pustkę dokładnie w najczęstszym przypadku: kliknięciu powiadomienia
//      z zimnego startu.
//   2. DRUGIE POWIADOMIENIE O TĘ SAMĄ ZAKŁADKĘ. Efekt zależał od `tab`, a ten
//      się nie zmienia, gdy kolejny link celuje w już otwartą zakładkę - więc
//      zmiana samego fragmentu nie uruchamiała niczego.
//   3. REKOMENDACJE MIESZKAJĄ GDZIE INDZIEJ. Ich powiadomienia prowadzą na
//      `/author/<ref>#r-<id>-<status>` (20260812101000:200, :216), a nie na
//      `/profile`. Efekt wpięty w trasę profilu nie obsługiwał ich w ogóle,
//      a `router.tsx:87` ustawia `defaultHashScrollIntoView: false`, więc nie
//      robił tego też router. Kotwica istniała w DOM i dalej nikt do niej nie
//      skakał - czyli połowa naprawy, dokładnie ta sama klasa błędu, którą ta
//      zmiana miała zamknąć.
//
// Stąd: OKNO PONAWIANIA zamiast jednej próby, nasłuch `hashchange` i hook,
// który wpina się tam, gdzie renderują się wiersze.
//
// DLACZEGO RAZ NA FRAGMENT. Bez `scrolledFor` każde odświeżenie danych
// (refetch listy, powrót do zakładki) szarpałoby widok z powrotem na kotwicę,
// walcząc z użytkownikiem, który właśnie przewinął gdzie indziej.
import { useEffect, useRef } from "react";
import { smoothScrollToAnchor } from "@/lib/smoothAnchorScroll";
import { resolveAnchorId } from "./anchors";

/**
 * Jak długo czekamy na wiersz. Cztery sekundy to zapas na zimne wejście
 * (sesja + profil + RPC listy), a nie na dowolnie wolną sieć: po tym czasie
 * przestajemy, bo skok do treści, na którą użytkownik już nie patrzy, jest
 * gorszy niż jego brak.
 */
const RETRY_WINDOW_MS = 4_000;
const RETRY_INTERVAL_MS = 100;

/**
 * @param ready Dowolna wartość zmieniająca się, gdy wiersze mogły się pojawić
 *   (np. dane zapytania, aktywna zakładka). Zmiana NATYCHMIAST ponawia próbę,
 *   zamiast czekać na kolejny takt okna.
 */
export function useAnchorScroll(ready?: unknown): void {
  const scrolledFor = useRef<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined" || typeof document === "undefined") return;

    let cancelled = false;
    let timer = 0;

    const attempt = (deadline: number): void => {
      if (cancelled) return;
      const hash = window.location.hash;
      if (!hash || scrolledFor.current === hash) return;

      const id = resolveAnchorId(hash, document);
      if (id !== null) {
        scrolledFor.current = hash;
        smoothScrollToAnchor(id);
        return;
      }
      if (Date.now() >= deadline) return;
      timer = window.setTimeout(() => attempt(deadline), RETRY_INTERVAL_MS);
    };

    const start = (): void => {
      window.clearTimeout(timer);
      attempt(Date.now() + RETRY_WINDOW_MS);
    };

    start();

    // Zmiana samego fragmentu (drugie powiadomienie o tę samą zakładkę) nie
    // przemontowuje komponentu ani nie rusza `ready` - bez tego nasłuchu
    // byłaby niewidzialna.
    const onHashChange = (): void => {
      scrolledFor.current = null;
      start();
    };
    window.addEventListener("hashchange", onHashChange);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      window.removeEventListener("hashchange", onHashChange);
    };
  }, [ready]);
}
