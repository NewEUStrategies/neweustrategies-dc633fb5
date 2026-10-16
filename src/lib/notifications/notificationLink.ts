// Predykaty odnośnika powiadomienia - JEDNO źródło prawdy dla dzwonka,
// skrzynki i warstwy profili aktorów.
//
// PO CO WYDZIELENIE. Te trzy funkcje żyły w TRZECH kopiach: dwie w komponentach
// (`NotificationsBell.tsx`, `NotificationsCenter.tsx`) i jedna w
// `useActorProfiles.ts`. Wszystkie na zerze pokrycia, bo jedynym sposobem ich
// wywołania było wyrenderowanie 858-linijkowego organizmu skrzynki. Kopia
// w komponencie nie jest tylko duplikatem - jest funkcją NIEOSIĄGALNĄ dla
// testu jednostkowego, więc reguła bezpieczeństwa („co jest linkiem
// wewnętrznym") stała bez ani jednej asercji w całym module.
//
// Zachowanie jest identyczne z każdą z usuniętych kopii - to przeniesienie,
// nie zmiana.
import type { MouseEvent as ReactMouseEvent } from "react";

/**
 * Tab i znaki nowej linii - parser URL (WHATWG) wycina je z KAŻDEGO miejsca
 * adresu, zanim zacznie go czytać.
 */
const URL_STRIPPED_CHARS = /[\t\n\r]/g;

/**
 * Czy href prowadzi do TEJ aplikacji.
 *
 * `//evil.example` jest w HTML adresem zewnętrznym (protocol-relative), a przy
 * naiwnym `startsWith("/")` przeszedłby jako wewnętrzny i trafił do
 * `router.navigate({ href })` - czyli treść z bazy sterowałaby nawigacją SPA
 * na obcy host. Stąd drugi warunek; on jest tu regułą bezpieczeństwa, nie
 * kosmetyką. Ta sama reguła obejmuje dwa zapisy, które przeglądarka czyta
 * jak `//`: odwrotny ukośnik (`/\evil.example` - dla schematów http(s) `\`
 * znaczy `/`) i tab/nową linię między ukośnikami (`/\t/evil.example`), więc
 * sprawdzamy adres po tej samej normalizacji, którą zrobi parser.
 */
export function isInternalHref(href: string): boolean {
  const normalized = href.replace(URL_STRIPPED_CHARS, "");
  return normalized.startsWith("/") && normalized[1] !== "/" && normalized[1] !== "\\";
}

/**
 * Niemodyfikowany klik lewym przyciskiem - JEDYNY przypadek, który przechwytujemy
 * na nawigację SPA. Klik z modyfikatorem (ctrl/cmd/shift/alt, środkowy przycisk)
 * zostawiamy natywnemu zachowaniu kotwicy, żeby „otwórz w nowej karcie" działało;
 * prawdziwy atrybut `href` jest tam warunkiem sensu.
 */
export function isPlainLeftClick(e: ReactMouseEvent<HTMLAnchorElement>): boolean {
  return (
    !e.defaultPrevented && e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey
  );
}

/**
 * Id rozmówcy z odnośnika powiadomienia (`/messages?c=<uuid>`), albo null.
 *
 * Adresy zewnętrzne odrzucamy PRZED parsowaniem - profil aktora czytamy
 * wyłącznie dla własnych tras. Dla ścieżki wewnętrznej wystarczy query string
 * (do `#`): `URLSearchParams` dekoduje go tak samo jak `URL#searchParams`, ale
 * nie potrzebuje bazy i nie ma czym rzucić, więc odczyt nie może wywrócić
 * renderu dzwonka.
 */
export function notificationActorId(href: string | null | undefined): string | null {
  if (!href || !isInternalHref(href)) return null;
  const [path] = href.replace(URL_STRIPPED_CHARS, "").split("#", 1);
  const queryAt = path.indexOf("?");
  return queryAt === -1 ? null : new URLSearchParams(path.slice(queryAt + 1)).get("c");
}
