// Przestrzeń robocza członka: JEDEN pasek na całej szerokości dolnej krawędzi
// ekranu i JEDEN panel otwarty naraz nad paskiem.
//
// Pasek działa jak rozwijane zakładki (expandable tabs): aktywna pozycja
// płynnie rozszerza się i pokazuje etykietę obok ikony, nieaktywne zostają
// samymi ikonami. Wszystkie elementy mają promień 6px i jednakowy odstęp
// 6px (gap-1.5). Po lewej skróty nawigacyjne (sieć, czaty, start, kluby,
// profil), po separatorze narzędzia członka (zadania, notatki, zapisane,
// kalendarz). Czat nie jest w narzędziach, bo jest skrótem.
//
// Zasady:
//  - tylko dla zalogowanych, nigdy w /admin i /login (jak ChatDock),
//  - pasek sam publikuje `--mbb-space` na <html>, więc stopka i ostatni
//    akapit treści nigdy nie chowają się pod paskiem,
//  - panele są lazy - pierwsze wejście nie pobiera ich kodu,
//  - ostatnio używane narzędzie zapamiętujemy lokalnie (nie w bazie).
//
// ── CO TEN PLIK PRZESTAŁ ROBIĆ (i dlaczego to było ważne) ────────────────
// Miał 485 linii i trzymał w sobie cztery rzeczy, z których każda ma teraz
// własny moduł, bo każda ma własny powód istnienia i własny test:
//
//   `ExpandableTab`      -> molecules/ExpandableTab.tsx  (ruch w CSS, `memo`)
//   `MinimizedChats`     -> molecules/MinimizedChats.tsx (bramka na sieć)
//   `TabSeparator`       -> atoms/DockTabSeparator.tsx
//   `useReservedSpace`   -> lib/dock/useDockReservedSpace.ts (pomiar + SSR)
//
// Zniknęły też trzy defekty, które dały się zobaczyć tylko przez rozdzielenie
// tych warstw:
//
//  1. `framer-motion`. To był JEDYNY plik w repozytorium, który wciągał tę
//     bibliotekę - przy ośmiu komponentach, które ŚWIADOMIE odwzorowały jej
//     animacje w CSS, żeby jej w projekcie nie mieć. Kosztowała 164 moduły /
//     ~772 kB ESM na drodze do PIERWSZEGO malowania paska, bo nie jest
//     osiągalna statycznie z żadnej trasy, więc nie leżała w gotowym chunku.
//     Ruch robi teraz warstwa `.wd-*` w `styles.css`.
//  2. ODCZYT `localStorage` W CIELE RENDERU (`readLastTool`) - jedyny taki
//     w całym `src/`. Dziś nie dawał rozjazdu hydratacji tylko dlatego, że
//     dok w ogóle nie renderuje się na serwerze (sesja rozstrzyga się
//     w efekcie `useAuth`); jako render nieczysty był jednak zawsze zły
//     i stawał się realnym rozjazdem w dniu, w którym sesja zostałaby
//     zasiana z ciasteczka. Teraz odczyt jest w efekcie.
//  3. ZAPIS PRZY MONTAŻU KASOWAŁ TO, CO MIAŁ PAMIĘTAĆ.
//     `useEffect(() => writeLastTool(storage, state.open), [state.open])`
//     biegł też przy montażu, a `state.open` jest wtedy `null`, więc
//     `writeLastTool(storage, null)` wołało `removeItem`. Każde wejście na
//     stronę czyściło zapamiętane narzędzie - funkcja z komentarza wyżej nie
//     działała ANI RAZU. Zapis idzie teraz z procedury obsługi zdarzenia,
//     czyli stamtąd, skąd pochodzi decyzja użytkownika.
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { useRouterState } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Bookmark, CalendarDays, ListTodo, NotebookPen } from "lucide-react";

import { useAuth } from "@/hooks/useAuth";
import { TooltipProvider } from "@/components/ui/tooltip";
import { onOpenChatWindow } from "@/lib/chat/chatDockBus";
import { type DockToolId } from "@/lib/dock/types";
import { dockReducer, initialDockState, readLastTool, writeLastTool } from "@/lib/dock/dockState";
import { useDockReservedSpace } from "@/lib/dock/useDockReservedSpace";
import { useDockPresence } from "@/lib/dock/useDockPresence";
import { useDockEscape, useDockFocusReturn } from "@/lib/dock/useDockDismiss";
import { prefetchDockData } from "@/lib/dock/prefetchDockData";
import { siteMonth } from "@/lib/dock/calendarGrid";
import { useOpenTodoCount } from "@/lib/dock/useTodos";
import { useSiteSetting } from "@/lib/useSiteSetting";
import { uiLang } from "@/lib/i18n/format";
import {
  activeBottomBarIndex,
  bottomBarHref,
  bottomBarLabel,
  MOBILE_BOTTOM_BAR_DEFAULTS,
  MOBILE_BOTTOM_BAR_SETTINGS_KEY,
  visibleBottomBarItems,
  type MobileBottomBarConfig,
} from "@/lib/mobileBottomBar/config";
import { cn } from "@/lib/utils";
import { DockTabSeparator } from "./atoms/DockTabSeparator";
import { DockDrawerSkeleton, DockPanelSkeleton } from "./atoms/DockPanelSkeleton";
import { ExpandableTab } from "./molecules/ExpandableTab";
import { MinimizedChats } from "./molecules/MinimizedChats";
import {
  loadCalendarPanel,
  loadChatSideDrawer,
  loadNotesPanel,
  loadSavedPanel,
  loadTodoPanel,
  prefetchDockPanel,
} from "./panelChunks";
import "@/lib/i18n-dock";
import "@/lib/i18n-mobile-bottom-bar";

// Ścieżki importu należą do `panelChunks.ts` - tutaj zostają same granice.
const TodoPanel = lazy(loadTodoPanel);
const NotesPanel = lazy(loadNotesPanel);
const SavedPanel = lazy(loadSavedPanel);
const CalendarPanel = lazy(loadCalendarPanel);
const ChatSideDrawer = lazy(loadChatSideDrawer);

// Czat ma własną, wysuwaną skrzynkę z lewej krawędzi, więc nie jest jednym
// z narzędzi otwieranych nad paskiem.
type MemberTool = Exclude<DockToolId, "chat" | "readLater">;
const MEMBER_TOOLS: MemberTool[] = ["todos", "notes", "saved", "calendar"];

const ICONS: Record<MemberTool, typeof ListTodo> = {
  todos: ListTodo,
  notes: NotebookPen,
  saved: Bookmark,
  calendar: CalendarDays,
};

/** Identyfikator regionu panelu - wiąże zakładkę z panelem (`aria-controls`). */
const PANEL_ID = "workspace-dock-panel";

/**
 * Skrzynka czatu ma WŁASNY identyfikator. Zakładka „Czat" wskazywała wcześniej
 * `PANEL_ID`, czyli region, który przy otwartej skrzynce nie istnieje w drzewie -
 * `aria-controls` prowadzące w pustkę jest gorsze niż jego brak, bo czytnik
 * ekranu obiecuje użytkownikowi przejście, którego nie da się wykonać.
 */
const DRAWER_ID = "workspace-dock-chat";

/** Wysokość zapasowa, gdy pomiar jeszcze nie doszedł (pasek ma ~33-38 px). */
const FALLBACK_BAR_HEIGHT = 40;

export function WorkspaceDock() {
  const { t, i18n } = useTranslation();
  const lang = uiLang(i18n.language);
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const queryClient = useQueryClient();
  const [state, dispatch] = useReducer(dockReducer, initialDockState);
  // Odczyt bieżącego stanu BEZ wciągania go do zależności `openTool` - inaczej
  // domknięcie zmieniałoby tożsamość przy każdym otwarciu panelu i `memo`
  // na zakładkach przerysowywałoby wszystkie czternaście.
  const stateRef = useRef(state);
  stateRef.current = state;
  const { ref: barRef, height: barHeight } = useDockReservedSpace();
  const { user } = useAuth();

  // Jedyna powierzchnia rozmów: kliknięcie "Napisz" gdziekolwiek w serwisie
  // (szyna chatDockBus) otwiera lewą skrzynkę z wybraną konwersacją.
  //
  // BEZ `Date.now()`. Poprzednia wersja dokładała do żądania znacznik czasu
  // „na przezbrojenie", ale odbiorca zależy od TOŻSAMOŚCI obiektu, a nie od
  // pola - świeży literał sam wystarcza. Zegar w rozdzielczości milisekundy
  // i tak nie różnicował dwóch wysłań w tej samej milisekundzie, a dok ma
  // dobry powód być powierzchnią bez odczytu zegara.
  const [pendingChat, setPendingChat] = useState<{ conversationId: string } | null>(null);
  useEffect(
    () =>
      onOpenChatWindow((request) => {
        setPendingChat({ conversationId: request.conversationId });
        dispatch({ type: "open", tool: "chat" });
      }),
    [],
  );

  const rawConfig = useSiteSetting<MobileBottomBarConfig>(
    MOBILE_BOTTOM_BAR_SETTINGS_KEY,
    MOBILE_BOTTOM_BAR_DEFAULTS,
  );
  const shortcuts = useMemo(() => visibleBottomBarItems(rawConfig), [rawConfig]);
  const activeShortcut = activeBottomBarIndex(shortcuts, pathname);
  const shortcutById = useMemo(() => {
    const map = new Map<string, (typeof shortcuts)[number]>();
    for (const item of shortcuts) map.set(item.id, item);
    return map;
  }, [shortcuts]);
  const activeId = activeShortcut >= 0 ? shortcuts[activeShortcut]?.id : undefined;

  // Ostatnie narzędzie tylko PODŚWIETLAMY - nie otwieramy panelu bez akcji
  // użytkownika, żeby wejście na stronę nie przysłaniało treści.
  //
  // Odczyt idzie EFEKTEM, nie z ciała renderu: pierwszy render musi dać ten
  // sam wynik na serwerze i na kliencie, a magazyn lokalny jest stanem,
  // którego React nie śledzi.
  const [lastTool, setLastTool] = useState<DockToolId | null>(null);
  useEffect(() => {
    setLastTool(readLastTool(window.localStorage));
  }, []);

  const openTodos = useOpenTodoCount();

  // Miesiąc do rozgrzania kalendarza. Strefa serwisu, nie maszyny - ten sam
  // dzień, który drukuje reszta serwisu.
  const currentMonth = useMemo<[number, number]>(() => siteMonth(), []);

  /**
   * Zapis „ostatnio używanego" idzie STĄD, czyli z decyzji użytkownika -
   * nie z efektu obserwującego stan. Efekt biegł także przy montażu i wtedy
   * kasował zapamiętaną wartość (`state.open` jest wtedy `null`).
   */
  const remember = useCallback((tool: DockToolId | null) => {
    setLastTool(tool);
    writeLastTool(window.localStorage, tool);
  }, []);

  const focus = useDockFocusReturn();

  // Zamknięcie ODDAJE ognisko uwagi. `closingTool` pamięta, która zakładka
  // je otwierała, żeby zapas („wróć na zakładkę") miał gdzie trafić także po
  // przebudowie paska.
  const closingTool = useRef<DockToolId | null>(null);
  const close = useCallback(() => {
    dispatch({ type: "close" });
    focus.restore(closingTool.current);
  }, [focus]);

  const openTool = useCallback(
    (tool: DockToolId) => {
      // Przełącznik: to samo narzędzie zamyka panel, inne go podmienia.
      // Punkt powrotu zapamiętujemy TYLKO przy otwieraniu.
      const willOpen = stateRef.current.open !== tool;
      if (willOpen) {
        focus.capture();
        closingTool.current = tool;
      }
      dispatch({ type: "toggle", tool });
      remember(willOpen ? tool : null);
      if (!willOpen) focus.restore(tool);
    },
    [focus, remember],
  );

  /** Rozgrzanie paczki I danych z jednego zamiaru - patrz `panelChunks.ts`. */
  const warm = useCallback(
    (tool: DockToolId) => {
      prefetchDockPanel(tool);
      prefetchDockData(queryClient, tool, user?.id, currentMonth);
    },
    [queryClient, user?.id, currentMonth],
  );

  const onToolPress = useCallback((id: string) => openTool(id as DockToolId), [openTool]);
  const onToolPrefetch = useCallback((id: string) => warm(id as DockToolId), [warm]);
  const onChatPress = useCallback(() => openTool("chat"), [openTool]);
  const onChatPrefetch = useCallback(() => warm("chat"), [warm]);

  const openInbox = useCallback(() => {
    focus.capture();
    closingTool.current = "chat";
    dispatch({ type: "open", tool: "chat" });
  }, [focus]);

  // Panel i skrzynka dostają fazę wejścia/wyjścia, więc zamknięcie ma ruch,
  // a nie znika w jednej klatce.
  const toolOpen = state.open !== null && state.open !== "chat";
  const panel = useDockPresence(toolOpen, "panel");
  const drawer = useDockPresence(state.open === "chat", "drawer");

  // JEDEN nasłuch Escape na całą powierzchnię doku - nie dwa, jak wcześniej
  // (panel przez `DockPanelShell`, skrzynka u siebie). Reducer trzyma
  // pojedyncze `open`, więc panel i skrzynka nigdy nie są zamontowane razem
  // i drugi nasłuch nie miałby czego obsłużyć. Kluczowe jest to, że ten
  // nasłuch USTĘPUJE warstwom Radiksa - patrz `useDockDismiss.ts`.
  useDockEscape(state.open !== null, close);

  // KTÓRE NARZĘDZIE POKAZUJEMY W FAZIE WYJŚCIA. `state.open` jest już `null`,
  // a panel ma jeszcze dogrywać wyjście - bez zapamiętania ostatniego
  // narzędzia poddrzewo zniknęłoby natychmiast i faza `exiting` animowałaby
  // pusty prostokąt.
  const [shownTool, setShownTool] = useState<MemberTool | null>(null);
  useEffect(() => {
    if (state.open !== null && state.open !== "chat") setShownTool(state.open as MemberTool);
  }, [state.open]);

  const offset = barHeight || FALLBACK_BAR_HEIGHT;

  // Ostateczna bramka: dok to przestrzeń robocza członka; nawet jeśli ktoś
  // użyje komponentu poza SiteChrome, nie renderujemy go dla gości.
  if (!user) return null;

  const shortcutTab = (id: string, opts?: { center?: boolean; compact?: boolean }) => {
    const item = shortcutById.get(id);
    if (!item) return null;
    const label = bottomBarLabel(item, lang, (key) => t(key));
    // Czat nie przenosi na osobną stronę - wysuwa skrzynkę z lewej krawędzi,
    // więc jest zakładką PANELU (przycisk + `aria-expanded`). Pozostałe skróty
    // to NAWIGACJA, czyli prawdziwe linki - patrz `ExpandableTab`.
    if (item.id === "chats") {
      return (
        <ExpandableTab
          key={id}
          kind="panel"
          id={id}
          label={label}
          active={state.open === "chat"}
          center={opts?.center}
          compact={opts?.compact}
          onPress={onChatPress}
          onPrefetch={onChatPrefetch}
          iconName={item.icon || "circle"}
          badgeSource={item.badge}
          controls={DRAWER_ID}
        />
      );
    }
    return (
      <ExpandableTab
        key={id}
        kind="nav"
        id={id}
        label={label}
        active={item.id === activeId}
        center={opts?.center}
        compact={opts?.compact}
        href={bottomBarHref(item, lang)}
        iconName={item.icon || "circle"}
        badgeSource={item.badge}
      />
    );
  };

  const toolTab = (tool: MemberTool, opts?: { compact?: boolean }) => {
    const active = state.open === tool;
    return (
      <ExpandableTab
        key={tool}
        kind="panel"
        id={tool}
        label={t(`dock.tools.${tool}`)}
        active={active}
        compact={opts?.compact}
        highlighted={!active && lastTool === tool}
        onPress={onToolPress}
        onPrefetch={onToolPrefetch}
        Icon={ICONS[tool]}
        badgeCount={tool === "todos" ? openTodos : 0}
        badgeLabel={tool === "todos" ? t("dock.todos.openCount", { count: openTodos }) : undefined}
        controls={PANEL_ID}
      />
    );
  };

  return (
    // JEDEN dostawca podpowiedzi na cały pasek, nie jeden na zakładkę.
    // `Tooltip` z `ui/tooltip` sam stawia sobie zasięgowego dostawcę, gdy
    // żadnego nie ma nad nim - poprawnie (i jest na to test), ale wtedy
    // czternaście zakładek to czternaście niezależnych grup, więc
    // `skipDelayDuration` nie działa
    // i przesunięcie kursora z zakładki na zakładkę odczekuje pełne 200 ms
    // za każdym razem. Wspólny dostawca sprawia, że pierwsza podpowiedź
    // czeka, a kolejne pokazują się natychmiast - tak zachowuje się każdy
    // dojrzały pasek narzędzi.
    <TooltipProvider delayDuration={250} skipDelayDuration={400}>
      {/* `inert` W FAZIE WYJŚCIA. Poddrzewo zostaje w drzewie jeszcze
          140-160 ms, żeby dograć ruch - i przez ten czas jest niewidoczne,
          ale nadal FOKUSOWALNE. Bez `inert` tabulator wchodziłby w panel,
          który dla użytkownika już nie istnieje. React 19 przekazuje ten
          atrybut wprost, więc nie trzeba go dopisywać efektem. */}
      {drawer.mounted ? (
        <div id={DRAWER_ID} inert={drawer.state === "exiting" ? true : undefined}>
          <Suspense fallback={<DockDrawerSkeleton bottomOffset={offset} />}>
            <ChatSideDrawer
              onClose={close}
              bottomOffset={offset}
              openRequest={pendingChat}
              presenceState={drawer.state}
            />
          </Suspense>
        </div>
      ) : null}

      {panel.mounted && shownTool !== null ? (
        <div
          className="pointer-events-none fixed inset-x-0 z-40 flex justify-center px-3 sm:justify-end sm:px-4"
          style={{ bottom: `calc(${offset}px + 8px)` }}
        >
          <div
            id={PANEL_ID}
            data-state={panel.state}
            inert={panel.state === "exiting" ? true : undefined}
            className="wd-panel pointer-events-none flex w-full justify-center sm:w-auto sm:justify-end"
          >
            <Suspense fallback={<DockPanelSkeleton />}>
              {shownTool === "todos" && <TodoPanel onClose={close} />}
              {shownTool === "notes" && <NotesPanel onClose={close} />}
              {shownTool === "saved" && <SavedPanel onClose={close} lang={lang} />}
              {shownTool === "calendar" && <CalendarPanel onClose={close} lang={lang} />}
            </Suspense>
          </div>
        </div>
      ) : null}

      <div
        ref={barRef}
        data-workspace-dock
        className="wd-bar fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card/95 backdrop-blur"
        style={{
          paddingBottom: "env(safe-area-inset-bottom, 0px)",
          // Nazwany snapshot View Transitions: bez niego pasek wchodzi do
          // migawki korzenia i jest przenikany przy KAŻDEJ nawigacji, choć
          // jest nakładką, która się nie zmienia. Regułę „bez animacji"
          // trzyma `styles.css` obok bliźniaczego wpisu dla doku czatu.
          viewTransitionName: "workspace-dock",
        }}
      >
        {/* JEDEN LANDMARK NA CAŁY PASEK.
            Rząd mobilny i desktopowy są OBA zamontowane (jeden schowany
            klasą), więc dwa `<nav>` o tej samej nazwie dostępnej dawały
            DWA landmarki nawigacyjne o identycznej nazwie - naruszenie
            `landmark-unique`, wychwycone przez axe. Przy wczytanych stylach
            jeden z nich ma `display: none`, czyli wypada z drzewa dostępności,
            ale poprawność nie może zależeć od tego, czy arkusz dojechał; nie
            da się też wybrać „tego widocznego" w JS, bo punkt przełamania
            zna wyłącznie CSS, a odczyt szerokości w renderze byłby rozjazdem
            hydratacji. Jeden landmark wokół obu rzędów rozwiązuje to
            bezwarunkowo - grupa narzędzi zostaje osobnym `role="toolbar"`
            z własną nazwą, co jest poprawnym zagnieżdżeniem. */}
        <nav aria-label={t("dock.workspace")} className="relative">
          <MinimizedChats onOpenInbox={openInbox} />
          {/* Mobile: Home dokładnie na środku, po lewej Network i Czat,
            po prawej Zapisane i Klub - wszystkie jako rozwijane zakładki
            z odstępem 6px. */}
          <div className="wd-nav flex items-center justify-center gap-1.5 overflow-x-auto px-1.5 py-1 sm:hidden">
            {shortcutTab("network", { compact: true })}
            {shortcutTab("chats", { compact: true })}
            {shortcutTab("home", { center: true, compact: true })}
            {toolTab("saved", { compact: true })}
            {shortcutTab("clubs", { compact: true })}
          </div>

          {/* Desktop: skróty | separator | narzędzia, jedna wycentrowana grupa. */}
          <div className="hidden items-center justify-center gap-2 px-4 py-1.5 sm:flex">
            {/* Hierarchia: skróty nawigacyjne jako główna grupa... */}
            <div
              role="group"
              aria-label={t("dock.shortcuts")}
              className="wd-nav flex items-center gap-1.5"
            >
              {shortcuts.map((item) => shortcutTab(item.id))}
            </div>
            <DockTabSeparator />
            {/* ...a narzędzia członka w wyciszonej, wydzielonej pigułce.
                `role="toolbar"` + orientacja: to jest grupa przycisków
                sterujących JEDNYM regionem, więc czytnik ekranu ma prawo
                ogłosić ją jako pasek narzędzi, a nie jako drugą nawigację. */}
            <div
              role="toolbar"
              aria-orientation="horizontal"
              aria-label={t("dock.toolbar")}
              className={cn(
                "wd-nav flex items-center gap-1.5 rounded-md bg-muted/40 px-1.5 py-0.5",
              )}
            >
              {MEMBER_TOOLS.map((tool) => toolTab(tool))}
            </div>
          </div>
        </nav>
      </div>
    </TooltipProvider>
  );
}
