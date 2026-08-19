// Atomy testowe MODUŁU CZATU - atomic design zastosowany do testów, dokładnie
// jak w `src/test/network/fixtures.ts`. Jedno źródło prawdy dla WIERSZY BAZY
// i widoków domenowych czatu; generyczna maszyneria klienta (łańcuch PostgREST,
// RPC, realtime, storage, i18n) mieszka w `src/test/supabase/` i jest stąd
// re-eksportowana.
//
// DLACZEGO TO ISTNIEJE. Czat był najsłabszą powierzchnią testową repo (17-20%
// pokrycia przy 12 tys. linii). Główną barierą nie był brak chęci, a koszt
// wejścia: `useMessages`/`useConversations` rozmawiają z bazą przez ŁAŃCUCH
// PostgREST (`.from().select().eq().order().limit()`), a nie przez pojedyncze
// `rpc()`, więc każdy test musiał budować własną atrapę łańcucha. Ten moduł
// robi to raz. Skutek: zmiana kontraktu warstwy danych psuje JEDEN plik
// (ten), nie osiemnaście plików testowych.
//
// Świadomie BEZ JSX i bez importu komponentów - moduł jest wciągany także
// z wnętrza fabryk `vi.mock` (dynamiczny import), więc musi być tani
// i wolny od side-effectów.
import type {
  ChatContactHit,
  ChatMessage,
  ConversationRow,
  ConversationView,
  MessageRow,
  ParticipantRow,
  PeerProfile,
  ReactionRow,
} from "@/lib/chat/types";
import type { MessageSearchHit } from "@/lib/chat/useMessageSearch";

/**
 * Identyfikatory testowe. Tenant jest tu JAWNY, bo każdy zapis czatu
 * (`messages`, `message_reactions`, `user_blocks`) musi stemplować
 * `tenant_id`, a RLS liczy na to, że stempel jest prawdziwy - testy izolacji
 * tenanta odwołują się do tych stałych, nie do literałów rozsypanych po
 * plikach.
 */
export const CHAT_IDS = {
  me: "user-me",
  peer: "user-peer",
  peerTwo: "user-peer-2",
  stranger: "user-stranger",
  tenant: "tenant-alfa",
  foreignTenant: "tenant-beta",
  conversation: "conv-1",
  otherConversation: "conv-2",
  group: "conv-group",
  message: "msg-1",
  reaction: "react-1",
} as const;

/** Stabilny znacznik czasu bazowy - testy liczą od niego, nie od `Date.now()`. */
export const BASE_ISO = "2026-08-18T10:00:00.000Z";

/** `BASE_ISO` przesunięty o N minut (dodatnio = w przyszłość). */
export function isoOffset(minutes: number, from: string = BASE_ISO): string {
  return new Date(new Date(from).getTime() + minutes * 60_000).toISOString();
}

/** Znacznik „N minut temu" liczony od realnego zegara (testy okna edycji). */
export function minutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

// --- wiersze bazy -----------------------------------------------------------
// Kształty 1:1 z `Database["public"]["Tables"][...]["Row"]`, więc rozjazd
// kolumny w migracji wychodzi na typach w KAŻDYM teście, który tego wiersza
// używa - a nie dopiero w runtime na produkcji.

/**
 * Wiersz `conversations` (wątek bezpośredni). `direct_key` jest w formacie
 * `<tenant>:<uidA>:<uidB>` - to Z NIEGO, a nie z wiersza uczestnika, wynika
 * tożsamość rozmówcy, bo RLS potrafi ukryć wiersz peera (wyłączone
 * potwierdzenia odczytu).
 */
export function conversationRow(overrides: Partial<ConversationRow> = {}): ConversationRow {
  const id = overrides.id ?? CHAT_IDS.conversation;
  return {
    id,
    tenant_id: CHAT_IDS.tenant,
    kind: "direct",
    direct_key: `${CHAT_IDS.tenant}:${CHAT_IDS.me}:${CHAT_IDS.peer}`,
    title: null,
    description: null,
    created_by: CHAT_IDS.me,
    created_at: BASE_ISO,
    updated_at: BASE_ISO,
    last_message_at: BASE_ISO,
    last_message_kind: "text",
    last_message_preview: "Dzień dobry",
    last_message_sender: CHAT_IDS.peer,
    message_ttl_seconds: null,
    theme: null,
    wallpaper: null,
    quick_emoji: null,
    ...overrides,
  };
}

/** Wiersz `conversations` dla kręgu (grupy) - bez `direct_key`, z tytułem. */
export function groupConversationRow(overrides: Partial<ConversationRow> = {}): ConversationRow {
  return conversationRow({
    id: CHAT_IDS.group,
    kind: "group",
    direct_key: null,
    title: "Krąg energetyczny",
    ...overrides,
  });
}

/** Wiersz `conversation_participants`. */
export function participantRow(overrides: Partial<ParticipantRow> = {}): ParticipantRow {
  const userId = overrides.user_id ?? CHAT_IDS.me;
  const conversationId = overrides.conversation_id ?? CHAT_IDS.conversation;
  return {
    id: `part-${conversationId}-${userId}`,
    conversation_id: conversationId,
    user_id: userId,
    tenant_id: CHAT_IDS.tenant,
    unread_count: 0,
    last_read_at: null,
    last_delivered_at: null,
    pinned_at: null,
    archived_at: null,
    muted_until: null,
    cleared_before: null,
    role: "member",
    created_at: BASE_ISO,
    updated_at: BASE_ISO,
    ...overrides,
  };
}

/** Wiersz `messages`. Domyślnie tekst od rozmówcy, bez załącznika. */
export function messageRow(overrides: Partial<MessageRow> = {}): MessageRow {
  const id = overrides.id ?? CHAT_IDS.message;
  return {
    id,
    conversation_id: CHAT_IDS.conversation,
    tenant_id: CHAT_IDS.tenant,
    sender_id: CHAT_IDS.peer,
    kind: "text",
    body: "Dzień dobry",
    attachment_path: null,
    attachment_name: null,
    attachment_mime: null,
    attachment_size: null,
    attachment_duration: null,
    reply_to_id: null,
    forwarded: false,
    edited_at: null,
    deleted_at: null,
    expires_at: null,
    created_at: BASE_ISO,
    ...overrides,
  };
}

/** Wiersz `messages` z flagami optymistycznymi (dymek „wysyłanie"/„nieudane"). */
export function chatMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return { ...messageRow(overrides), ...overrides };
}

/** Wiersz `message_reactions`. */
export function reactionRow(overrides: Partial<ReactionRow> = {}): ReactionRow {
  return {
    id: CHAT_IDS.reaction,
    message_id: CHAT_IDS.message,
    conversation_id: CHAT_IDS.conversation,
    tenant_id: CHAT_IDS.tenant,
    user_id: CHAT_IDS.peer,
    emoji: "👍",
    created_at: BASE_ISO,
    ...overrides,
  };
}

/** Wiersz `get_chat_peers` (bezpieczna karta profilu rozmówcy). */
export function peerProfile(overrides: Partial<PeerProfile> = {}): PeerProfile {
  return {
    id: CHAT_IDS.peer,
    display_name: "Anna Nowak",
    avatar_url: "",
    slug: "anna-nowak",
    job_title: "Analityk",
    current_company: "NES",
    specialization: "Energia",
    ...overrides,
  };
}

/** Wiersz `search_chat_contacts` (wyszukiwarka odbiorców - tylko sieć kontaktów). */
export function chatContactHit(overrides: Partial<ChatContactHit> = {}): ChatContactHit {
  return {
    id: CHAT_IDS.peer,
    display_name: "Anna Nowak",
    avatar_url: "",
    slug: "anna-nowak",
    job_title: "Analityk",
    current_company: "NES",
    specialization: "Energia",
    location: "Warszawa",
    verified: true,
    total_count: 1,
    ...overrides,
  };
}

/** Wiersz `search_messages` (trafienie wyszukiwarki treści, snippet w [[[ ]]]). */
export function messageSearchHit(overrides: Partial<MessageSearchHit> = {}): MessageSearchHit {
  return {
    id: CHAT_IDS.message,
    conversation_id: CHAT_IDS.conversation,
    sender_id: CHAT_IDS.peer,
    kind: "text",
    snippet: "[[[polityka]]] energetyczna",
    created_at: BASE_ISO,
    rank: 0.5,
    total_count: 1,
    ...overrides,
  };
}

// --- widoki domenowe --------------------------------------------------------

/**
 * `ConversationView` - wątek bezpośredni widziany przez `CHAT_IDS.me`.
 * `me`/`peers` da się nadpisać częściowo, żeby test dotykał tylko tego, co
 * bada (np. samego `unread_count`).
 */
export function conversationView(
  overrides: {
    conversation?: Partial<ConversationRow>;
    me?: Partial<ParticipantRow>;
    peers?: ParticipantRow[];
  } = {},
): ConversationView {
  const conversation = conversationRow(overrides.conversation);
  return {
    conversation,
    me: participantRow({
      conversation_id: conversation.id,
      user_id: CHAT_IDS.me,
      ...overrides.me,
    }),
    peers: overrides.peers ?? [
      participantRow({ conversation_id: conversation.id, user_id: CHAT_IDS.peer }),
    ],
  };
}

/** `ConversationView` dla kręgu z dwoma rozmówcami. */
export function groupConversationView(
  overrides: {
    conversation?: Partial<ConversationRow>;
    me?: Partial<ParticipantRow>;
    peers?: ParticipantRow[];
  } = {},
): ConversationView {
  const conversation = groupConversationRow(overrides.conversation);
  return {
    conversation,
    me: participantRow({
      conversation_id: conversation.id,
      user_id: CHAT_IDS.me,
      role: "owner",
      ...overrides.me,
    }),
    peers: overrides.peers ?? [
      participantRow({ conversation_id: conversation.id, user_id: CHAT_IDS.peer }),
      participantRow({ conversation_id: conversation.id, user_id: CHAT_IDS.peerTwo }),
    ],
  };
}

/** Mapa profili w kształcie zwracanym przez `usePeerProfiles`. */
export function peerProfileMap(
  profiles: ReadonlyArray<PeerProfile> = [peerProfile()],
): ReadonlyMap<string, PeerProfile> {
  return new Map(profiles.map((p) => [p.id, p]));
}

// --- atomy klienta Supabase (re-eksport) ------------------------------------

// Generyczna maszyneria klienta wyprowadzila sie do `src/test/supabase/`:
// atrapa lancucha PostgREST, rejestrator RPC, kanaly realtime, magazyn plikow
// i stub i18n. Nie ma w nich niczego czatowego, a czytaja przez nie takze
// profil, kluby i siec kontaktow.
//
// Re-eksport zostaje, zeby zaden z plikow testowych czatu nie musial zmieniac
// importu - `@/test/chat/fixtures` nadal daje PELNY zestaw atomow, a to, co
// czatowe (fabryki wierszy i widokow wyzej), zostalo na miejscu.
export {
  fail,
  ok,
  okCount,
  pgError,
  reactI18nextStub,
  realtimeStub,
  storageStub,
  supabaseAuthStub,
  supabaseFromStub,
  supabaseRpcStub,
  translateKey,
  type FakeChannel,
  type PostgrestErrorLike,
  type RealtimeEventPayload,
  type RealtimeHandler,
  type RealtimeStub,
  type RecordedCall,
  type RecordedChain,
  type RecordedListener,
  type RecordedRpc,
  type RpcResponder,
  type StorageStub,
  type SupabaseAuthStub,
  type SupabaseFromStub,
  type SupabaseResult,
  type SupabaseRpcStub,
  type TableResponder,
} from "@/test/supabase";
