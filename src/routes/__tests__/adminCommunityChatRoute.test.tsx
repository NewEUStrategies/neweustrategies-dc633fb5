/**
 * Trasa `/admin/community/chat` - MODERACJA CZATU, czyli jedyne miejsce
 * w panelu, z którego personel kasuje CUDZE rozmowy.
 *
 * PO CO TEN PLIK. Ta trasa miała 0/46 linii i 0/25 funkcji pokrycia, a niesie
 * trzy operacje niszczące o różnym zasięgu:
 *   1. `softDeleteMessage` - ukrywa POJEDYNCZĄ wiadomość (odwracalne w bazie,
 *      nieodwracalne dla czytelnika wątku),
 *   2. `deleteConversation` - kasuje KONWERSACJĘ KASKADOWO (wiadomości
 *      i uczestnicy znikają razem z nią; bez odzysku),
 *   3. `purgeExpiredMessages` - czyści wszystko, czemu minął TTL.
 * Panel bez testu, który pilnuje BRAMKI POTWIERDZENIA przy (2), to jedno
 * przypadkowe kliknięcie od utraty cudzej korespondencji - a kosz stoi w tym
 * samym wierszu co przycisk otwierający podgląd.
 *
 * PRZEDMIOT DOWODU. Sklejenie trasy (`head()`), trzy stany listy, plakietka
 * TTL, przekazanie frazy wyszukiwania do warstwy danych, drill-in do wiadomości
 * z ZASTĘPNIKIEM zamiast treści dla wiadomości ukrytej, widoczność przycisku
 * ukrycia wyłącznie tam, gdzie ma sens, komplet ścieżek potwierdzenia kasowania
 * (otwarcie / anulowanie / potwierdzenie) oraz blokada przycisku purge w trakcie
 * mutacji. Zamockowana jest WYŁĄCZNIE granica danych (`@/lib/admin/community`)
 * i toasty (`sonner`) - i18n, router, react-query i Radix są prawdziwe, więc
 * asercje mierzą napisy ze słownika, a nie literały wpisane w teście.
 *
 * BRAMKA ROLI JEST POZA TĄ TRASĄ - I TAK MA BYĆ.
 * Plik `src/routes/admin.community.chat.tsx` NIE sprawdza roli i nie powinien:
 * `/admin/community/chat` jest dzieckiem układu `src/routes/admin.tsx`, który
 * przekierowuje każdego bez `isStaff` na `/login`. Dowodu na sam layout tutaj
 * NIE DUBLUJEMY - pilnuje go już `src/routes/__tests__/adminRouteAuthority.gate.test.ts`
 * ("wspólny layout `/admin` odsyła każdego bez `isStaff`"), który asertuje
 * w `ADMIN_LAYOUT` zarówno `isStaff`, jak i `navigate({ to: "/login" })` oraz
 * `if (!session || !isStaff) return null;`. Tutaj zostaje wyłącznie ta połowa
 * kontraktu, której tamten plik nie zna: że TA trasa faktycznie wisi pod
 * `/admin` i że nie dokłada własnej, rozjeżdżającej się bramki.
 *
 * ŚWIADOMIE POZA ZAKRESEM.
 * - Autorytet bazy: `admin_soft_delete_message`, `chat_purge_expired_messages`
 *   i kaskada FK na `conversations` są egzekwowane przez RPC/RLS. Test na
 *   atrapie nie odtwarza ich reguł - dowodzi tylko, że panel woła to, co mówi.
 * - Warstwa `@/lib/admin/community` (budowa zapytań PostgREST, zliczanie
 *   uczestników i wiadomości) - to osobny przedmiot dowodu, nie trasa.
 * - Formatowanie względnych dat (`date-fns`) - biblioteka ma własne testy.
 *
 * RODO: żadnych prawdziwych osób ani treści - identyfikatory z `CHAT_IDS`,
 * nazwy kręgów i treści wiadomości zmyślone.
 */
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import type { ConversationListItem, MessageRow } from "@/lib/admin/community";

const h = vi.hoisted(() => ({
  conversations: [] as ConversationListItem[],
  messages: [] as MessageRow[],
  /** Lista nigdy nie odpowiada - do dowodu o stanie ładowania. */
  listHangs: false,
  listCalls: [] as { limit?: number; search?: string }[],
  messageCalls: [] as string[],
  deleted: [] as string[],
  softDeleted: [] as string[],
  purgeCalls: 0,
  purgeCount: 0,
  /** Purge czeka na zwolnienie - do dowodu o blokadzie przycisku. */
  purgeHolds: false,
  releasePurge: null as (() => void) | null,
  deleteFails: false,
  softDeleteFails: false,
  toastSuccess: [] as string[],
  toastError: [] as string[],
}));

vi.mock("@/lib/admin/community", () => ({
  fetchAdminConversations: async (params: { limit?: number; search?: string }) => {
    h.listCalls.push(params);
    if (h.listHangs) await new Promise<void>(() => {});
    return h.conversations;
  },
  fetchConversationMessages: async (conversationId: string) => {
    h.messageCalls.push(conversationId);
    return h.messages;
  },
  deleteConversation: async (conversationId: string) => {
    h.deleted.push(conversationId);
    if (h.deleteFails) throw new Error("test: kasowanie odrzucone");
  },
  softDeleteMessage: async (messageId: string) => {
    h.softDeleted.push(messageId);
    if (h.softDeleteFails) throw new Error("test: ukrycie odrzucone");
  },
  purgeExpiredMessages: async () => {
    h.purgeCalls += 1;
    if (h.purgeHolds) {
      await new Promise<void>((resolve) => {
        h.releasePurge = resolve;
      });
    }
    return h.purgeCount;
  },
}));

vi.mock("sonner", () => ({
  toast: {
    success: (message: string) => h.toastSuccess.push(message),
    error: (message: string) => h.toastError.push(message),
  },
}));

import { renderRoute, routeMeta } from "@/test/routeHarness";
import { realT } from "@/test/i18nReal";
import { CHAT_IDS, conversationRow, messageRow } from "@/test/chat/fixtures";
import { adminCommunityPl } from "@/lib/i18n-admin-community";
import { Route } from "@/routes/admin.community.chat";

/** Napisy panelu moderacji - ze SŁOWNIKA, nie z literałów w teście. */
const chat = adminCommunityPl.adminCommunity.chat;
const t = realT("pl");

const ROUTE_PATH = "/admin/community/chat";
const ROUTE_FILE = "src/routes/admin.community.chat.tsx";

/**
 * Wiersz listy moderacji. `conversationRow` z fixtures daje kształt 1:1
 * z tabelą `conversations`; panel dokłada do niego dwa liczniki, więc fabryka
 * mieszka tutaj - nie wymyślamy własnego kształtu wiersza bazy.
 */
function adminConversation(overrides: Partial<ConversationListItem> = {}): ConversationListItem {
  return {
    ...conversationRow(overrides),
    participants_count: 2,
    messages_count: 7,
    ...overrides,
  };
}

/**
 * Wiersz `messages` w kształcie, którego oczekuje panel admina.
 *
 * `@/lib/chat/types` czyni `search_vector` opcjonalnym (klient nigdy nie
 * konstruuje kolumny FTS), a `@/lib/admin/community` używa surowego wiersza
 * bazy, w którym to pole jest WYMAGANE. Domknięcie jest tutaj jawne zamiast
 * rzutowania - typ pilnuje, że fixture nadal pasuje do obu odczytów.
 */
function adminMessage(overrides: Partial<MessageRow> = {}): MessageRow {
  return { ...messageRow(overrides), search_vector: null, ...overrides };
}

const mountChat = () => renderRoute({ route: Route, path: ROUTE_PATH, initialEntry: ROUTE_PATH });

/** Wiersz listy po widocznym tytule - do sięgnięcia po jego przycisk kosza. */
function conversationRowElement(title: string): HTMLElement {
  const opener = screen.getByRole("button", { name: new RegExp(title) });
  const row = opener.closest("li");
  if (!row) throw new Error("test: wiersz konwersacji nie ma kontenera <li>");
  return row;
}

/**
 * Kosz wiersza. STRAŻNIK, nie rzutowanie: kosz jest przyciskiem IKONOWYM bez
 * nazwy dostępnej (patrz `it.fails` na końcu pliku), więc jedyne stabilne
 * namierzenie to pozycja w wierszu - a to wymaga sprawdzenia w runtime, że
 * wiersz faktycznie ma dwa przyciski.
 */
function rowTrashButton(title: string): HTMLElement {
  const buttons = within(conversationRowElement(title)).getAllByRole("button");
  const trash = buttons[1];
  if (!trash) throw new Error("test: wiersz konwersacji nie ma przycisku kasowania");
  return trash;
}

beforeEach(() => {
  h.conversations = [];
  h.messages = [];
  h.listHangs = false;
  h.listCalls = [];
  h.messageCalls = [];
  h.deleted = [];
  h.softDeleted = [];
  h.purgeCalls = 0;
  h.purgeCount = 0;
  h.purgeHolds = false;
  h.releasePurge = null;
  h.deleteFails = false;
  h.softDeleteFails = false;
  h.toastSuccess = [];
  h.toastError = [];
});

afterEach(() => cleanup());

describe("moderacja czatu - sklejenie trasy i dostęp", () => {
  it("karta przeglądarki niesie tytuł panelu, a nie nazwę serwisu", async () => {
    // Panel ma kilkadziesiąt podstron; bez tytułu operator z otwartymi
    // zakładkami widzi kilka identycznych kart.
    const meta = await routeMeta(Route);
    const titles = meta.map((entry) => String(entry.title ?? ""));
    expect(titles.some((title) => title.includes("Chat") && title.includes("Admin"))).toBe(true);
  });

  it("trasa wisi pod `/admin`, więc chroni ją bramka `isStaff` z układu nadrzędnego", () => {
    // Dowodu na SAM layout tu nie powtarzamy - ma go
    // `adminRouteAuthority.gate.test.ts` ("wspólny layout `/admin` odsyła
    // każdego bez `isStaff`"). Tutaj pilnujemy drugiej połowy: że ta trasa
    // faktycznie jest dzieckiem `/admin` (a nie osobnym drzewem, do którego
    // tamta bramka nie sięga).
    const source = readFileSync(ROUTE_FILE, "utf8");
    expect(source).toMatch(/createFileRoute\("\/admin\/community\/chat"\)/);
    expect(ROUTE_PATH.startsWith("/admin/")).toBe(true);
  });

  it("trasa NIE dokłada własnej bramki roli - jedno miejsce decyduje o dostępie", () => {
    // Druga bramka w pliku trasy rozjeżdża się z layoutem przy pierwszej
    // zmianie ról i zaczyna odmawiać czegoś, do czego baza dopuszcza.
    const source = readFileSync(ROUTE_FILE, "utf8");
    expect(source).not.toMatch(/isAdmin|isSuperAdmin|isStaff|useAuth/);
  });
});

describe("moderacja czatu - lista konwersacji", () => {
  it("w trakcie pobierania mówi, że ładuje - nie udaje pustej bazy", async () => {
    h.listHangs = true;
    await mountChat();
    expect(await screen.findByText(chat.loading)).toBeInTheDocument();
    // Pustka i lista są WZAJEMNIE WYKLUCZAJĄCE ze stanem ładowania - inaczej
    // moderator zobaczyłby „brak konwersacji" na bazie pełnej rozmów.
    expect(screen.queryByText(chat.noConversations)).toBeNull();
  });

  it("pusta baza mówi wprost, że konwersacji nie ma", async () => {
    await mountChat();
    expect(await screen.findByText(chat.noConversations)).toBeInTheDocument();
  });

  it("wiersz pokazuje tytuł, podgląd i oba liczniki - to po nich moderator wybiera wątek", async () => {
    h.conversations = [
      adminConversation({
        id: CHAT_IDS.group,
        kind: "group",
        title: "Krąg testowy",
        last_message_preview: "Zmyślona treść podglądu",
        participants_count: 3,
        messages_count: 12,
      }),
    ];
    await mountChat();
    expect(await screen.findByText("Krąg testowy")).toBeInTheDocument();
    expect(screen.getByText("Zmyślona treść podglądu")).toBeInTheDocument();
    expect(screen.getByText(`${chat.participants}: 3`)).toBeInTheDocument();
    expect(screen.getByText(`${chat.msgs}: 12`)).toBeInTheDocument();
  });

  it("konwersacja bez tytułu jest opisana jako rozmowa 1:1, a pusty podgląd nazwany", async () => {
    h.conversations = [adminConversation({ title: null, last_message_preview: null })];
    await mountChat();
    expect(await screen.findByText(chat.directChat)).toBeInTheDocument();
    expect(screen.getByText(chat.noContent)).toBeInTheDocument();
  });

  it("plakietka TTL pojawia się WYŁĄCZNIE przy ustawionym `message_ttl_seconds`", async () => {
    // TTL to obietnica automatycznego kasowania. Plakietka na wątku bez TTL
    // mówiłaby moderatorowi, że treść zniknie sama - a ona zostanie na zawsze.
    h.conversations = [
      adminConversation({ id: "conv-ttl", title: "Wątek wygasający", message_ttl_seconds: 86_400 }),
      adminConversation({ id: "conv-bez-ttl", title: "Wątek wieczny", message_ttl_seconds: null }),
    ];
    await mountChat();
    await screen.findByText("Wątek wygasający");
    const zTtl = conversationRowElement("Wątek wygasający");
    const bezTtl = conversationRowElement("Wątek wieczny");
    expect(within(zTtl).getByText("TTL 24h")).toBeInTheDocument();
    expect(within(bezTtl).queryByText(/TTL/)).toBeNull();
  });

  it("fraza z wyszukiwarki podglądu trafia do warstwy danych", async () => {
    await mountChat();
    await screen.findByText(chat.noConversations);
    fireEvent.change(screen.getByPlaceholderText(chat.searchPreview), {
      target: { value: "zmyślona fraza" },
    });
    await waitFor(() =>
      expect(h.listCalls.some((call) => call.search === "zmyślona fraza")).toBe(true),
    );
  });
});

describe("moderacja czatu - podgląd wiadomości", () => {
  const conversation = () =>
    adminConversation({ id: CHAT_IDS.conversation, title: "Wątek do przejrzenia" });

  it("klik w wiersz otwiera podgląd i pyta bazę o wiadomości TEJ konwersacji", async () => {
    h.conversations = [conversation()];
    h.messages = [adminMessage({ body: "Zmyślona wiadomość jawna" })];
    await mountChat();
    fireEvent.click(await screen.findByRole("button", { name: /Wątek do przejrzenia/ }));
    await waitFor(() => expect(h.messageCalls).toEqual([CHAT_IDS.conversation]));
    expect(await screen.findByText("Zmyślona wiadomość jawna")).toBeInTheDocument();
  });

  it("konwersacja bez wiadomości mówi to wprost w podglądzie", async () => {
    h.conversations = [conversation()];
    await mountChat();
    fireEvent.click(await screen.findByRole("button", { name: /Wątek do przejrzenia/ }));
    expect(await screen.findByText(chat.noMessages)).toBeInTheDocument();
  });

  it("wiadomość ukryta pokazuje ZASTĘPNIK, nigdy treści - to sens ukrycia", async () => {
    h.conversations = [conversation()];
    h.messages = [
      adminMessage({ id: "msg-jawna", body: "Zmyślona wiadomość jawna" }),
      adminMessage({
        id: "msg-ukryta",
        body: "Zmyślona treść zgłoszona do moderacji",
        deleted_at: "2026-08-19T10:00:00.000Z",
      }),
    ];
    await mountChat();
    fireEvent.click(await screen.findByRole("button", { name: /Wątek do przejrzenia/ }));
    expect(await screen.findByText(chat.hidden)).toBeInTheDocument();
    expect(screen.queryByText("Zmyślona treść zgłoszona do moderacji")).toBeNull();
    // Sąsiadka nieukryta zostaje widoczna - ukrycie jest punktowe.
    expect(screen.getByText("Zmyślona wiadomość jawna")).toBeInTheDocument();
  });

  it("przycisk ukrycia stoi TYLKO przy wiadomości jeszcze nieukrytej", async () => {
    h.conversations = [conversation()];
    h.messages = [
      adminMessage({ id: "msg-jawna", body: "Zmyślona wiadomość jawna" }),
      adminMessage({ id: "msg-ukryta", deleted_at: "2026-08-19T10:00:00.000Z" }),
    ];
    await mountChat();
    fireEvent.click(await screen.findByRole("button", { name: /Wątek do przejrzenia/ }));
    await screen.findByText(chat.hidden);
    // Dwie wiadomości, jeden przycisk: powtórne ukrycie już ukrytej byłoby
    // pustym zapisem do bazy i myliłoby moderatora co do stanu wątku.
    expect(screen.getAllByTitle(chat.hideMessage)).toHaveLength(1);
  });

  it("ukrycie wiadomości idzie do bazy z jej identyfikatorem i potwierdza się operatorowi", async () => {
    h.conversations = [conversation()];
    h.messages = [adminMessage({ id: "msg-do-ukrycia", body: "Zmyślona wiadomość jawna" })];
    await mountChat();
    fireEvent.click(await screen.findByRole("button", { name: /Wątek do przejrzenia/ }));
    fireEvent.click(await screen.findByTitle(chat.hideMessage));
    await waitFor(() => expect(h.softDeleted).toEqual(["msg-do-ukrycia"]));
    await waitFor(() => expect(h.toastSuccess).toContain(chat.messageHidden));
  });

  it("odrzucone ukrycie mówi o błędzie - cisza sugerowałaby, że treść zniknęła", async () => {
    h.conversations = [conversation()];
    h.softDeleteFails = true;
    h.messages = [adminMessage({ id: "msg-do-ukrycia", body: "Zmyślona wiadomość jawna" })];
    await mountChat();
    fireEvent.click(await screen.findByRole("button", { name: /Wątek do przejrzenia/ }));
    fireEvent.click(await screen.findByTitle(chat.hideMessage));
    await waitFor(() => expect(h.toastError).toContain(chat.failed));
    expect(h.toastSuccess).toEqual([]);
  });
});

describe("moderacja czatu - kasowanie konwersacji wymaga potwierdzenia", () => {
  const conversation = () =>
    adminConversation({ id: CHAT_IDS.conversation, title: "Wątek do skasowania" });

  it("klik w kosz TYLKO pyta - kasowanie kaskadowe nie startuje z jednego kliknięcia", async () => {
    h.conversations = [conversation()];
    await mountChat();
    await screen.findByText("Wątek do skasowania");
    fireEvent.click(rowTrashButton("Wątek do skasowania"));
    expect(await screen.findByText(chat.deleteConfirmTitle)).toBeInTheDocument();
    // Okno mówi WPROST, co zniknie razem z konwersacją.
    expect(screen.getByText(chat.willRemoveConversationWith)).toBeInTheDocument();
    expect(h.deleted).toEqual([]);
  });

  it("anulowanie zamyka pytanie i NIE kasuje niczego", async () => {
    h.conversations = [conversation()];
    await mountChat();
    await screen.findByText("Wątek do skasowania");
    fireEvent.click(rowTrashButton("Wątek do skasowania"));
    fireEvent.click(await screen.findByRole("button", { name: chat.cancel }));
    await waitFor(() => expect(screen.queryByText(chat.deleteConfirmTitle)).toBeNull());
    expect(h.deleted).toEqual([]);
  });

  it("dopiero potwierdzenie kasuje konwersację i potwierdza to operatorowi", async () => {
    h.conversations = [conversation()];
    await mountChat();
    await screen.findByText("Wątek do skasowania");
    fireEvent.click(rowTrashButton("Wątek do skasowania"));
    fireEvent.click(await screen.findByRole("button", { name: chat.delete }));
    await waitFor(() => expect(h.deleted).toEqual([CHAT_IDS.conversation]));
    await waitFor(() => expect(h.toastSuccess).toContain(chat.conversationDeleted));
    // Pytanie znika po wykonaniu - inaczej moderator kliknąłby drugi raz.
    await waitFor(() => expect(screen.queryByText(chat.deleteConfirmTitle)).toBeNull());
  });

  it("odrzucone kasowanie mówi o błędzie zamiast udawać sukces", async () => {
    h.conversations = [conversation()];
    h.deleteFails = true;
    await mountChat();
    await screen.findByText("Wątek do skasowania");
    fireEvent.click(rowTrashButton("Wątek do skasowania"));
    fireEvent.click(await screen.findByRole("button", { name: chat.delete }));
    await waitFor(() => expect(h.toastError).toContain(chat.deleteFailed));
    expect(h.toastSuccess).toEqual([]);
  });

  it("kasowanie z podglądu też przechodzi przez potwierdzenie", async () => {
    // Ścieżka druga: przycisk w stopce podglądu. Gdyby ominęła pytanie,
    // bramka z wiersza byłaby dekoracją.
    h.conversations = [conversation()];
    await mountChat();
    fireEvent.click(await screen.findByRole("button", { name: /Wątek do skasowania/ }));
    fireEvent.click(await screen.findByRole("button", { name: chat.deleteConversation }));
    expect(await screen.findByText(chat.deleteConfirmTitle)).toBeInTheDocument();
    expect(h.deleted).toEqual([]);
  });
});

describe("moderacja czatu - czyszczenie wygasłych wiadomości", () => {
  it("purge woła bazę i mówi, ILE wyczyszczono", async () => {
    h.purgeCount = 3;
    await mountChat();
    fireEvent.click(await screen.findByRole("button", { name: chat.purge }));
    await waitFor(() => expect(h.purgeCalls).toBe(1));
    // Liczba jest treścią komunikatu, nie ozdobą: „wyczyszczono 0" i
    // „wyczyszczono 3000" to dwie różne informacje o stanie bazy.
    //
    // UWAGA: ta asercja mierzy LICZBĘ i to, że napis wychodzi ze słownika
    // (i18next nie oddał gołego klucza) - NIE stwierdza, że rzeczownik w tym
    // komunikacie jest poprawny. Nie jest; patrz `it.fails`
    // „komunikat po purge liczy wiadomości, nie konwersacje" w sekcji
    // „defekty zastane".
    const oczekiwany = t("adminCommunity.chat.purged", { count: 3 });
    await waitFor(() => expect(h.toastSuccess).toContain(oczekiwany));
    expect(oczekiwany).toContain("3");
  });

  it("przycisk purge jest zablokowany w trakcie mutacji - dwa kliki to dwa przebiegi", async () => {
    h.purgeHolds = true;
    await mountChat();
    const purge = await screen.findByRole("button", { name: chat.purge });
    fireEvent.click(purge);
    await waitFor(() => expect(purge).toBeDisabled());
    fireEvent.click(purge);
    expect(h.purgeCalls).toBe(1);

    const release = h.releasePurge;
    if (!release) throw new Error("test: purge nie wystartował, nie ma czego zwolnić");
    release();
    await waitFor(() => expect(purge).toBeEnabled());
  });
});

describe("moderacja czatu - defekty zastane", () => {
  /**
   * ZŁAMANY KONTRAKT: przycisk kasowania w wierszu listy jest przyciskiem
   * ikonowym BEZ nazwy dostępnej - nie ma `aria-label`, `title` ani tekstu,
   * a `<Trash2/>` nie wnosi nic do drzewa dostępności. Czytnik ekranu czyta
   * „przycisk", więc operator niewidomy nie odróżnia go od przycisku
   * otwierającego podgląd - a to przycisk KASUJĄCY KASKADOWO cudzą rozmowę.
   *
   * OCZEKIWANY KONTRAKT: każdy przycisk operacji niszczącej ma nazwę dostępną
   * (np. `aria-label={t("adminCommunity.chat.deleteConversation")}`, tak jak
   * przycisk ukrycia wiadomości niżej niesie `title`).
   *
   * Zapisane jako `it.fails`, bo naprawa wymaga zmiany pliku trasy, a ten test
   * nie zmienia zachowania produkcyjnego.
   */
  it.fails("kosz w wierszu listy ma nazwę dostępną", async () => {
    h.conversations = [adminConversation({ title: "Wątek do skasowania" })];
    await mountChat();
    await screen.findByText("Wątek do skasowania");
    const trash = rowTrashButton("Wątek do skasowania");
    const nazwa =
      trash.getAttribute("aria-label") ??
      trash.getAttribute("title") ??
      (trash.textContent ?? "").trim();
    expect(nazwa).not.toBe("");
  });

  /**
   * ZŁAMANY KONTRAKT: komunikat po czyszczeniu liczy ZŁĄ JEDNOSTKĘ.
   * Przycisk „Wyczyść" woła `purgeExpiredMessages`, czyli RPC
   * `chat_purge_expired_messages`, które robi `DELETE FROM public.messages`
   * i zwraca `ROW_COUNT` skasowanych WIADOMOŚCI (migracja
   * `20260712214155_2c3c6a7f-7c8b-4219-b807-29be470358a3.sql:378-390`).
   * Trasa podstawia tę liczbę pod klucz `adminCommunity.chat.purged`
   * = „Wyczyszczono {{count}} konwersacje" (`admin.community.chat.tsx:90`).
   * Operator czyta więc, że zniknęły 3 KONWERSACJE - czyli 3 całe wątki
   * z uczestnikami - podczas gdy zniknęły 3 pojedyncze wiadomości. Na ekranie,
   * którego drugi przycisk kasuje konwersacje kaskadowo, to nie jest literówka:
   * to fałszywy raport o zasięgu operacji niszczącej.
   *
   * DOWÓD, że to pomyłka, a nie decyzja: TEN SAM `purgeExpiredMessages`
   * w `src/routes/admin.community.index.tsx:86` jest opisany poprawnie kluczem
   * `adminCommunity.overview.purgedMessages` = „Wyczyszczono {{count}}
   * wiadomości". Dwa panele nazywają jedną operację sprzecznie.
   *
   * OCZEKIWANY KONTRAKT: komunikat liczy wiadomości - słownik ma już komplet
   * form `purgedMessages_*`, więc naprawa to podmiana klucza w trasie, bez
   * nowych tłumaczeń.
   *
   * Zapisane jako `it.fails`, bo naprawa wymaga zmiany pliku trasy, a ten test
   * nie zmienia zachowania produkcyjnego. Po naprawie ten test zacznie
   * przechodzić (czyli `it.fails` zgaśnie) - wtedy należy go zamienić
   * na zwykłe `it` i poprawić asercję w teście „purge woła bazę i mówi, ILE
   * wyczyszczono".
   */
  it.fails("komunikat po purge liczy wiadomości, nie konwersacje", async () => {
    h.purgeCount = 3;
    await mountChat();
    fireEvent.click(await screen.findByRole("button", { name: chat.purge }));
    await waitFor(() => expect(h.toastSuccess).toHaveLength(1));
    expect(h.toastSuccess[0]).toBe(t("adminCommunity.overview.purgedMessages", { count: 3 }));
  });
});
