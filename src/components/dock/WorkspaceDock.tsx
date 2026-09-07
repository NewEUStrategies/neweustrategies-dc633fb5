// Przestrzeń robocza członka: JEDEN pasek na całej szerokości dolnej krawędzi
// ekranu i JEDEN panel otwarty naraz nad paskiem.
//
// Pasek scala dwie warstwy, które wcześniej żyły osobno:
//   1. skróty nawigacyjne konfigurowane przez tenanta w
//      site_settings[key="mobile_bottom_bar"] (dawny <MobileBottomBar />),
//   2. narzędzia członka: czat, zadania, notatki, zapisane, kalendarz,
//      do przeczytania.
//
// Zasady:
//  - tylko dla zalogowanych, nigdy w /admin i /login (jak ChatDock),
//  - pasek sam publikuje `--mbb-space` na <html>, więc stopka i ostatni
//    akapit treści nigdy nie chowają się pod paskiem,
//  - panele są lazy - pierwsze wejście nie pobiera ich kodu,
//  - ostatnio używane narzędzie zapamiętujemy lokalnie (nie w bazie).
import { lazy, Suspense, useCallback, useEffect, useReducer, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useRouterState } from "@tanstack/react-router";
import {
  Bookmark,
  BookOpen,
  CalendarDays,
  ListTodo,
  MessageCircle,
  NotebookPen,
} from "lucide-react";
import { AppLink } from "@/components/atoms/AppLink";
import { DynamicIcon } from "@/lib/icons/DynamicIcon";
import { LiveTabBadge } from "@/components/mobile/bottomBar/LiveTabBadge";
import { DOCK_TOOLS, type DockToolId } from "@/lib/dock/types";
import { dockReducer, initialDockState, readLastTool, writeLastTool } from "@/lib/dock/dockState";
import { useOpenTodoCount } from "@/lib/dock/useTodos";
import { useUnreadLaterCount } from "@/lib/dock/useReadLater";
import { useChatUnreadTotal } from "@/lib/chat/useConversations";
import { useSiteSetting } from "@/lib/useSiteSetting";
import {
  MOBILE_BOTTOM_BAR_DEFAULTS,
  MOBILE_BOTTOM_BAR_SETTINGS_KEY,
  activeBottomBarIndex,
  bottomBarHref,
  bottomBarLabel,
  visibleBottomBarItems,
  type MobileBottomBarConfig,
} from "@/lib/mobileBottomBar/config";
import { cn } from "@/lib/utils";
import "@/lib/i18n-dock";
import "@/lib/i18n-mobile-bottom-bar";

const ChatDockPanel = lazy(() =>
  import("./organisms/ChatDockPanel").then((m) => ({ default: m.ChatDockPanel })),
);
const TodoPanel = lazy(() =>
  import("./organisms/TodoPanel").then((m) => ({ default: m.TodoPanel })),
);
const NotesPanel = lazy(() =>
  import("./organisms/NotesPanel").then((m) => ({ default: m.NotesPanel })),
);
const SavedPanel = lazy(() =>
  import("./organisms/SavedPanel").then((m) => ({ default: m.SavedPanel })),
);
const CalendarPanel = lazy(() =>
  import("./organisms/CalendarPanel").then((m) => ({ default: m.CalendarPanel })),
);
const ReadLaterPanel = lazy(() =>
  import("./organisms/ReadLaterPanel").then((m) => ({ default: m.ReadLaterPanel })),
);

const ICONS: Record<DockToolId, typeof MessageCircle> = {
  chat: MessageCircle,
  todos: ListTodo,
  notes: NotebookPen,
  saved: Bookmark,
  calendar: CalendarDays,
  readLater: BookOpen,
};

/**
 * Rezerwacja dolnej krawędzi: pasek jest `position: fixed`, więc bez tego
 * zasłaniałby stopkę. Publikujemy zmierzoną wysokość jako `--mbb-space` i
 * znacznik `data-mbb="on"` (z tej jednej wartości korzysta styles.css).
 * Sprzątanie przy odmontowaniu jest obowiązkowe - przejście na /admin nie może
 * zostawić martwego dopełnienia strony.
 */
function useReservedSpace(): [React.RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement | null>(null);
  const [height, setHeight] = useState(0);

  useEffect(() => {
    const node = ref.current;
    const root = document.documentElement;
    root.dataset.mbb = "on";

    const publish = (value: number) => {
      if (value <= 0) return;
      setHeight(value);
      root.style.setProperty("--mbb-space", `${Math.round(value)}px`);
    };

    if (node) publish(node.offsetHeight);

    let observer: ResizeObserver | null = null;
    if (node && typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(() => publish(node.offsetHeight));
      observer.observe(node);
    }

    return () => {
      observer?.disconnect();
      root.removeAttribute("data-mbb");
      root.style.removeProperty("--mbb-space");
    };
  }, []);

  return [ref, height];
}

export function WorkspaceDock() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language?.startsWith("en") ? "en" : "pl";
  const [state, dispatch] = useReducer(dockReducer, initialDockState);
  const [barRef, barHeight] = useReservedSpace();

  const config = useSiteSetting<MobileBottomBarConfig>(
    MOBILE_BOTTOM_BAR_SETTINGS_KEY,
    MOBILE_BOTTOM_BAR_DEFAULTS,
  );
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const shortcuts = config.enabled ? visibleBottomBarItems(config) : [];
  const activeShortcut = activeBottomBarIndex(shortcuts, pathname);

  // Ostatnie narzędzie tylko podświetlamy - nie otwieramy panelu bez akcji
  // użytkownika, żeby wejście na stronę nie przysłaniało treści.
  useEffect(() => {
    writeLastTool(typeof window === "undefined" ? null : window.localStorage, state.open);
  }, [state.open]);

  const lastTool = typeof window === "undefined" ? null : readLastTool(window.localStorage);

  const chatUnread = useChatUnreadTotal();
  const openTodos = useOpenTodoCount();
  const unreadLater = useUnreadLaterCount();

  const badge = (tool: DockToolId): number => {
    if (tool === "chat") return chatUnread;
    if (tool === "todos") return openTodos;
    if (tool === "readLater") return unreadLater;
    return 0;
  };

  const close = useCallback(() => dispatch({ type: "close" }), []);

  return (
    <>
      {state.open ? (
        <div
          className="pointer-events-none fixed inset-x-0 z-40 flex justify-center px-3 sm:justify-end sm:px-4"
          style={{ bottom: `calc(${barHeight || 56}px + 8px)` }}
        >
          <Suspense fallback={null}>
            {state.open === "chat" && <ChatDockPanel onClose={close} />}
            {state.open === "todos" && <TodoPanel onClose={close} />}
            {state.open === "notes" && <NotesPanel onClose={close} />}
            {state.open === "saved" && <SavedPanel onClose={close} lang={lang} />}
            {state.open === "calendar" && <CalendarPanel onClose={close} lang={lang} />}
            {state.open === "readLater" && <ReadLaterPanel onClose={close} />}
          </Suspense>
        </div>
      ) : null}

      <div
        ref={barRef}
        data-workspace-dock
        className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card/95 backdrop-blur"
        style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
      >
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 px-2 py-1.5 sm:px-4">
          {/* Skróty tenanta - przeniesione z dawnego mobilnego paska dolnego. */}
          <nav
            aria-label={t("mobileBottomBar.nav")}
            className="min-w-0 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            <ul className="flex items-center gap-0.5">
              {shortcuts.map((item, index) => (
                <li key={item.id}>
                  <AppLink
                    href={bottomBarHref(item, lang)}
                    aria-current={index === activeShortcut ? "page" : undefined}
                    className={cn(
                      "relative flex items-center gap-2 rounded-full px-2.5 py-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      index === activeShortcut
                        ? "bg-primary/10 text-primary"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground",
                    )}
                  >
                    <span className="relative inline-flex">
                      <DynamicIcon
                        name={item.icon || "circle"}
                        className="h-[18px] w-[18px]"
                        aria-hidden="true"
                      />
                      <LiveTabBadge source={item.badge} />
                    </span>
                    <span className="hidden truncate lg:inline">
                      {bottomBarLabel(item, lang, t)}
                    </span>
                  </AppLink>
                </li>
              ))}
            </ul>
          </nav>

          {/* Narzędzia członka. */}
          <nav aria-label={t("dock.toolbar")} className="flex shrink-0 items-center gap-0.5">
            {DOCK_TOOLS.map((tool) => {
              const Icon = ICONS[tool];
              const count = badge(tool);
              const active = state.open === tool;
              return (
                <button
                  key={tool}
                  type="button"
                  onClick={() => dispatch({ type: "toggle", tool })}
                  aria-pressed={active}
                  aria-label={t(`dock.tools.${tool}`)}
                  title={t(`dock.tools.${tool}`)}
                  className={cn(
                    "relative rounded-full p-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    active
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground",
                    !active && lastTool === tool && "ring-1 ring-border",
                  )}
                >
                  <Icon className="h-4.5 w-4.5" aria-hidden />
                  {count > 0 ? (
                    <span className="absolute -right-0.5 -top-0.5 min-w-4 rounded-full bg-destructive px-1 text-[10px] font-semibold leading-4 text-destructive-foreground">
                      {count > 99 ? "99+" : count}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </nav>
        </div>
      </div>
    </>
  );
}
