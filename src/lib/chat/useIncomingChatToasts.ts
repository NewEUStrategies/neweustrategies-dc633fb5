// Globalny toast „ktoś do Ciebie napisał" (i zdarzenie dla animowanych
// dzwonków) w dowolnym miejscu serwisu.
//
// ŹRÓDŁEM SĄ WŁASNE WIERSZE UCZESTNIKA, NIE TABELA `messages`. Subskrypcja
// idzie na `conversation_participants` z filtrem `user_id=eq.<uid>`, czyli tę
// samą specyfikację, której używa lista rozmów (`ownParticipantsChannel`
// w `useConversations`). Hub kanałów współdzieli więc jeden kanał, a Realtime
// sprawdza RLS wyłącznie dla właściciela wiersza. Poprzednia wersja słuchała
// INSERT-ów `messages` z filtrem `sender_id=neq.<uid>`. Polityka
// `messages_staff_read` (20260713200000_chat_admin_tenant_scope_fix.sql)
// daje jednak redaktorom i administratorom odczyt KAŻDEJ wiadomości tenanta,
// więc personel dostawał toasty z treścią cudzych prywatnych rozmów, a serwer
// sprawdzał RLS dla każdej zalogowanej karty przy każdej wiadomości. Tutaj
// toast powstaje wyłącznie z rozmowy, w której użytkownik ma własny wiersz
// uczestnika. Wynika to z konstrukcji, nie z dodatkowej bramki.
//
// JAK ROZPOZNAJEMY NOWĄ WIADOMOŚĆ. Trigger `messages_after_insert`
// (20260713100000_chat_improvements_round3.sql) podbija odbiorcom
// `unread_count` i stempluje im `updated_at = now()`, a rozmowie ustawia
// `last_message_at = created_at` (domyślnie `now()`, ta sama transakcja).
//  - Nowa wiadomość to wzrost `unread_count` względem ostatnio widzianej
//    wartości tej rozmowy. Potwierdzenie dostarczenia, wyciszenie czy
//    przypięcie licznika nie zmieniają, więc toasta nie dają.
//  - Pierwsze zdarzenie rozmowy w sesji nie ma punktu odniesienia (przy RLS
//    Realtime nie przysyła starego wiersza). Wtedy wymagamy podpisu
//    transakcji: `updated_at` wiersza równe `last_message_at` rozmowy.
//    Potwierdzenie dostarczenia sprzed chwili tego podpisu nie ma.
//  - Spadek do zera (przeczytano tutaj, w innej karcie albo na innym
//    urządzeniu) zdejmuje toast tej rozmowy.
// Podgląd i nadawcę daje JEDEN select `conversations.last_message_*` (RLS
// członka). Wyciszenie przychodzi w ładunku zdarzenia (`muted_until`), więc
// nie kosztuje zapytania.
//
// BRAMKI, w tej kolejności: wyciszenie, otwarta i skupiona rozmowa, nadawca
// inny niż użytkownik, wiadomość niecofnięta, ta sama sesja. Zdarzenie dla
// dzwonków leci dopiero po nich. Preferencje powiadomień („Wiadomości na
// czacie", tryb cichy) i moduł czatu rozstrzyga montujący przez `enabled`.
//
// JEDEN TOAST NA ROZMOWĘ. Identyfikator `chat-incoming:<conversationId>`
// sprawia, że kolejna wiadomość podmienia toast w miejscu, więc seria
// wiadomości i karta w tle nie piętrzą stosu. Pokazane identyfikatory trzyma
// rejestr modułu. Koniec sesji (wylogowanie, zmiana konta, wyłączenie) zdejmuje
// je wszystkie, a otwarcie rozmowy zdejmuje jej toast.
//
// GDZIE TO ŻYJE. Hak montuje `WorkspaceDock`, jedyna powierzchnia rozmów:
// leniwy chunk renderowany wyłącznie dla zalogowanych, poza /admin i /login,
// w stałej pozycji drzewa `SiteChrome` (nawigacja go nie przemontowuje).
// Gość nie pobiera tego kodu i nie otwiera kanału. Kanał idzie przez
// `tableChannelHub`, który nadaje nazwie losowy sufiks i liczy referencje.
// Własny kanał o stałej nazwie ginął, gdy hak montował się ponownie przed
// potwierdzeniem opuszczenia poprzedniego (realtime-js oddawał wtedy
// opuszczany obiekt).
import { useEffect } from "react";
import i18n from "@/lib/i18n";
import "@/lib/i18n-chat";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { subscribeToTable, type TableChangeHandler } from "@/lib/realtime/tableChannelHub";
import { openChatWindow } from "./chatDockBus";
import { mutedUntilMs, ownParticipantsChannel } from "./useConversations";
import type { ConversationRow, ParticipantRow, PeerProfile } from "./types";

const INCOMING_EVENT = "nes:chat-incoming";

/** Ile znaków podglądu mieści toast. Serwer i tak przycina podgląd do 140. */
const PREVIEW_MAX = 120;

/** Jak długo pamiętamy, że profilu nadawcy nie da się odczytać. */
const PEER_MISS_TTL_MS = 60_000;

/** Górna granica map per rozmowa i per nadawca (pamięć długiej sesji). */
const TRACK_LIMIT = 1000;

/** Nowa wiadomość, która przeszła wszystkie bramki toasta. */
export interface IncomingChatMessage {
  readonly conversationId: string;
  readonly senderId: string;
  /** `last_message_at` rozmowy, czyli znacznik tej wiadomości. */
  readonly at: string;
}

/** Wywoływane przy każdej nowej wiadomości, która dostała toast (dzwonki). */
export function onIncomingChatMessage(handler: (message: IncomingChatMessage) => void) {
  if (typeof window === "undefined") return () => {};
  const listener = (e: Event) => {
    const detail = (e as CustomEvent<IncomingChatMessage>).detail;
    if (detail) handler(detail);
  };
  window.addEventListener(INCOMING_EVENT, listener);
  return () => window.removeEventListener(INCOMING_EVENT, listener);
}

type ConversationPreview = Pick<
  ConversationRow,
  | "id"
  | "kind"
  | "title"
  | "last_message_at"
  | "last_message_kind"
  | "last_message_preview"
  | "last_message_sender"
>;

const CONVERSATION_PREVIEW_SELECT =
  "id, kind, title, last_message_at, last_message_kind, last_message_preview, last_message_sender";

/** Obsługa jednej rozmowy: najwyżej jeden odczyt w locie, kolejne zdarzenia go powtarzają. */
interface ConversationRun {
  row: Partial<ParticipantRow>;
  needsSignature: boolean;
  again: boolean;
}

let unsubscribe: (() => void) | null = null;
let subscribedUid: string | null = null;
let refCount = 0;
/** Pokolenie sesji: rośnie przy każdym otwarciu i zamknięciu kanału. */
let generation = 0;

/** Ostatnio widziany `unread_count` per rozmowa, czyli punkt odniesienia. */
const lastUnread = new Map<string, number>();
/** `last_message_at` (ms) ostatniej obsłużonej wiadomości per rozmowa. */
const handledAt = new Map<string, number>();
const runs = new Map<string, ConversationRun>();
const peerCache = new Map<string, { profile: PeerProfile | null; at: number }>();
const peerInflight = new Map<string, Promise<PeerProfile | null>>();
/** Identyfikatory toastów, które ta sesja pokazała i jeszcze nie zniknęły. */
const shownToasts = new Set<string>();

function remember<V>(map: Map<string, V>, key: string, value: V): void {
  map.delete(key);
  map.set(key, value);
  if (map.size > TRACK_LIMIT) {
    const oldest = map.keys().next().value;
    if (oldest !== undefined) map.delete(oldest);
  }
}

function toastIdFor(conversationId: string): string {
  return `chat-incoming:${conversationId}`;
}

/**
 * Zdejmuje toast tej rozmowy, jeśli ta sesja go pokazała. Woła to szyna
 * otwierania rozmów (otwarta rozmowa nie potrzebuje już powiadomienia).
 */
export function dismissIncomingChatToast(conversationId: string): void {
  const id = toastIdFor(conversationId);
  if (!shownToasts.delete(id)) return;
  toast.dismiss(id);
}

function isCurrent(uid: string, gen: number): boolean {
  return subscribedUid === uid && generation === gen;
}

function isConversationFocused(conversationId: string): boolean {
  if (typeof document === "undefined") return false;
  if (!document.hasFocus()) return false;
  if (document.visibilityState !== "visible") return false;
  return !!document.querySelector(`[data-active-conversation="${CSS.escape(conversationId)}"]`);
}

function clip(text: string): string {
  const trimmed = text.trim();
  return trimmed.length > PREVIEW_MAX ? `${trimmed.slice(0, PREVIEW_MAX - 3)}...` : trimmed;
}

/**
 * Podgląd z denormalizacji rozmowy: dla tekstu to treść, dla zdjęcia
 * i pliku podpis albo nazwa pliku, dla głosówki nic (etykietę nadaje klient).
 * Przycinamy WYNIK KOŃCOWY, razem z etykietą załącznika.
 */
function buildPreview(conversation: ConversationPreview): string {
  const text = (conversation.last_message_preview ?? "").trim();
  switch (conversation.last_message_kind) {
    case "image":
      return clip(text ? `${i18n.t("chat.photo")} - ${text}` : i18n.t("chat.photo"));
    case "file":
      return clip(text ? `${i18n.t("chat.file")}: ${text}` : i18n.t("chat.file"));
    case "audio":
      return i18n.t("chat.voice.message");
    default:
      return text ? clip(text) : i18n.t("chat.incoming.emptyBody");
  }
}

async function loadConversation(conversationId: string): Promise<ConversationPreview | null> {
  const { data, error } = await supabase
    .from("conversations")
    .select(CONVERSATION_PREVIEW_SELECT)
    .eq("id", conversationId)
    .maybeSingle();
  if (error || !data) return null;
  return data as ConversationPreview;
}

async function fetchPeer(senderId: string, gen: number): Promise<PeerProfile | null> {
  let profile: PeerProfile | null = null;
  try {
    const { data, error } = await supabase.rpc("get_chat_peers", { p_user_ids: [senderId] });
    profile = !error && data && data.length > 0 ? data[0] : null;
  } catch {
    profile = null;
  }
  // Wynik pusty też trafia do pamięci (z krótkim TTL), żeby nadawca bez
  // widocznego profilu nie kosztował RPC przy każdej wiadomości.
  if (gen === generation) remember(peerCache, senderId, { profile, at: Date.now() });
  return profile;
}

/** Profil nadawcy: pamięć sesji, a równoległe prośby o tego samego nadawcę dzielą jedno RPC. */
function resolvePeer(senderId: string): Promise<PeerProfile | null> {
  const cached = peerCache.get(senderId);
  if (cached && (cached.profile || Date.now() - cached.at < PEER_MISS_TTL_MS)) {
    return Promise.resolve(cached.profile);
  }
  const inflight = peerInflight.get(senderId);
  if (inflight) return inflight;
  const request = fetchPeer(senderId, generation);
  peerInflight.set(senderId, request);
  void request.then(() => {
    if (peerInflight.get(senderId) === request) peerInflight.delete(senderId);
  });
  return request;
}

function showToast(conversation: ConversationPreview, peer: PeerProfile | null): void {
  const conversationId = conversation.id;
  const id = toastIdFor(conversationId);
  const sender = peer?.display_name?.trim() || i18n.t("chat.incoming.someone");
  // W kręgu odbiorca musi wiedzieć, GDZIE odpisać, nie tylko kto napisał.
  const title =
    conversation.kind === "group"
      ? `${sender} · ${conversation.title?.trim() || i18n.t("chat.group.circle")}`
      : sender;
  shownToasts.add(id);
  toast(title, {
    id,
    description: buildPreview(conversation),
    duration: 6000,
    action: {
      label: i18n.t("chat.incoming.open"),
      onClick: () => {
        shownToasts.delete(id);
        openChatWindow({ conversationId });
      },
    },
    onDismiss: () => shownToasts.delete(id),
    onAutoClose: () => shownToasts.delete(id),
  });
}

async function announce(
  uid: string,
  gen: number,
  conversationId: string,
  row: Partial<ParticipantRow>,
  needsSignature: boolean,
): Promise<void> {
  const conversation = await loadConversation(conversationId);
  if (!conversation || !isCurrent(uid, gen)) return;
  const at = conversation.last_message_at;
  const senderId = conversation.last_message_sender;
  if (!at || !senderId || senderId === uid) return;
  if (conversation.last_message_kind === "deleted") return;
  const atMs = Date.parse(at);
  const handled = handledAt.get(conversationId);
  if (Number.isNaN(atMs) || (handled !== undefined && atMs <= handled)) return;
  if (needsSignature && Date.parse(row.updated_at ?? "") !== atMs) return;
  remember(handledAt, conversationId, atMs);

  const peer = await resolvePeer(senderId);
  // Odczyty trwają. W tym czasie sesja mogła się skończyć (wylogowanie,
  // zejście doku) albo użytkownik mógł otworzyć tę rozmowę. Spóźniony toast
  // nie może trafić do innej sesji ani dublować okna, które już czyta.
  if (!isCurrent(uid, gen) || isConversationFocused(conversationId)) return;
  const message: IncomingChatMessage = { conversationId, senderId, at };
  window.dispatchEvent(new CustomEvent<IncomingChatMessage>(INCOMING_EVENT, { detail: message }));
  showToast(conversation, peer);
}

/**
 * Najwyżej jeden odczyt rozmowy w locie. Zdarzenie, które przyjdzie w tym
 * czasie, zapamiętuje swój wiersz i powtarza odczyt po zakończeniu
 * bieżącego, więc toast pokaże najnowszą wiadomość serii.
 */
function schedule(
  uid: string,
  gen: number,
  conversationId: string,
  row: Partial<ParticipantRow>,
  needsSignature: boolean,
): void {
  const running = runs.get(conversationId);
  if (running) {
    running.row = row;
    running.needsSignature = needsSignature;
    running.again = true;
    return;
  }
  const run: ConversationRun = { row, needsSignature, again: false };
  runs.set(conversationId, run);
  void (async () => {
    try {
      do {
        run.again = false;
        await announce(uid, gen, conversationId, run.row, run.needsSignature);
      } while (run.again && isCurrent(uid, gen));
    } catch {
      // Toast to dekoracja: błąd odczytu nie może wyjść poza tę rozmowę.
    } finally {
      if (runs.get(conversationId) === run) runs.delete(conversationId);
    }
  })();
}

function handleChange(uid: string, gen: number, payload: Parameters<TableChangeHandler>[0]): void {
  if (payload.eventType !== "INSERT" && payload.eventType !== "UPDATE") return;
  const row = payload.new as Partial<ParticipantRow>;
  // Obrona w głąb: filtr kanału i RLS przepuszczają wyłącznie własne wiersze.
  if (!isCurrent(uid, gen) || row.user_id !== uid || typeof row.conversation_id !== "string") {
    return;
  }
  const conversationId = row.conversation_id;
  const unread = typeof row.unread_count === "number" ? row.unread_count : 0;
  const previous = lastUnread.get(conversationId);
  remember(lastUnread, conversationId, unread);

  if (unread <= 0) {
    dismissIncomingChatToast(conversationId);
    return;
  }
  if (previous !== undefined && unread <= previous) return;

  const mutedUntil = mutedUntilMs(row.muted_until ?? null);
  if (mutedUntil !== null && mutedUntil > Date.now()) return;
  if (isConversationFocused(conversationId)) return;

  schedule(uid, gen, conversationId, row, previous === undefined);
}

/** Zamyka kanał i czyści stan sesji, w tym jej toasty i pamięć profili. */
function closeSession(): void {
  unsubscribe?.();
  unsubscribe = null;
  subscribedUid = null;
  generation += 1;
  for (const id of shownToasts) toast.dismiss(id);
  shownToasts.clear();
  lastUnread.clear();
  handledAt.clear();
  runs.clear();
  peerCache.clear();
  peerInflight.clear();
}

function acquire(uid: string): void {
  refCount += 1;
  if (unsubscribe && subscribedUid === uid) return;
  if (unsubscribe) closeSession();
  subscribedUid = uid;
  generation += 1;
  const gen = generation;
  unsubscribe = subscribeToTable(ownParticipantsChannel(uid), (payload) =>
    handleChange(uid, gen, payload),
  );
}

function release(): void {
  refCount = Math.max(0, refCount - 1);
  if (refCount > 0 || !unsubscribe) return;
  closeSession();
}

/**
 * Montowany raz na sesję członka przez `WorkspaceDock`. Subskrypcja jest
 * liczona na poziomie modułu, więc dodatkowa powierzchnia wołająca ten hak
 * nie otworzy drugiego kanału. `enabled = false` (moduł czatu wyłączony,
 * powiadomienia o wiadomościach wyłączone, tryb cichy) nie otwiera kanału
 * wcale, a wyłączenie w trakcie sesji go zwalnia i zdejmuje toasty.
 */
export function useIncomingChatToasts(enabled = true): void {
  const { user } = useAuth();
  const uid = user?.id;
  useEffect(() => {
    if (!uid || !enabled) return;
    acquire(uid);
    return release;
  }, [uid, enabled]);
}
