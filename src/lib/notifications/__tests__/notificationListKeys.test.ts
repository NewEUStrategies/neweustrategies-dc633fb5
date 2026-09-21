// Rozpoznawanie kluczy cache LISTY powiadomień - warunek poprawności KAŻDEJ
// optymistycznej aktualizacji w skrzynce.
//
// PO CO TEN PLIK JEST NAJWAŻNIEJSZY W PACZCE. `NOTIFICATION_LIST_FILTERS`
// wchodzi do `qc.getQueriesData(...)` w `NotificationsCenter`, a wynik idzie
// prosto na `cached.pages.map(...)` w `onMutate`. Predykat, który wpuści wpis
// o INNYM kształcie niż `InfiniteData`, nie powoduje „niepotrzebnej roboty" -
// powoduje `TypeError: Cannot read properties of undefined (reading 'map')`
// wewnątrz `onMutate`, a React Query traktuje wyjątek z `onMutate` jako
// przerwanie mutacji: `mutationFn` NIGDY nie leci do serwera. Efekt dla
// użytkownika: kliknięcie „oznacz jako przeczytane" nic nie robi, cicho.
//
// Prefiks `["notifications"]` obejmuje CZTERY rodziny wpisów - trzy z nich nie
// są listą wierszy. Ten plik przypina, którą z nich predykat rozpoznaje.
import { describe, expect, it } from "vitest";
import {
  isNotificationListQuery,
  listKeyIsOnlyUnread,
  NOTIFICATION_LIST_FILTERS,
  NOTIFICATIONS_QUERY_PREFIX,
  type QueryKeyCarrier,
} from "../notificationListKeys";

const UID = "11111111-2222-4333-8444-555555555555";

/** Opakowanie klucza w kształt, jakiego oczekuje predykat React Query. */
function carrier(queryKey: readonly unknown[]): QueryKeyCarrier {
  return { queryKey };
}

/** Klucz LISTY - dokładnie taki, jaki buduje `listKey` w `useNotifications`. */
const listKey = (over: Record<string, unknown> = {}): readonly unknown[] => [
  NOTIFICATIONS_QUERY_PREFIX,
  UID,
  { onlyUnread: false, kind: null, pageSize: 25, ...over },
];

/** Klucz profili aktorów - `useActorProfiles.ts`, trzeci element to TABLICA. */
const actorProfilesKey: readonly unknown[] = [
  NOTIFICATIONS_QUERY_PREFIX,
  "actor-profiles",
  ["actor-a", "actor-b"],
];

describe("isNotificationListQuery - rozpoznanie listy", () => {
  it("rozpoznaje klucz listy (uid + obiekt filtra)", () => {
    expect(isNotificationListQuery(carrier(listKey()))).toBe(true);
  });

  it("rozpoznaje listę niezależnie od wartości filtra", () => {
    expect(isNotificationListQuery(carrier(listKey({ onlyUnread: true })))).toBe(true);
    expect(isNotificationListQuery(carrier(listKey({ kind: "message" })))).toBe(true);
    expect(isNotificationListQuery(carrier(listKey({ pageSize: 5 })))).toBe(true);
  });

  it("rozpoznaje listę gościa (uid zastąpiony napisem `anon`)", () => {
    // `listKey(undefined, …)` podstawia "anon" - to nadal LISTA i nadal
    // wymaga łatania, więc predykat nie może patrzeć na kształt UUID-a.
    expect(
      isNotificationListQuery(carrier([NOTIFICATIONS_QUERY_PREFIX, "anon", { onlyUnread: true }])),
    ).toBe(true);
  });
});

describe("isNotificationListQuery - odrzucenia", () => {
  it("ODRZUCA klucz preferencji (trzeci element to napis)", () => {
    // `["notifications", "preferences", uid]` trzyma OBIEKT preferencji, nie
    // `InfiniteData`. Wpuszczenie go kończy się `undefined.map` w `onMutate`.
    expect(isNotificationListQuery(carrier([NOTIFICATIONS_QUERY_PREFIX, "preferences", UID]))).toBe(
      false,
    );
  });

  it("ODRZUCA klucz licznika nieprzeczytanych (trzeci element to napis)", () => {
    expect(
      isNotificationListQuery(carrier([NOTIFICATIONS_QUERY_PREFIX, "unread-count", UID])),
    ).toBe(false);
  });

  it("odrzuca klucz spoza prefiksu powiadomień", () => {
    expect(isNotificationListQuery(carrier(["network", UID, { onlyUnread: true }]))).toBe(false);
  });

  it("odrzuca klucz o innej DŁUGOŚCI niż trzy elementy", () => {
    expect(isNotificationListQuery(carrier([NOTIFICATIONS_QUERY_PREFIX]))).toBe(false);
    expect(isNotificationListQuery(carrier([NOTIFICATIONS_QUERY_PREFIX, UID]))).toBe(false);
    expect(isNotificationListQuery(carrier([NOTIFICATIONS_QUERY_PREFIX, UID, {}, "extra"]))).toBe(
      false,
    );
  });

  it("odrzuca `null` na pozycji filtra (typeof null === 'object')", () => {
    // Klasyczna pułapka JS: bez jawnego `!== null` ten klucz przeszedłby.
    expect(isNotificationListQuery(carrier([NOTIFICATIONS_QUERY_PREFIX, UID, null]))).toBe(false);
  });

  it("odrzuca liczbę i wartość undefined na pozycji filtra", () => {
    expect(isNotificationListQuery(carrier([NOTIFICATIONS_QUERY_PREFIX, UID, 25]))).toBe(false);
    expect(isNotificationListQuery(carrier([NOTIFICATIONS_QUERY_PREFIX, UID, undefined]))).toBe(
      false,
    );
  });

  // DEFEKT PRZYPIĘTY. Klucz profili aktorów ma DOKŁADNIE trzy elementy, a jego
  // trzeci element to TABLICA - więc `typeof key[2] === "object" && key[2] !==
  // null` jest PRAWDĄ i predykat kwalifikuje go jako listę wierszy.
  //
  // Co jest złamane: profil aktora nie jest listą wierszy powiadomień.
  // `patchNotificationLists` w `NotificationsCenter` wchodzi na
  // `cached.pages.map(...)`, a dane pod tym kluczem to PŁASKA TABLICA profili -
  // `pages` jest `undefined`, więc `onMutate` rzuca `TypeError`, a mutacja
  // oznaczania jako przeczytane NIGDY nie dobiega do serwera.
  //
  // Oczekiwany kontrakt: `isNotificationListQuery` zwraca `false` dla
  // `["notifications", "actor-profiles", string[]]` - np. przez wymaganie, by
  // trzeci element NIE był tablicą i miał kształt filtra (obecne
  // `onlyUnread`/`kind`/`pageSize`), albo przez odsunięcie profili aktorów pod
  // własny prefiks cache.
  it.fails("ODRZUCA klucz profili aktorów - tablica NIE jest filtrem listy", () => {
    expect(isNotificationListQuery(carrier(actorProfilesKey))).toBe(false);
  });

  it("Array.isArray ODRÓŻNIA oba kształty - proponowany kontrakt jest wykonalny", () => {
    // Dowód wykonalności dla poprawki opisanej wyżej: te dwa trzecie elementy
    // są nierozróżnialne dla `typeof`, ale w pełni rozróżnialne dla
    // `Array.isArray`. Poprawka nie wymaga zmiany kształtu żadnego klucza.
    const filterSlot = listKey()[2];
    const profilesSlot = actorProfilesKey[2];
    expect(typeof filterSlot).toBe("object");
    expect(typeof profilesSlot).toBe("object");
    expect(Array.isArray(filterSlot)).toBe(false);
    expect(Array.isArray(profilesSlot)).toBe(true);
  });
});

describe("NOTIFICATION_LIST_FILTERS", () => {
  it("celuje w prefiks powiadomień i zawęża go TYM predykatem", () => {
    // Sam `queryKey: ["notifications"]` bez predykatu objąłby preferencje,
    // licznik i profile - filtr jest parą, a nie samym prefiksem.
    expect(NOTIFICATION_LIST_FILTERS.queryKey).toEqual([NOTIFICATIONS_QUERY_PREFIX]);
    expect(NOTIFICATION_LIST_FILTERS.predicate).toBe(isNotificationListQuery);
  });
});

describe("listKeyIsOnlyUnread", () => {
  it("true dla filtra `{ onlyUnread: true }`", () => {
    // Na zakładce „Nieprzeczytane" oznaczony wiersz ma z listy ZNIKNĄĆ,
    // a nie tylko zmienić stan - od tej odpowiedzi zależy kształt łatki.
    expect(listKeyIsOnlyUnread(listKey({ onlyUnread: true }))).toBe(true);
  });

  it("false dla filtra `{ onlyUnread: false }`", () => {
    expect(listKeyIsOnlyUnread(listKey({ onlyUnread: false }))).toBe(false);
  });

  it("false, gdy pola `onlyUnread` w filtrze W OGÓLE nie ma", () => {
    expect(listKeyIsOnlyUnread([NOTIFICATIONS_QUERY_PREFIX, UID, { kind: null }])).toBe(false);
  });

  it("false dla `null` na pozycji filtra", () => {
    expect(listKeyIsOnlyUnread([NOTIFICATIONS_QUERY_PREFIX, UID, null])).toBe(false);
  });

  it("false dla napisu na pozycji filtra (klucz preferencji / licznika)", () => {
    expect(listKeyIsOnlyUnread([NOTIFICATIONS_QUERY_PREFIX, "unread-count", UID])).toBe(false);
  });

  it("false dla wartości PRAWDZIWEJ, ale nie `true` - porównanie jest ŚCISŁE", () => {
    // `=== true` zamiast truthiness jest tu celowe: filtr trafia do klucza
    // przez `normalizeFilter`, więc każda inna wartość znaczy „klucz spoza
    // naszego kontraktu", a nie „nieprzeczytane". Zamiana na truthiness
    // sprawiłaby, że przypadkowa `1` zaczęłaby USUWAĆ wiersze z listy.
    expect(listKeyIsOnlyUnread([NOTIFICATIONS_QUERY_PREFIX, UID, { onlyUnread: 1 }])).toBe(false);
    expect(listKeyIsOnlyUnread([NOTIFICATIONS_QUERY_PREFIX, UID, { onlyUnread: "true" }])).toBe(
      false,
    );
  });

  it("false dla krótkiego klucza bez pozycji filtra", () => {
    expect(listKeyIsOnlyUnread([NOTIFICATIONS_QUERY_PREFIX])).toBe(false);
  });
});
