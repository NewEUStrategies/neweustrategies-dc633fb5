// Rozpoznawanie kluczy cache LISTY powiadomień - warunek poprawności każdej
// optymistycznej aktualizacji w skrzynce.
//
// PUŁAPKA, KTÓRĄ TEN MODUŁ NAZYWA. Prefiks `["notifications"]` NIE należy
// wyłącznie do list wierszy. Pod tym samym prefiksem żyją:
//
//   ["notifications", <uid>, { onlyUnread, kind, pageSize }]  <- LISTA (InfiniteData)
//   ["notifications", "preferences", <uid>]                   <- obiekt preferencji
//   ["notifications", "unread-count", <uid>]                  <- liczba
//   ["notifications", "actor-profiles", <string[]>]           <- tablica profili
//
// Optymistyczna łatka chodzi po `cached.pages`, więc trafienie w którykolwiek
// z trzech ostatnich kluczy to nie „niepotrzebna robota", tylko `TypeError` na
// `undefined.map` w `onMutate` - a to w React Query oznacza mutację, która
// nigdy nie dobiega do serwera.
//
// Predykat mieszka tutaj, a nie w komponencie, właśnie dlatego, że jest to
// reguła kształtu klucza, a nie fragment widoku: da się ją wywołać w teście
// jednostkowym bez renderowania skrzynki.

/** Minimalny kształt zapytania, jakiego potrzebuje predykat filtra React Query. */
export interface QueryKeyCarrier {
  queryKey: readonly unknown[];
}

/** Prefiks cache całej warstwy powiadomień (listy, preferencje, licznik, profile). */
export const NOTIFICATIONS_QUERY_PREFIX = "notifications" as const;

/**
 * Czy ten wpis cache trzyma LISTĘ wierszy powiadomień.
 *
 * Rozpoznanie po kształcie klucza: trzy elementy, a trzeci to obiekt filtra.
 */
export function isNotificationListQuery(query: QueryKeyCarrier): boolean {
  const key = query.queryKey;
  return (
    key[0] === NOTIFICATIONS_QUERY_PREFIX &&
    key.length === 3 &&
    typeof key[2] === "object" &&
    key[2] !== null
  );
}

/** Filtr React Query wybierający wyłącznie listy wierszy spod prefiksu. */
export const NOTIFICATION_LIST_FILTERS = {
  queryKey: [NOTIFICATIONS_QUERY_PREFIX],
  predicate: isNotificationListQuery,
} as const;

/**
 * Czy ten cache listy trzyma WYŁĄCZNIE nieprzeczytane (filtr `onlyUnread`)?
 *
 * Odpowiedź decyduje o kształcie łatki: na zakładce „Nieprzeczytane" oznaczony
 * wiersz ma z listy ZNIKNĄĆ, a na „Wszystkie" - tylko zmienić stan. Bez tego
 * rozróżnienia wiersz zostawał na liście nieprzeczytanych jako przeczytany,
 * czyli filtr kłamał do najbliższej inwalidacji.
 */
export function listKeyIsOnlyUnread(key: readonly unknown[]): boolean {
  const filter = key[2];
  return (
    typeof filter === "object" &&
    filter !== null &&
    "onlyUnread" in filter &&
    filter.onlyUnread === true
  );
}
