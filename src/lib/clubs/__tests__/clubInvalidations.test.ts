// CO uniewaznia KTORA mutacja klubu - regula produktowa, nie szczegol cache'u.
//
// DLACZEGO TO JEST TEST WART PISANIA. Zla lista kluczy nie wywala niczego:
// zapis idzie do bazy, mutacja konczy sie sukcesem, toast mowi „zapisano".
// Zepsuty jest tylko WIDOK - i to nie od razu, tylko do wygasniecia
// `staleTime`. Taki defekt wyglada jak „czasem trzeba odswiezyc stronę",
// wiec nie trafia do zgloszen i zyje kwartalami.
//
// Modul nosi slad dokladnie takiego defektu: karta klubu (`bySlug`) wisi POZA
// poddrzewem `club(clubId)`, bo mutacja pracuje na id, a widok czyta po slugu.
// Bez trzeciego klucza dolaczenie do klubu odswiezalo liste i czlonkostwa,
// a naglowek otwartego klubu dalej pokazywal stary licznik i przycisk
// „Dolacz".
//
// Testy sprawdzaja RELACJE miedzy kluczami (czy A jest prefiksem B), a nie
// tylko ich obecnosc - bo to prefiks decyduje o tym, co react-query naprawde
// uniewazni.
import { describe, expect, it, vi } from "vitest";
import type { QueryKey } from "@tanstack/react-query";
import { pendingCounterKeys } from "@/lib/counters/keys";
import { adminClubKeys, clubKeys } from "@/lib/clubs/queryKeys";
import {
  CLUB_STALE_MS,
  clubCardKeys,
  clubGroupsKeys,
  clubInvalidationsForTest,
  clubInvitationsKeys,
  clubInviteLinksKeys,
  clubMembershipKeys,
  clubMembershipsOnlyKeys,
  clubModerationKeys,
  clubOnlyKeys,
  clubReadKeys,
  clubSettingsKeys,
  clubTreeKeys,
  clubUpsertedKeys,
  feedReplyKeys,
  invalidateKeys,
  postCommentKeys,
  reactionKeys,
  replyEditedKeys,
  threadEditedKeys,
  threadReplyKeys,
  threadResolvedKeys,
  threadStanceKeys,
} from "@/lib/clubs/clubInvalidations";

const CLUB = "club-1";
const THREAD = "thread-1";
const SLUG = "temat-pierwszy";

/** Czy `prefix` jest PREFIKSEM `key` - tak react-query dopasowuje zapytania. */
function isPrefixOf(prefix: QueryKey, key: QueryKey): boolean {
  const p = prefix as readonly unknown[];
  const k = key as readonly unknown[];
  return p.length <= k.length && p.every((seg, i) => Object.is(seg, k[i]));
}

/** Czy zestaw kluczy uniewazni dane zapytanie (dowolnym prefiksem). */
function covers(keys: readonly QueryKey[], target: QueryKey): boolean {
  return keys.some((k) => isPrefixOf(k, target));
}

describe("clubCardKeys - trzy strony tej samej karty", () => {
  it("obejmuje poddrzewo klubu, katalog I odczyt po slugu", () => {
    const keys = clubCardKeys(CLUB);

    expect(keys).toEqual([clubKeys.club(CLUB), clubKeys.list(), clubKeys.bySlugAll()]);
  });

  it("REGRESJA: `bySlug` NIE jest podzbiorem `club(clubId)` - stad trzeci klucz", () => {
    // To jest cala przyczyna istnienia tej funkcji. Gdyby `bySlugAll()` bylo
    // prefiksowane przez `club(clubId)`, dwa pierwsze klucze wystarczylyby -
    // i wlasnie takie zalozenie zostawilo kiedys stary licznik w naglowku.
    expect(isPrefixOf(clubKeys.club(CLUB), clubKeys.bySlugAll())).toBe(false);
    expect(covers(clubCardKeys(CLUB), clubKeys.bySlug("dowolny-slug"))).toBe(true);
  });

  it("nie uniewaznia karty INNEGO klubu przez klucz `club`", () => {
    expect(isPrefixOf(clubKeys.club(CLUB), clubKeys.club("club-2"))).toBe(false);
  });
});

describe("skutki panelu", () => {
  it("zapis klubu odswieza liste panelu, poddrzewo klubu i katalog", () => {
    const keys = clubUpsertedKeys(CLUB);

    expect(covers(keys, adminClubKeys.all)).toBe(true);
    expect(covers(keys, clubKeys.club(CLUB))).toBe(true);
    expect(covers(keys, clubKeys.list())).toBe(true);
  });

  it("zmiana ustawien obejmuje dzialy i czlonkow klubu (przez poddrzewo)", () => {
    const keys = clubSettingsKeys(CLUB);

    // `groups` i `invitations` wisza POD `club(clubId)`, wiec jeden klucz
    // wystarcza - i to jest powod, dla ktorego wiekszosc mutacji panelu
    // uniewaznia korzen klubu zamiast wyliczac liste.
    expect(covers(keys, clubKeys.groups(CLUB))).toBe(true);
    expect(covers(keys, clubKeys.invitations(CLUB))).toBe(true);
    expect(covers(keys, adminClubKeys.all)).toBe(true);
  });

  it("sama kolejnosc dzialow NIE rusza katalogu (nie zmienia licznikow)", () => {
    const keys = clubGroupsKeys(CLUB);

    expect(covers(keys, clubKeys.groups(CLUB))).toBe(true);
    expect(covers(keys, clubKeys.list())).toBe(false);
  });

  it("ingerencja moderatorska siega KORZENIA modulu, nie tylko klubu", () => {
    const keys = clubModerationKeys(CLUB);

    // Redakcja cudzego wpisu zmienia liste tematow, dziennik moderacji
    // i widok watku - a te wisza w roznych poddrzewach.
    expect(covers(keys, clubKeys.all)).toBe(true);
    expect(covers(keys, clubKeys.searchAll())).toBe(true);
    expect(covers(keys, clubKeys.repliesAll(THREAD))).toBe(true);
  });

  it("skutek wewnatrzklubowy nie wychodzi poza poddrzewo klubu", () => {
    const keys = clubOnlyKeys(CLUB);

    expect(covers(keys, clubKeys.club(CLUB))).toBe(true);
    expect(covers(keys, clubKeys.list())).toBe(false);
    expect(covers(keys, clubKeys.memberships())).toBe(false);
  });
});

describe("skutki zaproszen i czlonkostwa", () => {
  it("zaproszenia i linki maja WLASNE, waskie klucze", () => {
    expect(clubInvitationsKeys(CLUB)).toEqual([clubKeys.invitations(CLUB)]);
    expect(clubInviteLinksKeys(CLUB)).toEqual([clubKeys.inviteLinks(CLUB)]);
    // Nie uniewazniaja siebie nawzajem - to dwie osobne listy w panelu.
    expect(covers(clubInvitationsKeys(CLUB), clubKeys.inviteLinks(CLUB))).toBe(false);
  });

  it("dolaczenie/wyjscie odswieza kartę klubu ORAZ liste czlonkostw", () => {
    const keys = clubMembershipKeys(CLUB);

    // Bez `memberships()` sekcja „Moje kluby" zostawala bez nowego wpisu,
    // mimo ze karta klubu juz pokazywala czlonkostwo.
    expect(covers(keys, clubKeys.memberships())).toBe(true);
    expect(covers(keys, clubKeys.bySlugAll())).toBe(true);
    expect(covers(keys, clubKeys.list())).toBe(true);
  });

  it("sama zmiana poziomu powiadomien rusza tylko czlonkostwa", () => {
    expect(clubMembershipsOnlyKeys()).toEqual([clubKeys.memberships()]);
  });

  it("odpowiedz na zaproszenie idzie od KORZENIA - trzy listy naraz", () => {
    const keys = clubTreeKeys();

    expect(covers(keys, clubKeys.list())).toBe(true);
    expect(covers(keys, clubKeys.memberships())).toBe(true);
    expect(covers(keys, clubKeys.invitations(CLUB))).toBe(true);
  });
});

describe("skutki w watku", () => {
  it("nowa odpowiedz odswieza odpowiedzi, karte watku I poddrzewo klubu", () => {
    const keys = threadReplyKeys(CLUB, SLUG, THREAD);

    // Licznik odpowiedzi jest projekcja listy tematow, wiec sama lista
    // odpowiedzi to za malo.
    expect(covers(keys, clubKeys.repliesAll(THREAD))).toBe(true);
    expect(covers(keys, clubKeys.thread(CLUB, SLUG))).toBe(true);
    expect(covers(keys, clubKeys.club(CLUB))).toBe(true);
  });

  it("prefiks odpowiedzi jest BEZ sortu - kazdy wariant sortowania wpada", () => {
    const keys = replyEditedKeys(THREAD);

    // Wyliczanie wariantow z reki gwarantuje, ze kolejny zostanie kiedys
    // pominiety - tak wczesniej zniknal sort 'stance'.
    for (const sort of ["chronological", "top", "stance"]) {
      expect(covers(keys, clubKeys.replies(THREAD, sort))).toBe(true);
    }
  });

  it("redakcja tematu rusza takze WYSZUKIWARKE (tytul jest jej projekcja)", () => {
    const keys = threadEditedKeys(CLUB, SLUG);

    expect(covers(keys, clubKeys.searchAll())).toBe(true);
    expect(covers(keys, clubKeys.thread(CLUB, SLUG))).toBe(true);
  });

  it("rozstrzygniecie rusza caly prefiks odpowiedzi, nie sam sort chronologiczny", () => {
    const keys = threadResolvedKeys(CLUB, SLUG, THREAD);

    // SQL wynosi rozstrzygajaca odpowiedz na gore w KAZDYM sorcie, wiec
    // punktowa inwalidacja zostawialaby ja w starym miejscu w pozostalych.
    expect(covers(keys, clubKeys.replies(THREAD, "top"))).toBe(true);
    expect(covers(keys, clubKeys.thread(CLUB, SLUG))).toBe(true);
  });

  it("stanowiska maja wlasny klucz per watek", () => {
    expect(threadStanceKeys(THREAD)).toEqual([clubKeys.stances(THREAD)]);
    expect(covers(threadStanceKeys(THREAD), clubKeys.stances("thread-2"))).toBe(false);
  });

  it("reakcja odswieza licznik I twarze - inaczej widac +1 bez awatara", () => {
    const ids = ["a", "b"];
    const keys = reactionKeys("thread", ids);

    expect(covers(keys, clubKeys.reactions("thread", ids))).toBe(true);
    expect(covers(keys, clubKeys.reactionActors("thread", ids))).toBe(true);
  });
});

describe("skutki komentowania z karty strumienia", () => {
  it("odpowiedź z karty odświeża podgląd w karcie, stronę wątku i kartę wątku", () => {
    const keys = feedReplyKeys(CLUB, SLUG, THREAD);

    expect(covers(keys, clubKeys.replyPreview(THREAD, 2))).toBe(true);
    expect(covers(keys, clubKeys.replies(THREAD, "chronological"))).toBe(true);
    expect(covers(keys, clubKeys.thread(CLUB, SLUG))).toBe(true);
  });

  it("REGRESJA: odpowiedź z karty NIE unieważnia list wątków ani poddrzewa klubu", () => {
    // Pełne unieważnienie (`threadReplyKeys`) przeładowuje każdą stronę listy
    // wątków huba; w sortowaniu „gorące" karta, pod którą czytelnik właśnie
    // odpowiedział, odjeżdża mu spod kursora.
    const keys = feedReplyKeys(CLUB, SLUG, THREAD);

    expect(covers(keys, clubKeys.threads(CLUB, null, "hot", null))).toBe(false);
    expect(covers(keys, clubKeys.threadsAll(CLUB))).toBe(false);
    expect(covers(keys, clubKeys.club(CLUB))).toBe(false);
    expect(covers(keys, clubKeys.posts(CLUB, null, null))).toBe(false);
    // ...podczas gdy pełny skutek strony wątku je obejmuje - to jest różnica.
    expect(covers(threadReplyKeys(CLUB, SLUG, THREAD), clubKeys.threadsAll(CLUB))).toBe(true);
  });

  it("odpowiedź z karty nie dotyka podglądu INNEGO wątku", () => {
    expect(covers(feedReplyKeys(CLUB, SLUG, THREAD), clubKeys.replyPreview("thread-2", 2))).toBe(
      false,
    );
  });

  it("komentarz wpisu odświeża WYŁĄCZNIE komentarze tego wpisu (każdy rozmiar strony)", () => {
    const keys = postCommentKeys(CLUB, "post-1");

    expect(keys).toEqual([clubKeys.postComments(CLUB, "post-1")]);
    expect(covers(keys, clubKeys.postCommentsPage(CLUB, "post-1", 3))).toBe(true);
    expect(covers(keys, clubKeys.postCommentsPage(CLUB, "post-1", 10))).toBe(true);
  });

  it("komentarz wpisu NIE przeładowuje ściany - licznik poprawia hook w miejscu", () => {
    // Przeładowana pierwsza strona ściany wypycha najstarszą kartę, gdy w
    // międzyczasie ktoś opublikował wpis - często tę, pod którą się pisze.
    const keys = postCommentKeys(CLUB, "post-1");

    expect(covers(keys, clubKeys.posts(CLUB, null, null))).toBe(false);
    expect(covers(keys, clubKeys.posts(CLUB, "group-1", null))).toBe(false);
    expect(covers(keys, clubKeys.postsAll(CLUB))).toBe(false);
  });

  it("komentarz wpisu nie rusza rozmów pod INNYMI wpisami, wątków ani innego klubu", () => {
    const keys = postCommentKeys(CLUB, "post-1");

    expect(covers(keys, clubKeys.postCommentsPage(CLUB, "post-2", 3))).toBe(false);
    expect(covers(keys, clubKeys.threadsAll(CLUB))).toBe(false);
    expect(covers(keys, clubKeys.thread(CLUB, SLUG))).toBe(false);
    expect(covers(keys, clubKeys.postCommentsPage("club-2", "post-1", 3))).toBe(false);
  });

  it("unieważnienie ściany (usunięcie wpisu) nie przeładowuje rozwiniętych rozmów", () => {
    expect(covers([clubKeys.postsAll(CLUB)], clubKeys.postCommentsPage(CLUB, "post-1", 3))).toBe(
      false,
    );
    // Wyrzucenie z klubu i moderacja (poddrzewo klubu) dalej je czyszczą.
    expect(covers(clubOnlyKeys(CLUB), clubKeys.postCommentsPage(CLUB, "post-1", 3))).toBe(true);
  });

  it("oba skutki są w rejestrze - inaczej omijałyby inwarianty niżej", () => {
    const registry = clubInvalidationsForTest(CLUB, SLUG, THREAD, "post-1");

    expect(registry.feedReplyKeys).toEqual(feedReplyKeys(CLUB, SLUG, THREAD));
    expect(registry.postCommentKeys).toEqual(postCommentKeys(CLUB, "post-1"));
  });
});

describe("clubReadKeys", () => {
  it("plakietka licznika zyje POZA drzewem klubow i musi byc wymieniona jawnie", () => {
    const keys = clubReadKeys();

    // Bez `pendingCounterKeys` kropka przy zakladce zostawala po
    // wyczyszczeniu nieprzeczytanych.
    expect(covers(keys, pendingCounterKeys.all)).toBe(true);
    expect(covers(keys, clubKeys.memberships())).toBe(true);
    expect(isPrefixOf(clubKeys.all, pendingCounterKeys.all)).toBe(false);
  });
});

describe("invalidateKeys", () => {
  it("uniewaznia KAZDY klucz zestawu, w kolejnosci", () => {
    const invalidateQueries = vi.fn();

    invalidateKeys({ invalidateQueries }, clubCardKeys(CLUB));

    expect(invalidateQueries).toHaveBeenCalledTimes(3);
    expect(invalidateQueries.mock.calls.map(([arg]) => arg)).toEqual([
      { queryKey: clubKeys.club(CLUB) },
      { queryKey: clubKeys.list() },
      { queryKey: clubKeys.bySlugAll() },
    ]);
  });

  it("pusty zestaw nie woła klienta ani razu", () => {
    const invalidateQueries = vi.fn();

    invalidateKeys({ invalidateQueries }, []);

    expect(invalidateQueries).not.toHaveBeenCalled();
  });
});

describe("inwarianty katalogu skutkow", () => {
  it("KAZDY skutek zwraca co najmniej jeden klucz", () => {
    for (const [name, keys] of Object.entries(clubInvalidationsForTest(CLUB, SLUG, THREAD))) {
      expect(keys.length, `skutek ${name} nie uniewaznia niczego`).toBeGreaterThan(0);
    }
  });

  it("zaden skutek nie duplikuje tego samego klucza", () => {
    for (const [name, keys] of Object.entries(clubInvalidationsForTest(CLUB, SLUG, THREAD))) {
      const serialized = keys.map((k) => JSON.stringify(k));
      expect(new Set(serialized).size, `skutek ${name} ma powtorzony klucz`).toBe(keys.length);
    }
  });

  it("zaden skutek nie zawiera klucza, ktory jest prefiksem innego w TYM SAMYM zestawie", () => {
    // Klucz szerszy pochlania wezszy, wiec para (prefiks, potomek) to zawsze
    // jedno zbedne wywolanie - i sygnal, ze intencja zestawu jest niejasna.
    for (const [name, keys] of Object.entries(clubInvalidationsForTest(CLUB, SLUG, THREAD))) {
      for (let i = 0; i < keys.length; i += 1) {
        for (let j = 0; j < keys.length; j += 1) {
          if (i === j) continue;
          expect(
            isPrefixOf(keys[i]!, keys[j]!),
            `skutek ${name}: klucz ${i} pochlania klucz ${j}`,
          ).toBe(false);
        }
      }
    }
  });
});

describe("CLUB_STALE_MS", () => {
  it("okno swiezosci jest w rytmie dyskusji, nie sekund", () => {
    expect(CLUB_STALE_MS).toBe(30_000);
  });
});
