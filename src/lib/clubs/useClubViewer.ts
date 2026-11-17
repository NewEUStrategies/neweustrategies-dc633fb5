// Kim jest czytelnik klubu - w postaci, którą wolno rysować w dokumencie SSR.
//
// PO CO OSOBNY HOOK. Kilka powierzchni klubu (panele ludzi w szynie, tablica,
// eksperci, wyróżnienie, obecność w kalendarzu, polubienie wpisu) woła RPC,
// które są dla roli `anon` ZAMKNIĘTE (revoke w A32/A33 to decyzja produktowa,
// nie przeoczenie). Gość nie ma ich więc ani montować, ani pytać - a zarazem
// dokument SSR jest z konstrukcji anonimowy (sesja mieszka w localStorage),
// więc ta sama decyzja nie może podmienić HTML-u serwera w pierwszym renderze
// klienta. Leniwa trasa bywa hydratowana PO rozstrzygnięciu sesji - stąd
// `useHydrated()` przed sesją (AGENTS.md: hub klubu i klucze widza karty).
//
// TRZY STANY, NIE DWA:
//   * `unknown`  - przed hydratacją (serwer i pierwszy render klienta) albo
//                  gdy sesja jeszcze się rozstrzyga. Gość i członek wyglądają
//                  tu IDENTYCZNIE; wołający decyduje, czy rysuje szkielet
//                  (bez zapytania), czy nic.
//   * `guest`    - po hydratacji, sesja rozstrzygnięta i pusta.
//   * `signedIn` - po hydratacji, sesja jest. Nie czekamy na role: `signedIn`
//                  znaczy dokładnie to samo, co dotychczasowe
//                  `session !== null`, więc zalogowany widzi to, co widział.
//
// `loading` czytamy WYŁĄCZNIE wtedy, gdy rozstrzyga ono wynik (po hydratacji,
// bez sesji): rozruch gościa w `useAuth` rozsyła rozstrzygnięcie tylko tym
// konsumentom, którzy tę flagę przeczytali w renderze.
import { useHydrated } from "@tanstack/react-router";
import { useAuth } from "@/hooks/useAuth";

export type ClubViewer = "unknown" | "guest" | "signedIn";

export function useClubViewer(): ClubViewer {
  const auth = useAuth();
  const hydrated = useHydrated();
  if (!hydrated) return "unknown";
  if (auth.session !== null) return "signedIn";
  return auth.loading === true ? "unknown" : "guest";
}
