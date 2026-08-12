// Model strumienia huba klubu.
//
// PO CO TO ISTNIEJE. Klub ma dziś cztery osobne powierzchnie (wątki, biblioteka,
// kalendarz, harmonogram) i cztery osobne ekrany, na które trzeba WEJŚĆ, żeby
// się dowiedzieć, że coś się w nich zmieniło. Strona klubu była piątym ekranem:
// płaską listą tytułów. Nic nie mówiło "w tym klubie za trzy dni jest
// posiedzenie, wczoraj doszły dwa dokumenty, a etap konsultacji kończy się
// w piątek" - a to jest dokładnie ta informacja, dla której członek wchodzi.
//
// Hub scala te cztery źródła w JEDEN strumień. Ta funkcja jest jego całą
// logiką i jest CZYSTA - bez daty systemowej, bez losowości, bez zapytań.
// Dzięki temu kolejność wpisów jest przewidywalna i daje się przetestować,
// a nie "wychodzi jakoś" przy każdym renderze.
//
// DLACZEGO PRZEPLOT, A NIE SORT PO DACIE. Sortowanie wszystkiego po czasie
// wygląda uczciwie i jest bezużyteczne: dziesięć dokumentów wgranych w jednym
// posiedzeniu zepchnęłoby całą dyskusję pod ekran. Kręgosłupem strumienia są
// WĄTKI (bo klub jest miejscem rozmowy), a pozostałe źródła wchodzą jako karty
// kontekstowe na STAŁYCH pozycjach - tak jak robi to każdy strumień
// społecznościowy z treścią, która nie jest postem.
import type { ClubThreadListRow } from "./types";
import type { ClubDocumentRow, ClubEventRow, ClubMilestoneRow } from "./workspaceTypes";
import type { ClubPostRow } from "./postTypes";

/** Tryb strumienia. Jedna kontrolka nad feedem zamiast pięciu zakładek. */
export const CLUB_FEED_MODES = ["all", "posts", "threads", "documents", "calendar"] as const;
export type ClubFeedMode = (typeof CLUB_FEED_MODES)[number];

export type ClubFeedEntry =
  | { kind: "thread"; key: string; thread: ClubThreadListRow }
  /** Wpis "ścianowy" (A31): krótka forma z załącznikami, opcjonalnie
   *  podpięta pod wątek. */
  | { kind: "post"; key: string; post: ClubPostRow }
  | { kind: "event"; key: string; event: ClubEventRow }
  | { kind: "milestone"; key: string; milestone: ClubMilestoneRow }
  /** Dokumenty wchodzą PACZKĄ, nie pojedynczo: trzy karty plików pod rząd
   *  wyglądają jak awaria strumienia, a jedna karta z trzema pozycjami czyta
   *  się jak "doszły materiały". */
  | { kind: "documents"; key: string; documents: ClubDocumentRow[] };

export interface ClubFeedInput {
  mode: ClubFeedMode;
  threads: readonly ClubThreadListRow[];
  documents: readonly ClubDocumentRow[];
  events: readonly ClubEventRow[];
  milestones: readonly ClubMilestoneRow[];
  /** Opcjonalne, bo tryb "Wpisy" doszedł później niż sam strumień i wołający
   *  bez ściany (np. mini-strona klubu) nie ma czego przekazać. */
  posts?: readonly ClubPostRow[];
}

/**
 * Pozycje kart kontekstowych w strumieniu wątków. Liczone w WĄTKACH, nie
 * w elementach wyjścia - inaczej wstawienie jednej karty przesuwałoby każdą
 * następną i dwie potrafiłyby wylądować obok siebie.
 *
 * Kolejność ma uzasadnienie: najbliższy termin jest najpilniejszy i idzie
 * najwyżej; materiały są kontekstem do czytania niżej; etap prac to rama
 * całości i może poczekać na koniec pierwszego ekranu.
 */
const SLOTS = { event: 2, documents: 5, milestone: 9 } as const;

/** Ile pozycji pokazuje karta paczki dokumentów. */
const DOCUMENTS_IN_CARD = 3;

function documentsEntry(documents: readonly ClubDocumentRow[]): ClubFeedEntry | null {
  const take = documents.slice(0, DOCUMENTS_IN_CARD);
  if (take.length === 0) return null;
  // Klucz niesie identyfikatory paczki, więc dojście nowego dokumentu
  // przemontuje kartę zamiast domalować wiersz w starej.
  return { kind: "documents", key: `docs:${take.map((d) => d.id).join("+")}`, documents: take };
}

/**
 * Buduje strumień huba.
 *
 * Karta kontekstowa pojawia się DOKŁADNIE RAZ i tylko wtedy, gdy ma treść.
 * Gdy wątków jest mniej niż pozycja slotu, karta i tak trafia do strumienia -
 * na jego koniec. To jest celowe: w młodym klubie kontekst (nadchodzące
 * posiedzenie, pierwsze materiały) jest CAŁĄ treścią, jaka istnieje, i
 * ukrycie go tylko dlatego, że nie ma jeszcze dziewięciu wątków, zostawiłoby
 * pustą stronę.
 */
export function buildClubFeed(input: ClubFeedInput): ClubFeedEntry[] {
  const { mode, threads, documents, events, milestones } = input;
  const posts = input.posts ?? [];

  if (mode === "threads") {
    return threads.map((thread) => ({ kind: "thread", key: `t:${thread.id}`, thread }));
  }
  if (mode === "posts") {
    return posts.map((post) => ({ kind: "post", key: `p:${post.id}`, post }));
  }

  if (mode === "documents") {
    // Tryb dedykowany pokazuje dokumenty POJEDYNCZO - tu paczka byłaby
    // ukrywaniem treści, po którą użytkownik świadomie przełączył widok.
    return documents.map((document) => ({
      kind: "documents",
      key: `doc:${document.id}`,
      documents: [document],
    }));
  }
  if (mode === "calendar") {
    return events.map((event) => ({ kind: "event", key: `e:${event.id}`, event }));
  }

  const nextEvent = events[0] ?? null;
  const docs = documentsEntry(documents);
  // "Bieżący etap" to pierwszy aktywny, a gdy takiego nie ma - pierwszy
  // zaplanowany. Etap zamknięty nie jest kontekstem dla nowej rozmowy.
  const stage =
    milestones.find((m) => m.state === "active") ??
    milestones.find((m) => m.state === "planned") ??
    null;

  const pending: Array<{ at: number; entry: ClubFeedEntry }> = [];
  if (nextEvent !== null) {
    pending.push({
      at: SLOTS.event,
      entry: { kind: "event", key: `e:${nextEvent.id}`, event: nextEvent },
    });
  }
  if (docs !== null) {
    pending.push({ at: SLOTS.documents, entry: docs });
  }
  if (stage !== null) {
    pending.push({
      at: SLOTS.milestone,
      entry: { kind: "milestone", key: `m:${stage.id}`, milestone: stage },
    });
  }

  // KRĘGOSŁUP TRYBU "WSZYSTKO" TO ŚCIANA: wpisy i wątki w jednym ciągu.
  //
  // Wpis wchodzi PRZED pierwszym wątkiem, który jest od niego starszy, a nie
  // przez globalne posortowanie po dacie. Powód: lista wątków przychodzi
  // w porządku "gorące", który datą nie jest - przesortowanie jej po czasie
  // zniszczyłoby ranking, po który użytkownik przyszedł. Ta reguła zachowuje
  // WZGLĘDNĄ kolejność wątków i mimo to stawia świeży wpis na górze.
  const backbone: ClubFeedEntry[] = [];
  let postIndex = 0;
  const pushPostsNewerThan = (stamp: string | null): void => {
    while (postIndex < posts.length) {
      const post = posts[postIndex]!;
      if (stamp !== null && post.created_at <= stamp) break;
      backbone.push({ kind: "post", key: `p:${post.id}`, post });
      postIndex += 1;
    }
  };

  threads.forEach((thread) => {
    pushPostsNewerThan(thread.last_reply_at ?? thread.created_at);
    backbone.push({ kind: "thread", key: `t:${thread.id}`, thread });
  });
  pushPostsNewerThan(null);

  const out: ClubFeedEntry[] = [];
  let placed = 0;
  backbone.forEach((entry, index) => {
    out.push(entry);
    const position = index + 1;
    while (placed < pending.length && pending[placed]!.at === position) {
      out.push(pending[placed]!.entry);
      placed += 1;
    }
  });

  // Reszta kart kontekstowych, dla których zabrakło wątków - patrz doc.
  for (let i = placed; i < pending.length; i += 1) {
    out.push(pending[i]!.entry);
  }

  return out;
}

/**
 * Czy strumień jest pusty NA POZIOMIE TREŚCI, a nie tylko wątków.
 * Klub z jednym nadchodzącym posiedzeniem i zerem wątków nie jest pusty -
 * i ekran nie ma prawa twierdzić inaczej.
 */
export function isClubFeedEmpty(entries: readonly ClubFeedEntry[]): boolean {
  return entries.length === 0;
}
