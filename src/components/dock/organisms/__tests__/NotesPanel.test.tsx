// NOTATNIK DOKU - do tego przebiegu panel miał około 2% pokrycia, choć niesie
// umowy, których nie pilnuje NIC innego w repozytorium:
//
//   1. KOLEJNOŚĆ GAŁĘZI: błąd -> oczekiwanie -> puste -> lista. Własny
//      nagłówek pliku produkcyjnego mówi wprost, że „Notatnik jest pusty"
//      pojawiało się także wtedy, gdy notatki były jeszcze w drodze - czyli
//      panel zapraszał do napisania notatki, którą użytkownik już miał.
//      Dowodzimy każdej gałęzi osobno i tego, że wcześniejsza wygrywa.
//   2. WIĄZANIE Z MATERIAŁEM. Notatkę można przypiąć do tego, co użytkownik
//      właśnie czyta. Cała obietnica jest warunkowa i ŻYWA: pole przypięcia
//      i zakładki zakresu istnieją wyłącznie wtedy, gdy kontekst jest
//      ustawiony, pojawiają się bez przemontowania panelu (magazyn modułowy
//      przez `useSyncExternalStore`, bez providera), a przypięcie zapisuje
//      KOMPLET czterech kolumn - i tak samo komplet czterech zeruje przy
//      odłączeniu. Pominięcie jednej z nich zostawia w bazie sierotę.
//   3. EDYCJA W MIEJSCU MA WYJŚCIE AWARYJNE. „Anuluj" nie może wysłać nic
//      i musi przywrócić wartości sprzed edycji - inaczej jedyną drogą
//      wyjścia z pomyłki jest zapisanie jej.
//
// Warstwę danych zostawiamy PRAWDZIWĄ (`@/lib/dock/useNotes`), a podmieniamy
// dopiero klienta Supabase - dzięki temu asercje dotyczą ładunku, który
// naprawdę poszedłby do PostgREST, a nie kształtu wymyślonej atrapy hooka.
// Magazyn kontekstu też jest prawdziwy (jest synchroniczny i ma czyszczenie),
// bo to właśnie jego związek z panelem jest tu dowodzony.
//
// Napisy czytamy ze słownika (`dockPl`), nigdy z literału - inaczej asercja
// mierzy to, co ktoś wpisał w komponencie, a nie to, co jest w tłumaczeniach.
// Treść notatek jest wymyślona na potrzeby testu.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@/test/i18nReal";
import { dockPl } from "@/lib/i18n-dock";
import { FIXED_NOW_ISO, freezeClock } from "@/test/time";
import { axeViolations, summarize } from "@/test/axe";
import { fail, ok, supabaseFromStub } from "@/test/supabaseChain";
import { clearNoteContext, setNoteContext } from "@/lib/dock/noteContext";
import type { UserNote } from "@/lib/dock/types";

// Panel zegara nie czyta, ale wiersze notatek niosą znaczniki czasu -
// zamrożenie trzyma je w tym samym punkcie co reszta suity.
freezeClock();

const auth = vi.hoisted(() => ({ user: { id: "member" } as { id: string } | null }));
const db = supabaseFromStub();

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => auth }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: (table: string) => db.from(table) },
}));

import { NotesPanel } from "../NotesPanel";

/** Baza trzyma `entity_id` jako uuid - inny identyfikator hook zeruje. */
const MATERIAL_ID = "11111111-1111-4111-8111-111111111111";
const MATERIAL = {
  entityType: "post" as const,
  entityId: MATERIAL_ID,
  title: "Raport o rynku energii",
  url: "/analizy/rynek-energii",
};

// Wiersze, które atrapa odda przy każdym odczycie. Trzymamy je w zmiennej,
// bo po udanej mutacji hook unieważnia zapytanie i notatnik czyta PONOWNIE -
// dzięki temu test może pokazać, co użytkownik zobaczy PO zapisie.
let rows: UserNote[] = [];

const note = (id: string, patch: Partial<UserNote> = {}): UserNote => ({
  id,
  title: `Notatka ${id}`,
  body: "",
  color: "amber",
  pinned: false,
  entity_type: null,
  entity_id: null,
  entity_title: null,
  entity_url: null,
  created_at: FIXED_NOW_ISO,
  updated_at: FIXED_NOW_ISO,
  ...patch,
});

beforeEach(() => {
  auth.user = { id: "member" };
  rows = [];
  db.reset();
  db.setResponse("user_notes", () => ok(rows));
});

afterEach(() => {
  cleanup();
  clearNoteContext();
  vi.restoreAllMocks();
});

function renderPanel() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const onClose = vi.fn();
  const view = render(
    <QueryClientProvider client={client}>
      <NotesPanel onClose={onClose} />
    </QueryClientProvider>,
  );
  return { ...view, client, onClose };
}

/** Karta notatki po jej widocznym tytule - globalne zapytania w tym pliku
 *  są niepewne, bo etykieta pola tytułu bywa JEDNOCZEŚNIE nagłówkiem karty. */
function card(title: string): HTMLElement {
  const node = screen.getByText(title).closest("li");
  if (!node) throw new Error(`brak karty notatki: ${title}`);
  return node;
}

const titleField = () => screen.getAllByLabelText(dockPl.dock.notes.newTitle)[0];
const bodyField = () => screen.getAllByLabelText(dockPl.dock.notes.newBody)[0];
const addButton = () => screen.getByRole("button", { name: dockPl.dock.notes.add });

const chainsWith = (method: string) =>
  db.chainsFor("user_notes").filter((chain) => chain.has(method));
const lastInsert = (): unknown => chainsWith("insert").at(-1)?.argsOf("insert")?.[0];
const lastUpdate = (): unknown => chainsWith("update").at(-1)?.argsOf("update")?.[0];

describe("NotesPanel", () => {
  it("stan oczekiwania nie udaje pustego notatnika", async () => {
    const { container } = renderPanel();
    // Ta asercja MUSI paść przed pierwszym `await` - to jedyna klatka,
    // w której zapytanie jest jeszcze w drodze.
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(screen.queryByText(dockPl.dock.notes.empty)).toBeNull();

    expect(await screen.findByText(dockPl.dock.notes.empty)).toBeInTheDocument();
    expect(container.querySelector('[aria-busy="true"]')).toBeNull();
  });

  it("błąd odczytu zasłania i szkielet, i pusty stan", async () => {
    db.setResponse("user_notes", fail("permission denied"));
    const { container } = renderPanel();

    expect(await screen.findByText(dockPl.dock.error)).toBeInTheDocument();
    expect(screen.queryByText(dockPl.dock.notes.empty)).toBeNull();
    expect(container.querySelector('[aria-busy="true"]')).toBeNull();
  });

  it("pusty formularz nic nie wysyła, a wypełniony idzie przycięty i czyści pola", async () => {
    renderPanel();
    await screen.findByText(dockPl.dock.notes.empty);

    // Same spacje to wciąż brak treści - zapis nie może ruszyć.
    fireEvent.change(titleField(), { target: { value: "   " } });
    fireEvent.change(bodyField(), { target: { value: "  \n " } });
    fireEvent.click(addButton());
    expect(chainsWith("insert")).toHaveLength(0);

    fireEvent.change(titleField(), { target: { value: "  Tezy na panel o energii  " } });
    fireEvent.change(bodyField(), { target: { value: "  Trzy pytania do moderatora.  " } });
    fireEvent.click(addButton());

    await waitFor(() =>
      expect(lastInsert()).toEqual({
        user_id: "member",
        title: "Tezy na panel o energii",
        body: "Trzy pytania do moderatora.",
        color: "amber",
        pinned: false,
        entity_type: null,
        entity_id: null,
        entity_title: null,
        entity_url: null,
      }),
    );
    expect(titleField()).toHaveValue("");
    expect(bodyField()).toHaveValue("");
  });

  it("bez kontekstu materiału nie ma ani przypięcia, ani zakładek zakresu", async () => {
    renderPanel();
    await screen.findByText(dockPl.dock.notes.empty);

    expect(screen.queryByText(dockPl.dock.notes.attach)).toBeNull();
    expect(screen.queryByText(dockPl.dock.notes.scope.all)).toBeNull();
    expect(screen.queryByText(dockPl.dock.notes.scope.material)).toBeNull();
  });

  it("kontekst materiału pojawia się na żywo i przypina notatkę do czytanego materiału", async () => {
    renderPanel();
    await screen.findByText(dockPl.dock.notes.empty);
    expect(screen.queryByText(dockPl.dock.notes.attach)).toBeNull();

    // Bez przemontowania panelu: widok materiału publikuje kontekst w trakcie
    // życia notatnika i to ma wystarczyć, żeby propozycja przypięcia wyszła.
    act(() => setNoteContext(MATERIAL));

    expect(screen.getByText(dockPl.dock.notes.attach)).toBeInTheDocument();
    expect(screen.getByText(MATERIAL.title)).toBeInTheDocument();
    const attach = screen.getByRole("checkbox");
    expect(attach).toBeChecked();

    fireEvent.change(titleField(), { target: { value: "Cytat do wykorzystania" } });
    fireEvent.click(addButton());
    await waitFor(() =>
      expect(lastInsert()).toEqual(
        expect.objectContaining({
          title: "Cytat do wykorzystania",
          entity_type: "post",
          entity_id: MATERIAL_ID,
          entity_title: MATERIAL.title,
          entity_url: MATERIAL.url,
        }),
      ),
    );

    // Odznaczenie to świadoma decyzja „notatka luźna" - komplet kolumn zerowy.
    fireEvent.click(attach);
    expect(attach).not.toBeChecked();
    fireEvent.change(titleField(), { target: { value: "Sprawa na osobno" } });
    fireEvent.click(addButton());
    await waitFor(() =>
      expect(lastInsert()).toEqual(
        expect.objectContaining({
          title: "Sprawa na osobno",
          entity_type: null,
          entity_id: null,
          entity_title: null,
          entity_url: null,
        }),
      ),
    );
  });

  it("zakres „ten materiał" zawęża listę do notatek przypiętych do niego", async () => {
    rows = [
      note("zwiazana", {
        title: "Liczby do akapitu o cenach",
        entity_type: "post",
        entity_id: MATERIAL_ID,
        entity_title: MATERIAL.title,
        entity_url: MATERIAL.url,
      }),
      note("luzna", { title: "Zadzwonić w sprawie sali" }),
    ];
    setNoteContext(MATERIAL);
    renderPanel();
    await screen.findByText("Liczby do akapitu o cenach");
    expect(screen.getByText("Zadzwonić w sprawie sali")).toBeInTheDocument();

    fireEvent.click(screen.getByText(dockPl.dock.notes.scope.material));
    expect(screen.getByText("Liczby do akapitu o cenach")).toBeInTheDocument();
    expect(screen.queryByText("Zadzwonić w sprawie sali")).toBeNull();

    fireEvent.click(screen.getByText(dockPl.dock.notes.scope.all));
    expect(screen.getByText("Zadzwonić w sprawie sali")).toBeInTheDocument();
  });

  it("przypięcie i odpięcie notatki wysyła wartość odwróconą i przestawia etykietę", async () => {
    rows = [note("n1", { title: "Wnioski z rozmowy" })];
    renderPanel();
    const otwarta = card(await screen.findByText("Wnioski z rozmowy").then(() => "Wnioski z rozmowy"));

    fireEvent.click(within(otwarta).getByLabelText(dockPl.dock.notes.pin));
    // Baza po zapisie odda notatkę przypiętą - hook unieważnia i czyta ponownie.
    rows = [note("n1", { title: "Wnioski z rozmowy", pinned: true })];
    await waitFor(() => expect(lastUpdate()).toEqual({ pinned: true }));

    const odepnij = await screen.findByLabelText(dockPl.dock.notes.unpin);
    expect(screen.queryByLabelText(dockPl.dock.notes.pin)).toBeNull();

    fireEvent.click(odepnij);
    await waitFor(() => expect(lastUpdate()).toEqual({ pinned: false }));
  });

  it("kliknięcie karteczki zmienia wyłącznie kolor", async () => {
    rows = [note("n1", { title: "Szkic wstępu" })];
    renderPanel();
    const karta = card(await screen.findByText("Szkic wstępu").then(() => "Szkic wstępu"));

    fireEvent.click(within(karta).getByLabelText(`${dockPl.dock.notes.color}: rose`));

    await waitFor(() => expect(lastUpdate()).toEqual({ color: "rose" }));
  });

  it("edycja w miejscu zapisuje tytuł i treść, a potem wraca do trybu odczytu", async () => {
    rows = [note("n1", { title: "Stary tytuł", body: "Stara treść" })];
    renderPanel();
    const karta = card(await screen.findByText("Stary tytuł").then(() => "Stary tytuł"));

    fireEvent.click(within(karta).getByText(dockPl.dock.notes.edit));
    fireEvent.change(within(karta).getByLabelText(dockPl.dock.notes.newTitle), {
      target: { value: "Nowy tytuł" },
    });
    fireEvent.change(within(karta).getByLabelText(dockPl.dock.notes.newBody), {
      target: { value: "Nowa treść" },
    });
    fireEvent.click(within(karta).getByText(dockPl.dock.notes.save));

    await waitFor(() => expect(lastUpdate()).toEqual({ title: "Nowy tytuł", body: "Nowa treść" }));
    // Po zapisie pola edycji znikają - zostaje jedno pole tytułu, formularza.
    expect(screen.getAllByLabelText(dockPl.dock.notes.newTitle)).toHaveLength(1);
  });

  it("anulowanie edycji nie wysyła nic i przywraca wartości sprzed edycji", async () => {
    rows = [note("n1", { title: "Tytuł roboczy", body: "Treść robocza" })];
    renderPanel();
    const karta = card(await screen.findByText("Tytuł roboczy").then(() => "Tytuł roboczy"));

    fireEvent.click(within(karta).getByText(dockPl.dock.notes.edit));
    fireEvent.change(within(karta).getByLabelText(dockPl.dock.notes.newTitle), {
      target: { value: "Pomyłka" },
    });
    fireEvent.click(within(karta).getByText(dockPl.dock.notes.cancel));

    expect(chainsWith("update")).toHaveLength(0);
    expect(screen.getByText("Tytuł roboczy")).toBeInTheDocument();

    // Dowód, że „Anuluj" naprawdę cofnęło stan pola, a nie tylko zamknęło tryb.
    fireEvent.click(within(karta).getByText(dockPl.dock.notes.edit));
    expect(within(karta).getByLabelText(dockPl.dock.notes.newTitle)).toHaveValue("Tytuł roboczy");
    expect(within(karta).getByLabelText(dockPl.dock.notes.newBody)).toHaveValue("Treść robocza");
  });

  it("odłączenie od materiału zeruje wszystkie cztery kolumny powiązania", async () => {
    rows = [
      note("n1", {
        title: "Kontrargument do tezy trzeciej",
        entity_type: "post",
        entity_id: MATERIAL_ID,
        entity_title: MATERIAL.title,
        entity_url: MATERIAL.url,
      }),
    ];
    renderPanel();
    const karta = card(
      await screen.findByText("Kontrargument do tezy trzeciej").then(
        () => "Kontrargument do tezy trzeciej",
      ),
    );

    fireEvent.click(within(karta).getByLabelText(dockPl.dock.notes.unlink));

    await waitFor(() =>
      expect(lastUpdate()).toEqual({
        entity_type: null,
        entity_id: null,
        entity_title: null,
        entity_url: null,
      }),
    );
  });

  it("powiązanie z adresem jest odnośnikiem, bez adresu - zwykłym tekstem, a braki spadają na teksty zastępcze", async () => {
    rows = [
      note("z-adresem", {
        title: "Z odnośnikiem",
        entity_type: "post",
        entity_id: MATERIAL_ID,
        entity_title: MATERIAL.title,
        entity_url: MATERIAL.url,
      }),
      note("bez-adresu", {
        title: "",
        entity_type: "document",
        entity_id: MATERIAL_ID,
        entity_title: null,
        entity_url: null,
      }),
    ];
    renderPanel();

    const zAdresem = card(await screen.findByText("Z odnośnikiem").then(() => "Z odnośnikiem"));
    const odnosnik = within(zAdresem).getByRole("link");
    expect(odnosnik).toHaveAttribute("href", MATERIAL.url);
    expect(odnosnik).toHaveTextContent(MATERIAL.title);

    // Notatka bez tytułu bierze za nagłówek etykietę pola tytułu, a powiązanie
    // bez nazwy - zastępczy napis „powiązany materiał". Oba napisy są wtedy
    // na ekranie po kilka razy; dlatego zapytania są zawężone do karty.
    const bezAdresu = card(dockPl.dock.notes.linked);
    expect(within(bezAdresu).queryByRole("link")).toBeNull();
    expect(within(bezAdresu).getByText(dockPl.dock.notes.newTitle)).toBeInTheDocument();
  });

  it("usunięcie notatki wysyła jej identyfikator i zdejmuje kartę z listy", async () => {
    rows = [note("n1", { title: "Do wyrzucenia" })];
    renderPanel();
    const karta = card(await screen.findByText("Do wyrzucenia").then(() => "Do wyrzucenia"));

    fireEvent.click(within(karta).getByLabelText(dockPl.dock.notes.remove));
    rows = [];

    await waitFor(() =>
      expect(chainsWith("delete").at(-1)?.argsOf("eq")).toEqual(["id", "n1"]),
    );
    expect(await screen.findByText(dockPl.dock.notes.empty)).toBeInTheDocument();
  });

  it("zamknięcie panelu woła onClose dokładnie raz", async () => {
    const { onClose } = renderPanel();
    await screen.findByText(dockPl.dock.notes.empty);

    fireEvent.click(screen.getByLabelText(dockPl.dock.close));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("pełny notatnik z kontekstem nie ma naruszeń dostępności", async () => {
    rows = [
      note("n1", {
        title: "Notatka z powiązaniem",
        body: "Treść widoczna w karcie.",
        pinned: true,
        entity_type: "post",
        entity_id: MATERIAL_ID,
        entity_title: MATERIAL.title,
        entity_url: MATERIAL.url,
      }),
    ];
    setNoteContext(MATERIAL);
    const { container } = renderPanel();
    await screen.findByText("Notatka z powiązaniem");

    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });

  // DEFEKT 1. `submit` czyści oba pola BEZWARUNKOWO, zaraz po `create.mutate`,
  // a panel nie renderuje `create.isError`. Gdy zapis padnie (RLS, brak sieci),
  // użytkownik zostaje z pustym formularzem, bez komunikatu i bez możliwości
  // ponowienia - napisany tekst przepada. Test opisuje zachowanie oczekiwane:
  // treść zostaje w polu, dopóki zapis się nie powiedzie.
  it.fails("DEFEKT: nieudany zapis notatki kasuje wpisany tekst", async () => {
    db.setResponse("user_notes", (chain) =>
      chain.has("insert") ? fail("permission denied") : ok(rows),
    );
    renderPanel();
    await screen.findByText(dockPl.dock.notes.empty);

    fireEvent.change(titleField(), { target: { value: "Godzina spotkania w czwartek" } });
    fireEvent.click(addButton());

    await waitFor(() => expect(chainsWith("insert")).toHaveLength(1));
    expect(titleField()).toHaveValue("Godzina spotkania w czwartek");
  });

  // DEFEKT 2. Zakładki zakresu niosą swój stan WYŁĄCZNIE kolorem tła - nie ma
  // tu `aria-pressed`, choć taki sam rząd w panelu zadań (`dock.todos.tabs`)
  // i w zapisanych (`dock.saved.filters`) go ma. Czytnik ekranu ogłasza dwa
  // nieodróżnialne przyciski, więc użytkownik klawiatury nie wie, czy patrzy
  // na wszystkie notatki, czy tylko na te z bieżącego materiału (WCAG 1.4.1).
  it.fails("DEFEKT: zakładki zakresu nie ogłaszają, która jest wybrana", async () => {
    setNoteContext(MATERIAL);
    renderPanel();
    await screen.findByText(dockPl.dock.notes.empty);

    fireEvent.click(screen.getByText(dockPl.dock.notes.scope.material));

    expect(screen.getByText(dockPl.dock.notes.scope.material)).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });
});
