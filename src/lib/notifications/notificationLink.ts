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
 * Czy href prowadzi do TEJ aplikacji.
 *
 * `//evil.example` jest w HTML adresem zewnętrznym (protocol-relative), a przy
 * naiwnym `startsWith("/")` przeszedłby jako wewnętrzny i trafił do
 * `router.navigate({ href })` - czyli treść z bazy sterowałaby nawigacją SPA
 * na obcy host. Stąd drugi warunek; on jest tu regułą bezpieczeństwa, nie
 * kosmetyką.
 */
export function isInternalHref(href: string): boolean {
  return href.startsWith("/") && !href.startsWith("//");
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
 * Baza `https://local.invalid` jest świadoma: `new URL()` wymaga bazy dla
 * ścieżki względnej, a host, który NIGDY nie istnieje (RFC 6761 sek. 6.4),
 * gwarantuje, że nawet gdyby ten URL kiedyś wyciekł do żądania, nie da się go
 * rozwiązać. Adresy zewnętrzne odrzucamy PRZED parsowaniem - profil aktora
 * czytamy wyłącznie dla własnych tras.
 */
export function notificationActorId(href: string | null | undefined): string | null {
  if (!href || !isInternalHref(href)) return null;
  try {
    return new URL(href, "https://local.invalid").searchParams.get("c");
  } catch {
    return null;
  }
}
