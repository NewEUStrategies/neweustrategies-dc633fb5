// Czysta logika WĄTKU rozmowy - wszystko, co `ChatWindow` liczył wewnątrz
// swoich `useMemo`, wyprowadzone do funkcji bez Reacta, bazy i i18n.
//
// DLACZEGO TO WYSZŁO Z KOMPONENTU. `ChatWindow.tsx` miał 1212 linii i 0%
// pokrycia, a mieszkały w nim reguły, których złamanie widzi użytkownik, a nie
// kompilator: kolejność wiadomości przy równych znacznikach czasu, deduplikacja
// wiersza optymistycznego z jego bliźniakiem z realtime, miejsce separatora
// „nieprzeczytane", odsiew wygasłych wiadomości (lustro RLS), budżet stron przy
// skoku do trafienia wyszukiwarki. Żadnej z tych reguł nie da się przetestować
// bez wyrenderowania całego okna czatu razem z sesją, tenantem, kanałem
// realtime i kompozytorem - a to jest dokładnie ten koszt, który przez trzy
// pomiary audytu trzymał ten plik na zerze.
//
// Reguła podziału: TUTAJ decyzje (co pokazać, w jakiej kolejności, czy
// dociągać), w komponencie WYŁĄCZNIE złożenie DOM-u i wywołania i18n. Dlatego
// funkcje zwracają dane (deskryptory), nie gotowe napisy - tłumaczenie zostaje
// w warstwie widoku, więc PL/EN nie wycieka do logiki.
import { isExpired } from "./receipts";
import type { ChatMessage } from "./types";
import type { MessagesPage } from "./messageCache";

/**
 * Spłaszczenie stron historii do listy renderowalnej: najstarsze pierwsze,
 * bez wygasłych, bez duplikatów, w stabilnej kolejności.
 *
 * Trzy reguły, każda z własnym powodem:
 *  1. ODSIEW WYGASŁYCH - lustro filtra RLS (`expires_at > now()`), żeby
 *     wiadomość znikająca zniknęła na tyknięciu minuty, a nie przy najbliższym
 *     refetchu.
 *  2. DEDUPLIKACJA PO `id` - to samo id może przez chwilę stać w dwóch
 *     stronach cache'u (nakładka na granicy stron przy dociąganiu historii).
 *     Wygrywa kopia z NAJNOWSZEJ strony, bo `pages[0]` jest stroną, do której
 *     trafiają wstawki optymistyczne i łatki z realtime - czyli tą, która ma
 *     najświeższą treść.
 *
 *     NOTA O ZMIANIE ZACHOWANIA. Wersja z `ChatWindow` iterowała spłaszczoną
 *     listę OD KOŃCA, więc przy duplikacie wygrywała kopia ze strony
 *     NAJSTARSZEJ - dokładnie odwrotnie, niż mówił jej własny komentarz
 *     („bliźniak z realtime … tam ląduje wersja serwerowa"). Praktycznie nie
 *     dawało to widocznej awarii, bo `upsertMessageInCache` łata wiersz we
 *     WSZYSTKICH stronach, a wiersz optymistyczny ma inne id niż serwerowy
 *     (dedup nigdy ich nie dotyczył - to robi `replaceId`). Ale reguła była
 *     inna niż udokumentowana, więc przy pierwszym realnym rozjeździe stron
 *     wygrałaby kopia stara. Test `deduplikuje po id …` przypina wersję
 *     świeższą.
 *  3. SORTOWANIE `(created_at, id)` - ISO-8601 sortuje się leksykograficznie,
 *     więc goły `<` bije `localeCompare`; `id` jako rozstrzygnięcie remisu
 *     trzyma stałą kolejność wierszy o identycznym znaczniku (zegar
 *     optymistyczny vs serwerowy) między renderami.
 */
export function orderThreadMessages(
  pages: ReadonlyArray<MessagesPage> | undefined,
  nowMs: number,
): ChatMessage[] {
  const seen = new Set<string>();
  const ordered: ChatMessage[] = [];
  for (const page of pages ?? []) {
    for (const message of page.rows) {
      if (isExpired(message, nowMs) || seen.has(message.id)) continue;
      seen.add(message.id);
      ordered.push(message);
    }
  }
  return ordered.sort(compareByCreatedAtThenId);
}

/** Porządek wątku: rosnąco po `created_at`, remis po `id`. */
export function compareByCreatedAtThenId(a: ChatMessage, b: ChatMessage): number {
  if (a.created_at !== b.created_at) return a.created_at < b.created_at ? -1 : 1;
  if (a.id !== b.id) return a.id < b.id ? -1 : 1;
  return 0;
}

/**
 * Migawka stanu nieprzeczytanych zrobiona przy PIERWSZYM zobaczeniu wątku -
 * czyli PRZED tym, jak `mark_conversation_read` wyzeruje licznik.
 */
export interface UnreadSnapshot {
  readonly conversationId: string;
  readonly count: number;
  readonly lastReadAt: string | null;
}

/**
 * Czy migawka wymaga odświeżenia (wątek się zmienił). Dock przełącza rozmowę
 * BEZ remountu, więc bez tego testu separator „nieprzeczytane" zostałby
 * z poprzedniego wątku.
 */
export function needsUnreadSnapshot(
  current: UnreadSnapshot | null,
  conversationId: string,
): boolean {
  return current?.conversationId !== conversationId;
}

/**
 * Id pierwszej NIEPRZECZYTANEJ wiadomości - miejsce, w którym rysuje się
 * separator „nieprzeczytane". Liczone z MIGAWKI, nie z bieżącego licznika:
 * inaczej separator zapadłby się do zera w chwili, w której otwarcie wątku
 * oznacza go jako przeczytany, a użytkownik straciłby punkt, w którym skończył.
 *
 * Własne wiadomości nie liczą się nigdy (nie „czyta się" siebie), a brak
 * `lastReadAt` (wątek nigdy nieotwarty) daje odcięcie w zerze epoki, więc
 * separator ląduje na pierwszej wiadomości rozmówcy.
 */
export function firstUnreadMessageId(
  messages: ReadonlyArray<ChatMessage>,
  myUserId: string | undefined,
  snapshot: UnreadSnapshot | null,
): string | null {
  if (!myUserId || !snapshot || snapshot.count <= 0) return null;
  const cutoff = snapshot.lastReadAt ? new Date(snapshot.lastReadAt).getTime() : 0;
  for (const message of messages) {
    if (message.sender_id !== myUserId && new Date(message.created_at).getTime() > cutoff) {
      return message.id;
    }
  }
  return null;
}

/**
 * Ścieżki załączników do JEDNEGO wywołania podpisów batch. Wiersze usunięte
 * (tombstone) i optymistyczne są pomijane: pierwsze nie mają już obiektu
 * w storage (trigger go sprząta), drugie jeszcze nie przeszły przez insert,
 * więc próba podpisu skończyłaby się błędem storage RLS zamiast podglądu.
 */
export function attachmentPathsOf(messages: ReadonlyArray<ChatMessage>): string[] {
  const paths: string[] = [];
  for (const message of messages) {
    if (message.attachment_path && !message.deleted_at && !message.pending) {
      paths.push(message.attachment_path);
    }
  }
  return paths;
}

// --- rejestr piszących ------------------------------------------------------
// Piszący to ZBIÓR, nie jedno miejsce: w kręgu kilka osób pisze naraz i pauza
// jednej nie może zgasić wskaźnika drugiej. Operacje są czyste i zachowują
// tożsamość zbioru, gdy nic się nie zmienia - inaczej każdy ping „pisze..."
// re-renderowałby całą listę wiadomości.

export function addTyper(current: ReadonlySet<string>, userId: string): ReadonlySet<string> {
  if (current.has(userId)) return current;
  const next = new Set(current);
  next.add(userId);
  return next;
}

export function removeTyper(current: ReadonlySet<string>, userId: string): ReadonlySet<string> {
  if (!current.has(userId)) return current;
  const next = new Set(current);
  next.delete(userId);
  return next;
}

/**
 * Kogo pokazać we wskaźniku „pisze...". W wątku bezpośrednim zawsze rozmówcę
 * (jego nazwa jest już rozstrzygnięta w nagłówku); w kręgu - nazwy piszących
 * z pierwszeństwem pseudonimu nad nazwą profilu, dokładnie jak wszędzie
 * indziej w czacie.
 *
 * Avatar bierzemy od PIERWSZEGO piszącego (jeden avatar w rzędzie „pisze..."),
 * a w wątku bezpośrednim - od rozmówcy.
 */
export interface TypingDisplay {
  readonly names: string[];
  readonly avatarUrl: string | null;
}

export function typingDisplay(params: {
  readonly typingUserIds: ReadonlySet<string>;
  readonly isGroup: boolean;
  readonly peerName: string;
  readonly peerAvatarUrl: string | null;
  readonly resolveName: (userId: string) => string;
  readonly resolveAvatarUrl: (userId: string) => string | null;
}): TypingDisplay {
  const { typingUserIds, isGroup, peerName, peerAvatarUrl, resolveName, resolveAvatarUrl } = params;
  if (!isGroup) return { names: [peerName], avatarUrl: peerAvatarUrl };
  const ids = [...typingUserIds];
  const first = ids[0];
  return {
    names: ids.map(resolveName),
    avatarUrl: first ? resolveAvatarUrl(first) : null,
  };
}

/**
 * Czy wskaźnik „pisze..." wolno pokazać. W wątku bezpośrednim wymaga
 * rozstrzygniętego rozmówcy: dopóki `peerId` jest nullem (profile w locie),
 * dymek „pisze..." bez nazwy i avatara jest gorszy niż jego brak.
 */
export function canShowTyping(params: {
  readonly typingCount: number;
  readonly isGroup: boolean;
  readonly peerId: string | null;
}): boolean {
  if (params.typingCount === 0) return false;
  return params.isGroup || !!params.peerId;
}

// --- nagłówek ---------------------------------------------------------------

/**
 * Deskryptor podtytułu nagłówka. ŚWIADOMIE nie jest napisem: krąg pokazuje
 * „N uczestników · M online", wątek bezpośredni „online"/„offline", a oba
 * teksty pochodzą z i18n z liczebnikami (PL ma one/few/many). Zwracając dane,
 * a nie tekst, trzymamy odmianę w słowniku, a regułę tutaj - i test tej reguły
 * nie zależy od copy.
 */
export type HeaderSubtitle =
  | { readonly kind: "group"; readonly members: number; readonly online: number }
  | { readonly kind: "direct"; readonly online: boolean };

export function headerSubtitle(params: {
  readonly isGroup: boolean;
  readonly peerIds: ReadonlyArray<string>;
  readonly onlineIds: ReadonlySet<string>;
  readonly peerId: string | null;
}): HeaderSubtitle {
  const { isGroup, peerIds, onlineIds, peerId } = params;
  if (isGroup) {
    let online = 0;
    for (const id of peerIds) if (onlineIds.has(id)) online += 1;
    // +1 = wołający: „uczestnicy" to wszyscy w kręgu, nie „pozostali".
    return { kind: "group", members: peerIds.length + 1, online };
  }
  return { kind: "direct", online: !!peerId && onlineIds.has(peerId) };
}

/** Ilu rozmówców jest online (dymek presence w nagłówku i na avatarze). */
export function countOnline(
  peerIds: ReadonlyArray<string>,
  onlineIds: ReadonlySet<string>,
): number {
  let online = 0;
  for (const id of peerIds) if (onlineIds.has(id)) online += 1;
  return online;
}

/**
 * Nazwa AUTORA wiadomości - dla etykiet nadawcy w kręgu, cytatów odpowiedzi
 * i podglądu przekazywania. Kolejność pierwszeństwa jest tu kontraktem
 * produktu, nie szczegółem: własne wiadomości to „Ty", potem pseudonim
 * (Messenger: każdy członek może nadać pseudonim każdemu), potem - tylko
 * w kręgu - nazwa profilu, a w wątku bezpośrednim nazwa z nagłówka, żeby
 * cytat nie migał „..." przy jeszcze niewczytanym profilu.
 */
export function resolveAuthorName(params: {
  readonly senderId: string;
  readonly myUserId: string;
  readonly isGroup: boolean;
  readonly peerName: string;
  readonly youLabel: string;
  readonly nickname: string | null;
  readonly profileName: string | null;
  readonly fallback?: string;
}): string {
  const { senderId, myUserId, isGroup, peerName, youLabel, nickname, profileName } = params;
  if (senderId === myUserId) return youLabel;
  if (nickname) return nickname;
  if (!isGroup) return peerName;
  return profileName ?? params.fallback ?? "...";
}

// --- skok do trafienia wyszukiwarki -----------------------------------------

/**
 * Budżet stron automatycznego dociągania historii przy skoku do trafienia.
 * 12 stron × 40 wiadomości = ~480 wiadomości wstecz. Budżet istnieje, bo
 * trafienie wyszukiwarki może być sprzed roku, a pętla „dociągaj, aż wejdzie
 * w okno" bez limitu przewinęłaby całą historię rozmowy na jedno kliknięcie.
 */
export const JUMP_PAGE_BUDGET = 12;

/**
 * Co zrobić w kolejnym kroku skoku. Decyzja jest jedną czystą funkcją, bo
 * pomyłka w niej daje albo pętlę nieskończonych fetchy, albo skok, który
 * cicho nic nie robi - i jedno i drugie widać wyłącznie w przeglądarce.
 *
 *  - `idle`  - nie ma o co skakać,
 *  - `done`  - wiadomość jest już w oknie; `MessageList` przewinie,
 *  - `wait`  - strona właśnie leci, czekamy (bez podwójnego fetchu),
 *  - `fetch` - dociągnij kolejną starszą stronę,
 *  - `fail`  - historia się skończyła albo budżet wyczerpany; pokaż komunikat.
 */
export type JumpStep = "idle" | "done" | "wait" | "fetch" | "fail";

export function nextJumpStep(params: {
  readonly targetId: string | null;
  readonly targetLoaded: boolean;
  readonly hasNextPage: boolean;
  readonly isFetchingNextPage: boolean;
  readonly pagesLeft: number;
}): JumpStep {
  if (!params.targetId) return "idle";
  if (params.targetLoaded) return "done";
  if (!params.hasNextPage || params.pagesLeft <= 0) return "fail";
  if (params.isFetchingNextPage) return "wait";
  return "fetch";
}

// --- werdykty serwera -------------------------------------------------------

/**
 * Klucz i18n komunikatu dla NIEUDANEJ wysyłki - albo null, gdy komunikatu być
 * NIE MA.
 *
 * Cisza jest tu świadoma i jest regułą produktową, nie przeoczeniem: dymek
 * wiadomości sam przechodzi w stan „nie udało się wysłać" z akcją ponowienia,
 * więc toast dokłada wartość TYLKO wtedy, gdy tłumaczy przyczynę, której z
 * dymka nie da się odczytać - blokadę, niedostępność odbiorcy albo limit tempa.
 * Ogólny toast „coś nie wyszło" przy każdej awarii sieci to hałas nad
 * komunikatem, który już jest na ekranie.
 *
 * Dopasowanie idzie po FRAGMENCIE komunikatu serwera, bo te napisy pochodzą
 * z `RAISE EXCEPTION` w triggerach i RPC (`chat: blocked`,
 * `recipient unavailable`, `chat: rate limited`) i PostgREST owija je własnym
 * kontekstem.
 */
export function sendErrorMessageKey(message: string): string | null {
  if (message.includes("chat: blocked")) return "chat.block.sendBlocked";
  if (message.includes("recipient unavailable")) return "chat.recipientUnavailable";
  if (message.includes("rate limited")) return "chat.rateLimited";
  return null;
}

// --- profile reagujących ----------------------------------------------------

/** Minimalna karta osoby, jakiej potrzebują awatary i tooltipy reakcji. */
export interface ReactorProfile {
  readonly display_name: string;
  readonly avatar_url: string | null;
}

/**
 * Mapa reagujących: profile rozmówców + zsyntetyzowany wpis „ja".
 *
 * Wpis własny jest potrzebny, bo `get_chat_peers` zwraca ROZMÓWCÓW, a na
 * chipie reakcji stoi też własny avatar. Dane bierzemy z metadanych sesji
 * z łagodnym schodzeniem w dół (display_name -> full_name -> name -> e-mail ->
 * etykieta „Ty"), bo różni dostawcy tożsamości wypełniają różne pola.
 */
export function buildReactorProfiles(params: {
  readonly peerProfiles:
    ReadonlyMap<string, { display_name: string | null; avatar_url: string | null }> | undefined;
  readonly me: {
    readonly id: string;
    readonly email?: string | null;
    readonly metadata?: Readonly<Record<string, unknown>> | null;
  } | null;
  readonly youLabel: string;
}): ReadonlyMap<string, ReactorProfile> {
  const map = new Map<string, ReactorProfile>();
  if (params.peerProfiles) {
    for (const [id, profile] of params.peerProfiles) {
      map.set(id, {
        display_name: profile.display_name ?? "",
        avatar_url: profile.avatar_url ?? null,
      });
    }
  }
  const me = params.me;
  if (me) {
    const meta = me.metadata ?? {};
    map.set(me.id, {
      display_name:
        firstNonEmptyString(meta.display_name, meta.full_name, meta.name, me.email) ??
        params.youLabel,
      avatar_url: typeof meta.avatar_url === "string" && meta.avatar_url ? meta.avatar_url : null,
    });
  }
  return map;
}

function firstNonEmptyString(...values: ReadonlyArray<unknown>): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.length > 0) return value;
  }
  return null;
}
