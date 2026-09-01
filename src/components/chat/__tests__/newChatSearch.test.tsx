// Wyszukiwarka ODBIORCÓW nowej wiadomości (`NewChatSearch`) i przypięty wiersz
// podglądu (`DemoBotListItem`) - dwa pliki, które przed tym testem miały
// dokładne ZERO pokrycia (0/22 linii i 0/3 linii), a stoi na nich jedyna droga
// od „Nowa wiadomość" do otwartego wątku.
//
// CO JEST PRZEDMIOTEM DOWODU:
//   - pusta fraza pokazuje PODPOWIEDŹ KATALOGU, a nie „nie znaleziono osób"
//     (użytkownik, który jeszcze nic nie wpisał, nie może dostać werdyktu
//     o nieistniejącej frazie) i nie miga tym komunikatem przed odpowiedzią,
//   - wpisana fraza leci do wyszukiwarki odbiorców `search_chat_contacts`
//     PRZYCIĘTA, z limitem 12 - bez argumentu tenanta i bez argumentu
//     użytkownika, bo zakres liczy serwer,
//   - trafienie rysuje nazwę, stanowisko i firmę, a klik otwiera wątek przez
//     `get_or_create_direct_conversation` i oddaje rodzicowi identyfikator,
//   - werdykty serwera (poza siecią / awaria / bramka tiera / bramka eksperta)
//     mapują się na WŁAŚCIWY komunikat albo na świadome milczenie,
//   - ZAKRES = SIEĆ KONTAKTÓW: dowód po stronie klienta jest taki, że lista to
//     dokładnie wiersze zwrócone przez RPC - komponent nie dokłada nikogo
//     z zatrutego cache'u react-query (ani z klucza `people`, ani z `peers`).
//
// POZA ZAKRESEM ŚWIADOMIE:
//   - reguły serwera (kto jest w sieci, tiery, blokady) mieszkają w migracjach
//     i testach SQL; tutaj atrapą jest dopiero klient Supabase, bo to jedyny
//     poziom, na którym widać NAZWY funkcji i NAZWY argumentów,
//   - presence (`useOnlineUsers`) ma własny plik `src/lib/chat/__tests__/
//     presence.test.tsx` - tu liczy się wyłącznie to, że komponent CZYTA zbiór,
//   - debounce 250 ms nie jest mierzony zegarem: dowodzimy skutku (ostatnie
//     wywołanie RPC niesie przyciętą frazę), nie liczby timerów.
//
// RODO: wszystkie osoby zmyślone, adresy wyłącznie w domenie `example.com`.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@/lib/i18n-chat";
import "@/lib/i18n-expert-request";
import { chatPl } from "@/lib/i18n-chat";
import { expertRequestPl } from "@/lib/i18n-expert-request";
import { CHAT_IDS, chatContactHit, ok, peerProfileMap, peerProfile } from "@/test/chat/fixtures";
import { chatKeys } from "@/lib/chat/keys";
import type { ChatContactHit } from "@/lib/chat/types";

const h = vi.hoisted(() => ({
  rpc: null as ReturnType<typeof import("@/test/supabase/rpc").supabaseRpcStub> | null,
  /** Bramki opóźniające ODPOWIEDŹ RPC (samo wywołanie zapisuje się od razu). */
  gates: {} as Record<string, Promise<void> | undefined>,
  online: new Set<string>() as ReadonlySet<string>,
  toastError: [] as Array<{ message: unknown; options: unknown }>,
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: async (name: string, args?: Record<string, unknown>) => {
      if (h.rpc === null) throw new Error("test: atrapa RPC nie została ustawiona");
      const result = await h.rpc.rpc(name, args);
      const gate = h.gates[name];
      if (gate) await gate;
      return result;
    },
    // Wyszukiwarka odbiorców i otwarcie wątku idą WYŁĄCZNIE przez RPC
    // (SECURITY DEFINER). Gdyby ktoś podmienił je na łańcuch PostgREST - czyli
    // na zapytanie zakresowane przez klienta, a nie przez serwer - test pada
    // tutaj, a nie na cicho przepuszczonym wyniku.
    from: (table: string) => {
      throw new Error(`test: nieoczekiwany SELECT na "${table}"`);
    },
  },
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: { id: CHAT_IDS.me, email: "jan.przykladowy@example.com" },
    tenantId: CHAT_IDS.tenant,
  }),
}));

vi.mock("@/lib/chat/presence", () => ({ useOnlineUsers: () => h.online }));

vi.mock("sonner", () => ({
  toast: {
    error: (message: unknown, options?: unknown) => {
      h.toastError.push({ message, options });
    },
    success: () => {},
  },
}));

import { supabaseRpcStub } from "@/test/supabase/rpc";
import { subscribeExpertRequestDialog } from "@/lib/chat/expertRequestDialogBus";
import { NewChatSearch } from "../NewChatSearch";
import { DemoBotListItem } from "../DemoBotListItem";

const t = chatPl.chat;
const gateDict = expertRequestPl.expertRequest.chatGate;

/** Trzy zmyślone osoby z sieci kontaktów wołającego. */
const ZOFIA = chatContactHit({
  id: "user-zofia",
  display_name: "Zofia Testowa",
  slug: "zofia-testowa",
  job_title: "Analityczka",
  current_company: "Instytut Przykładowy",
  verified: true,
});
const JAN = chatContactHit({
  id: "user-jan",
  display_name: "Jan Przykładowy",
  slug: "jan-przykladowy",
  job_title: "Doradca",
  current_company: "Biuro Testowe",
  verified: false,
});
/** Osoba bez wypełnionej roli i firmy - RPC zwraca puste łańcuchy, nie NULL. */
const EWA = chatContactHit({
  id: "user-ewa",
  display_name: "Ewa Zmyślona",
  slug: "ewa-zmyslona",
  job_title: "",
  current_company: "",
  verified: false,
});

function rpcStub(): ReturnType<typeof supabaseRpcStub> {
  if (h.rpc === null) throw new Error("test: atrapa RPC nie została ustawiona");
  return h.rpc;
}

/** Odpowiedź katalogu zależna od FRAZY - inaczej nie da się odróżnić przebiegu
 *  dla pustego pola od przebiegu po wpisaniu frazy. */
function contactsByQuery(byQuery: Record<string, ChatContactHit[]>): void {
  rpcStub().setResponse("search_chat_contacts", (call) => {
    const query = typeof call.arg("p_query") === "string" ? String(call.arg("p_query")) : "";
    return ok(byQuery[query] ?? []);
  });
}

/** Bramka otwierana ręcznie - do dowodu na stan „otwieram rozmowę". */
function deferred(): { promise: Promise<void>; open: () => void } {
  let open: () => void = () => {};
  const promise = new Promise<void>((resolve) => {
    open = () => resolve();
  });
  return { promise, open };
}

function renderSearch(seed?: (client: QueryClient) => void) {
  const onOpened = vi.fn();
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  seed?.(client);
  const view = render(
    <QueryClientProvider client={client}>
      <NewChatSearch onOpened={onOpened} />
    </QueryClientProvider>,
  );
  return { ...view, onOpened, client };
}

function searchInput(): HTMLInputElement {
  const el = screen.getByLabelText(t.searchPeoplePlaceholder);
  if (!(el instanceof HTMLInputElement)) {
    throw new Error("test: wyszukiwarka odbiorców nie jest polem tekstowym");
  }
  return el;
}

function typePhrase(value: string): void {
  fireEvent.change(searchInput(), { target: { value } });
}

/**
 * Wiersze wyniku. Świadomie po `ul > li`, a NIE po roli `listitem`: odznaka
 * weryfikacji (`ProfileBadges`) też deklaruje `role="listitem"`, więc liczenie
 * po roli mieszałoby osoby z ich odznakami.
 */
function resultRows(): Element[] {
  return Array.from(document.querySelectorAll("ul > li"));
}

/** Przycisk wiersza osoby - nazwa dostępna zawiera imię i nazwisko. */
function personRow(name: string): Promise<HTMLElement> {
  return screen.findByRole("button", { name: new RegExp(name) });
}

beforeEach(() => {
  h.rpc = supabaseRpcStub();
  contactsByQuery({});
  h.rpc.setData("get_or_create_direct_conversation", CHAT_IDS.conversation);
  h.gates = {};
  h.online = new Set<string>();
  h.toastError = [];
});

afterEach(() => {
  cleanup();
});

describe("NewChatSearch - pusta fraza", () => {
  it("bez wpisanej frazy pokazuje podpowiedź katalogu, a NIE werdykt o pustym wyniku", async () => {
    renderSearch();

    expect(await screen.findByText(chatPl.people.emptyDirectory)).toBeInTheDocument();
    // „Nie znaleziono osób dla tej frazy" przy pustym polu byłoby kłamstwem -
    // żadna fraza jeszcze nie padła.
    expect(screen.queryByText(chatPl.people.empty)).toBeNull();
    expect(resultRows()).toHaveLength(0);
  });

  it("zanim serwer odpowie, komunikat o pustym katalogu NIE miga", async () => {
    const gate = deferred();
    h.gates.search_chat_contacts = gate.promise;

    renderSearch();

    // Stan wczytywania nie ma prawa udawać werdyktu - inaczej każde otwarcie
    // „Nowej wiadomości" błyska „katalog jest pusty".
    expect(screen.queryByText(chatPl.people.emptyDirectory)).toBeNull();
    expect(screen.queryByText(chatPl.people.empty)).toBeNull();
    expect(resultRows()).toHaveLength(0);

    gate.open();
    expect(await screen.findByText(chatPl.people.emptyDirectory)).toBeInTheDocument();
  });

  it("pole startuje puste i jest opisane dla czytnika ekranu", () => {
    renderSearch();
    const input = searchInput();
    expect(input.value).toBe("");
    expect(input.getAttribute("placeholder")).toBe(t.searchPeoplePlaceholder);
  });
});

describe("NewChatSearch - zapytanie do wyszukiwarki odbiorców", () => {
  it("wpisana fraza leci PRZYCIĘTA do search_chat_contacts, z limitem 12", async () => {
    contactsByQuery({ Zofia: [ZOFIA] });
    renderSearch();

    typePhrase("   Zofia   ");

    await waitFor(() => {
      const call = rpcStub().lastCall("search_chat_contacts");
      if (!call) throw new Error("test: brak wywołania search_chat_contacts");
      expect(call.arg("p_query")).toBe("Zofia");
    });
    const call = rpcStub().lastCall("search_chat_contacts");
    if (!call) throw new Error("test: brak wywołania search_chat_contacts");
    expect(call.arg("p_limit")).toBe(12);
    // Białe znaki nie mogą tworzyć osobnego zapytania - inaczej każda spacja
    // to kolejny przejazd do bazy po ten sam wynik.
    expect(await personRow("Zofia Testowa")).toBeInTheDocument();
  });

  it("wyszukiwarka odbiorców to search_chat_contacts, nie katalog osób", async () => {
    contactsByQuery({ Zofia: [ZOFIA] });
    renderSearch();

    typePhrase("Zofia");
    await personRow("Zofia Testowa");

    // Katalogowy `search_people` pokazywałby osoby SPOZA sieci kontaktów -
    // czyli takie, do których `get_or_create_direct_conversation` i tak odmówi.
    expect(rpcStub().names()).not.toContain("search_people");
    expect(rpcStub().callsFor("search_chat_contacts").length).toBeGreaterThan(0);
  });

  it("wynik rysuje nazwę oraz stanowisko i firmę w jednym podpisie", async () => {
    contactsByQuery({ Zofia: [ZOFIA] });
    renderSearch();

    typePhrase("Zofia");

    expect(await screen.findByText("Zofia Testowa")).toBeInTheDocument();
    expect(screen.getByText("Analityczka - Instytut Przykładowy")).toBeInTheDocument();
  });

  it("osoba bez roli i firmy NIE dostaje pustego, wiszącego podpisu", async () => {
    // Obie osoby naraz, żeby asercja nie mogła przejść „na sucho": podpis ma
    // istnieć DOKŁADNIE raz - dla Zofii, nie dla Ewy.
    contactsByQuery({ a: [ZOFIA, EWA] });
    const { container } = renderSearch();

    typePhrase("a");
    await personRow("Ewa Zmyślona");

    const subtitles = container.querySelectorAll("span.text-muted-foreground");
    expect(subtitles).toHaveLength(1);
    expect(subtitles[0].textContent).toBe("Analityczka - Instytut Przykładowy");
  });

  it("obecność rozmówcy widać na avatarze wiersza", async () => {
    h.online = new Set<string>([ZOFIA.id]);
    contactsByQuery({ Zofia: [ZOFIA, JAN] });
    const { container } = renderSearch();

    typePhrase("Zofia");
    await personRow("Zofia Testowa");

    // Dokładnie jedna kropka: druga osoba jest offline.
    expect(container.querySelectorAll("span.bg-emerald-500")).toHaveLength(1);
  });

  it("fraza bez trafień pokazuje komunikat o braku osób, a nie pustą listę", async () => {
    contactsByQuery({});
    renderSearch();

    typePhrase("nieistniejąca fraza");

    expect(await screen.findByText(chatPl.people.empty)).toBeInTheDocument();
    expect(screen.queryByText(chatPl.people.emptyDirectory)).toBeNull();
    expect(resultRows()).toHaveLength(0);
  });

  // DEFEKT PRODUKCYJNY.
  // ZŁAMANY KONTRAKT: gdy `search_chat_contacts` ODMÓWI (błąd bazy, brak
  // uprawnień, awaria sieci), `usePeopleSearch` oddaje `data === undefined`,
  // komponent czyta `peopleQ.data ?? []` i renderuje DOKŁADNIE ten sam ekran
  // co pusty wynik: „Nie znaleziono osób dla tej frazy". Użytkownik dostaje
  // fałszywy werdykt o swojej sieci kontaktów zamiast informacji o awarii,
  // więc nie ponawia próby - a wyszukiwarka wygląda na sprawną.
  // OCZEKIWANY KONTRAKT: przy `peopleQ.isError` komponent pokazuje komunikat
  // awarii (w słowniku jest już `people.loadError` + `people.retry`) i NIE
  // pokazuje komunikatu o pustym wyniku.
  it.fails("odmowa serwera nazywa AWARIĘ, a nie brak osób w sieci kontaktów", async () => {
    rpcStub().setError("search_chat_contacts", "chat: contacts search failed", "P0001");
    renderSearch();

    typePhrase("Zofia");

    // Stan, w którym komponent się dziś zatrzymuje po odmowie serwera:
    await screen.findByText(chatPl.people.empty);
    // ...i tu pada kontrakt - awaria jest nieodróżnialna od pustego wyniku.
    expect(screen.queryByText(chatPl.people.loadError)).not.toBeNull();
  });
});

describe("NewChatSearch - otwieranie rozmowy", () => {
  it("klik w osobę otwiera wątek bezpośredni i oddaje rodzicowi identyfikator", async () => {
    contactsByQuery({ Zofia: [ZOFIA] });
    const { onOpened } = renderSearch();

    typePhrase("Zofia");
    fireEvent.click(await personRow("Zofia Testowa"));

    await waitFor(() => expect(onOpened).toHaveBeenCalledWith(CHAT_IDS.conversation));
    const call = rpcStub().lastCall("get_or_create_direct_conversation");
    if (!call) throw new Error("test: brak wywołania get_or_create_direct_conversation");
    // Klient przekazuje wyłącznie odbiorcę - reszta zakresu jest serwerowa.
    expect(call.keys()).toEqual(["p_peer_id"]);
    expect(call.arg("p_peer_id")).toBe(ZOFIA.id);
  });

  it("w trakcie otwierania wiersze gasną - drugi klik nie zakłada drugiej rozmowy", async () => {
    const gate = deferred();
    h.gates.get_or_create_direct_conversation = gate.promise;
    contactsByQuery({ Zofia: [ZOFIA, JAN] });
    const { onOpened } = renderSearch();

    typePhrase("Zofia");
    const row = await personRow("Zofia Testowa");
    fireEvent.click(row);

    await waitFor(() => expect(row).toBeDisabled());
    expect(await personRow("Jan Przykładowy")).toBeDisabled();
    fireEvent.click(row);
    expect(rpcStub().callsFor("get_or_create_direct_conversation")).toHaveLength(1);

    gate.open();
    await waitFor(() => expect(onOpened).toHaveBeenCalledWith(CHAT_IDS.conversation));
  });

  it("odmowa 'poza siecią kontaktów' nazywa PRZYCZYNĘ, a lista zostaje na ekranie", async () => {
    contactsByQuery({ Zofia: [ZOFIA] });
    rpcStub().setError("get_or_create_direct_conversation", "chat: peer not in your network");
    const { onOpened } = renderSearch();

    typePhrase("Zofia");
    fireEvent.click(await personRow("Zofia Testowa"));

    await waitFor(() => expect(h.toastError).toHaveLength(1));
    expect(h.toastError[0].message).toBe(t.notInNetwork);
    expect(onOpened).not.toHaveBeenCalled();
    // Nieudane otwarcie nie może kosztować wyniku wyszukiwania.
    expect(await personRow("Zofia Testowa")).toBeInTheDocument();
  });

  it("inna awaria serwera dostaje ogólny komunikat o nieudanym otwarciu", async () => {
    contactsByQuery({ Zofia: [ZOFIA] });
    rpcStub().setError("get_or_create_direct_conversation", "deadlock detected", "40P01");
    const { onOpened } = renderSearch();

    typePhrase("Zofia");
    fireEvent.click(await personRow("Zofia Testowa"));

    await waitFor(() => expect(h.toastError).toHaveLength(1));
    expect(h.toastError[0].message).toBe(t.startError);
    expect(onOpened).not.toHaveBeenCalled();
  });

  it("bramka tiera proponuje plany zamiast nagiego błędu", async () => {
    contactsByQuery({ Zofia: [ZOFIA] });
    rpcStub().setError("get_or_create_direct_conversation", "chat: tier disabled");
    renderSearch();

    typePhrase("Zofia");
    fireEvent.click(await personRow("Zofia Testowa"));

    await waitFor(() => expect(h.toastError).toHaveLength(1));
    expect(h.toastError[0].message).toBe(gateDict.tierDisabledToast);
    const options = h.toastError[0].options;
    if (typeof options !== "object" || options === null || !("action" in options)) {
      throw new Error("test: toast bramki tiera nie niesie akcji");
    }
    const action = options.action;
    if (typeof action !== "object" || action === null || !("label" in action)) {
      throw new Error("test: akcja toastu bramki tiera nie ma etykiety");
    }
    expect(action.label).toBe(gateDict.openPricing);
  });

  it("bramka eksperta MILCZY toastem - dialog zapytania otwiera się z busa", async () => {
    contactsByQuery({ Zofia: [ZOFIA] });
    rpcStub().setError("get_or_create_direct_conversation", "chat: expert requires request");
    const prefills: Array<string | null> = [];
    const unsubscribe = subscribeExpertRequestDialog((prefill) => {
      prefills.push(prefill?.recipientId ?? null);
    });
    try {
      renderSearch();

      typePhrase("Zofia");
      fireEvent.click(await personRow("Zofia Testowa"));

      await waitFor(() => expect(prefills).toContain(ZOFIA.id));
      // Toast obok otwartego dialogu to podwójny komunikat o tej samej rzeczy.
      expect(h.toastError).toHaveLength(0);
    } finally {
      unsubscribe();
    }
  });
});

describe("NewChatSearch - zakres to WYŁĄCZNIE sieć kontaktów", () => {
  it("klient nie wysyła argumentu tenanta ani użytkownika - nie ma czego podrobić", async () => {
    contactsByQuery({ Zofia: [ZOFIA] });
    renderSearch();

    typePhrase("Zofia");
    await personRow("Zofia Testowa");

    const call = rpcStub().lastCall("search_chat_contacts");
    if (!call) throw new Error("test: brak wywołania search_chat_contacts");
    expect(call.keys()).toEqual(["p_query", "p_limit"]);
    expect(call.has("p_tenant_id")).toBe(false);
    expect(call.has("p_user_id")).toBe(false);
  });

  it("lista to DOKŁADNIE wiersze serwera - nikt z cache'u profili się nie dokłada", async () => {
    const fromMyNetwork: ChatContactHit[] = [ZOFIA, JAN];
    contactsByQuery({ a: fromMyNetwork });

    renderSearch((client) => {
      // Cache react-query zatruty osobą SPOZA sieci kontaktów: raz pod kluczem
      // wyszukiwarki (inna fraza), raz pod kluczem kart profilowych. Gdyby
      // komponent czytał cokolwiek poza wynikiem bieżącego RPC, „Borys Obcy"
      // pojawiłby się na liście odbiorców.
      client.setQueryData(chatKeys.people(CHAT_IDS.me, "obcy:12"), [
        chatContactHit({ id: CHAT_IDS.stranger, display_name: "Borys Obcy" }),
      ]);
      client.setQueryData(
        chatKeys.peers(CHAT_IDS.me, [CHAT_IDS.stranger]),
        peerProfileMap([peerProfile({ id: CHAT_IDS.stranger, display_name: "Borys Obcy" })]),
      );
    });

    typePhrase("a");
    await personRow("Zofia Testowa");

    await waitFor(() => expect(resultRows()).toHaveLength(fromMyNetwork.length));
    expect(screen.queryByText("Borys Obcy")).toBeNull();
    for (const person of fromMyNetwork) {
      expect(screen.getByText(person.display_name)).toBeInTheDocument();
    }
  });
});

describe("DemoBotListItem", () => {
  it("wiersz podglądu niesie nazwę wątku, plakietkę demo i zapowiedź treści", () => {
    render(<DemoBotListItem active={false} onOpen={vi.fn()} />);

    expect(screen.getByText(t.demoBot.name)).toBeInTheDocument();
    expect(screen.getByText(t.demoBot.badge)).toBeInTheDocument();
    expect(screen.getByText(t.demoBot.preview)).toBeInTheDocument();
    // Wiersz jest przypięty nad realnymi rozmowami - plakietka to mówi.
    expect(screen.getByLabelText(t.menu.pinnedBadge)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: t.demoBot.openAria })).toBeInTheDocument();
  });

  it("stan AKTYWNY wyróżnia wiersz tłem, a nieaktywny zostaje przy podświetleniu na najechanie", () => {
    const { rerender } = render(<DemoBotListItem active={true} onOpen={vi.fn()} />);
    const active = screen.getByRole("button", { name: t.demoBot.openAria });
    expect(active.className).toContain("bg-muted");
    expect(active.className).not.toContain("hover:bg-muted/60");

    rerender(<DemoBotListItem active={false} onOpen={vi.fn()} />);
    const inactive = screen.getByRole("button", { name: t.demoBot.openAria });
    expect(inactive.className).toContain("hover:bg-muted/60");
  });

  it("klik otwiera podgląd - to jedyne wyjście z tego wiersza", () => {
    const onOpen = vi.fn();
    render(<DemoBotListItem active={false} onOpen={onOpen} />);

    fireEvent.click(screen.getByRole("button", { name: t.demoBot.openAria }));

    expect(onOpen).toHaveBeenCalledTimes(1);
    // Wiersz demo NIE dotyka bazy - żadnego RPC ani SELECT-a.
    expect(rpcStub().calls).toHaveLength(0);
  });
});
