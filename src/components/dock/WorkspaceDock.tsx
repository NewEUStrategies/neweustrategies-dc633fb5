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
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { AnimatePresence, motion } from "framer-motion";

import { useAuth } from "@/hooks/useAuth";
import { ChatAvatar } from "@/components/chat/ChatAvatar";
import { conversationDisplay } from "@/lib/chat/display";
import { useConversations, usePeerProfiles } from "@/lib/chat/useConversations";
import { Bookmark, CalendarDays, ListTodo, NotebookPen, X } from "lucide-react";
import {
  MINIMIZED_VISIBLE_LIMIT,
  minimizedChatsStore,
  useMinimizedChats,
} from "@/lib/chat/minimizedChats";
import { DynamicIcon } from "@/lib/icons/DynamicIcon";
import { LiveTabBadge } from "@/components/mobile/bottomBar/LiveTabBadge";
import { type DockToolId } from "@/lib/dock/types";
import { dockReducer, initialDockState, readLastTool, writeLastTool } from "@/lib/dock/dockState";
import { useOpenTodoCount } from "@/lib/dock/useTodos";
import { useSiteSetting } from "@/lib/useSiteSetting";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
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
import "@/lib/i18n-dock";
import "@/lib/i18n-mobile-bottom-bar";

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
const ChatSideDrawer = lazy(() =>
  import("./organisms/ChatSideDrawer").then((m) => ({ default: m.ChatSideDrawer })),
);

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

// Animacja rozwijanej zakładki: aktywna rośnie (padding + przerwa na tekst),
// etykieta wjeżdża sprężyście. Promień i odstępy trzymamy na 6px.
const tabTransition = { delay: 0.1, type: "spring", bounce: 0, duration: 0.6 } as const;

const labelVariants = {
  initial: { width: 0, opacity: 0 },
  animate: { width: "auto", opacity: 1 },
  exit: { width: 0, opacity: 0 },
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

/**
 * Pojedyncza rozwijana zakładka: ikona + etykieta widoczna na aktywnej
 * pozycji. Każda ikona pokazuje podpis po najechaniu (tooltip) – także
 * aktywna, która oprócz rozwiniętej etykiety wewnątrz przycisku ma
 * dodatkowy tekst nad paskiem.
 */
function ExpandableTab({
  label,
  active,
  onPress,
  icon,
  badge,
  center = false,
  compact = false,
  highlighted = false,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  icon: ReactNode;
  badge?: ReactNode;
  center?: boolean;
  compact?: boolean;
  highlighted?: boolean;
}) {
  return (
    <Tooltip delayDuration={200}>
      <TooltipTrigger asChild>
        <motion.button
          type="button"
          onClick={onPress}
          aria-pressed={active}
          aria-label={label}
          initial={false}
          animate={{
            gap: active ? "0.375rem" : 0,
            paddingLeft: active ? (compact ? "0.625rem" : "0.75rem") : "0.5rem",
            paddingRight: active ? (compact ? "0.625rem" : "0.75rem") : "0.5rem",
          }}
          transition={tabTransition}
          className={cn(
            "relative flex min-w-0 items-center rounded-md py-1 text-xs font-medium transition-colors duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            active
              ? "bg-primary/10 text-primary"
              : "text-muted-foreground/80 hover:bg-muted hover:text-foreground",
            !active && highlighted && "ring-1 ring-border",
          )}
        >
          <span
            className={cn(
              "relative grid shrink-0 place-items-center rounded-full [&>svg]:h-4 [&>svg]:w-4",
              center && "h-6 w-6 bg-primary text-primary-foreground [&>svg]:h-3.5 [&>svg]:w-3.5",
            )}
          >
            {icon}
            {badge}
          </span>
          <AnimatePresence initial={false}>
            {active ? (
              <motion.span
                key="label"
                variants={labelVariants}
                initial="initial"
                animate="animate"
                exit="exit"
                transition={tabTransition}
                className={cn(
                  "overflow-hidden whitespace-nowrap",
                  compact ? "text-[11px]" : "text-xs",
                )}
              >
                {label}
              </motion.span>
            ) : null}
          </AnimatePresence>
        </motion.button>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={8}>
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

/** Pionowy separator 6px od grup (jak w rozwijanych zakładkach). */
function TabSeparator() {
  return <span aria-hidden="true" className="mx-1.5 h-4 w-px shrink-0 bg-border/80" />;
}

/**
 * Zminimalizowane rozmowy: maksymalnie dwie pigułki po lewej stronie paska,
 * reszta chowa się pod ikoną "+N" (kliknięcie otwiera skrzynkę czatu).
 */
function MinimizedChats({ onOpenInbox }: { onOpenInbox: () => void }) {
  const { t } = useTranslation();
  const { minimized } = useMinimizedChats();
  // Zdjęcie rozmówcy bierzemy na żywo z listy rozmów (dane są już w cache
  // React Query), a zapisany URL służy tylko jako zapas przy starcie sesji.
  const conversationsQ = useConversations();
  const views = useMemo(() => conversationsQ.data ?? [], [conversationsQ.data]);
  const peerIds = useMemo(
    () => [...new Set(views.flatMap((view) => view.peers.map((peer) => peer.user_id)))],
    [views],
  );
  const peersQ = usePeerProfiles(peerIds);
  const liveAvatars = useMemo(() => {
    const map = new Map<string, string | null>();
    for (const view of views) {
      const display = conversationDisplay(view, peersQ.data);
      map.set(view.conversation.id, display.avatarUrl);
    }
    return map;
  }, [views, peersQ.data]);

  if (minimized.length === 0) return null;

  const visible = minimized.slice(0, MINIMIZED_VISIBLE_LIMIT);
  const overflow = minimized.length - visible.length;

  const restore = (id: string) => {
    minimizedChatsStore.restore(id);
    onOpenInbox();
  };

  return (
    <div className="pointer-events-auto absolute bottom-0 left-1.5 top-0 flex items-center gap-1.5">
      {visible.map((chat) => (
        <span
          key={chat.id}
          className="flex h-6 max-w-[132px] items-center gap-1 rounded-md border border-border bg-muted/60 py-0 pl-0.5 pr-0.5 text-[11px] font-medium leading-none"
        >
          <button
            type="button"
            onClick={() => restore(chat.id)}
            title={t("dock.chat.restore", { name: chat.name })}
            aria-label={t("dock.chat.restore", { name: chat.name })}
            className="flex h-5 min-w-0 items-center gap-1"
          >
            <ChatAvatar
              name={chat.name}
              avatarUrl={liveAvatars.get(chat.id) ?? chat.avatarUrl}
              size="xs"
              className="shrink-0"
            />
            <span className="truncate leading-none">{chat.name}</span>
          </button>
          <button
            type="button"
            onClick={() => minimizedChatsStore.remove(chat.id)}
            title={t("dock.chat.closeConversation")}
            aria-label={t("dock.chat.closeConversation")}
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:text-foreground"
          >
            <X className="h-3 w-3" aria-hidden />
          </button>
        </span>
      ))}
      {overflow > 0 ? (
        <button
          type="button"
          onClick={onOpenInbox}
          title={t("dock.chat.minimizedMore", { count: overflow })}
          aria-label={t("dock.chat.minimizedMore", { count: overflow })}
          className="flex h-6 items-center rounded-md border border-border bg-muted/60 px-2 text-[11px] font-semibold leading-none text-muted-foreground hover:text-foreground"
        >
          +{overflow}
        </button>
      ) : null}

    </div>
  );
}

export function WorkspaceDock() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language?.startsWith("en") ? "en" : "pl";
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();
  const [state, dispatch] = useReducer(dockReducer, initialDockState);
  const [barRef, barHeight] = useReservedSpace();
  const { user } = useAuth();

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

  // Ostatnie narzędzie tylko podświetlamy - nie otwieramy panelu bez akcji
  // użytkownika, żeby wejście na stronę nie przysłaniało treści.
  useEffect(() => {
    writeLastTool(typeof window === "undefined" ? null : window.localStorage, state.open);
  }, [state.open]);

  const lastTool = typeof window === "undefined" ? null : readLastTool(window.localStorage);

  const openTodos = useOpenTodoCount();

  const badgeCount = (tool: MemberTool): number => {
    if (tool === "todos") return openTodos;
    return 0;
  };

  const close = useCallback(() => dispatch({ type: "close" }), []);

  // Ostateczna bramka: dock to przestrzeń robocza członka; nawet jeśli ktoś
  // użyje komponentu poza SiteChrome, nie renderujemy go dla gości.
  if (!user) return null;

  const shortcutTab = (id: string, opts?: { center?: boolean; compact?: boolean }) => {
    const item = shortcutById.get(id);
    if (!item) return null;
    const label = bottomBarLabel(item, lang, (key) => t(key));
    // Czat nie przenosi na osobną stronę - wysuwa skrzynkę z lewej krawędzi.
    const isChat = item.id === "chats";
    return (
      <ExpandableTab
        key={id}
        label={label}
        active={isChat ? state.open === "chat" : item.id === activeId}
        center={opts?.center}
        compact={opts?.compact}
        onPress={() =>
          isChat
            ? dispatch({ type: "toggle", tool: "chat" })
            : void navigate({ to: bottomBarHref(item, lang) })
        }
        icon={<DynamicIcon name={item.icon || "circle"} className="h-4 w-4" aria-hidden="true" />}
        badge={<LiveTabBadge source={item.badge} />}
      />
    );
  };

  const toolTab = (tool: MemberTool, opts?: { compact?: boolean }) => {
    const Icon = ICONS[tool];
    const count = badgeCount(tool);
    const active = state.open === tool;
    return (
      <ExpandableTab
        key={tool}
        label={t(`dock.tools.${tool}`)}
        active={active}
        compact={opts?.compact}
        highlighted={!active && lastTool === tool}
        onPress={() => dispatch({ type: "toggle", tool })}
        icon={<Icon className="h-4 w-4" aria-hidden />}
        badge={
          count > 0 ? (
            <span className="absolute -right-1.5 -top-1.5 min-w-4 rounded-full bg-destructive px-1 text-[10px] font-semibold leading-4 text-destructive-foreground">
              {count > 99 ? "99+" : count}
            </span>
          ) : undefined
        }
      />
    );
  };

  return (
    <>
      {state.open === "chat" ? (
        <Suspense fallback={null}>
          <ChatSideDrawer onClose={close} bottomOffset={barHeight || 56} />
        </Suspense>
      ) : null}

      {state.open && state.open !== "chat" ? (
        <div
          className="pointer-events-none fixed inset-x-0 z-40 flex justify-center px-3 sm:justify-end sm:px-4"
          style={{ bottom: `calc(${barHeight || 56}px + 8px)` }}
        >
          <Suspense fallback={null}>
            {state.open === "todos" && <TodoPanel onClose={close} />}
            {state.open === "notes" && <NotesPanel onClose={close} />}
            {state.open === "saved" && <SavedPanel onClose={close} lang={lang} />}
            {state.open === "calendar" && <CalendarPanel onClose={close} lang={lang} />}
          </Suspense>
        </div>
      ) : null}

      <div
        ref={barRef}
        data-workspace-dock
        className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card/95 backdrop-blur"
        style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
      >
        <div className="relative">
          <MinimizedChats onOpenInbox={() => dispatch({ type: "open", tool: "chat" })} />
          {/* Mobile: Home dokładnie na środku, po lewej Network i Czat,
            po prawej Zapisane i Klub - wszystkie jako rozwijane zakładki
            z odstępem 6px. */}
          <nav
            aria-label={t("dock.shortcuts")}
            className="flex items-center justify-center gap-1.5 overflow-x-auto px-1.5 py-1 sm:hidden"
          >
            {shortcutTab("network", { compact: true })}
            {shortcutTab("chats", { compact: true })}
            {shortcutTab("home", { center: true, compact: true })}
            {toolTab("saved", { compact: true })}
            {shortcutTab("clubs", { compact: true })}
          </nav>

          {/* Desktop: skróty | separator | narzędzia, jedna wycentrowana grupa. */}
          <div className="hidden items-center justify-center gap-2 px-4 py-1.5 sm:flex">
            {/* Hierarchia: skróty nawigacyjne jako główna grupa... */}
            <nav aria-label={t("dock.shortcuts")} className="flex items-center gap-1.5">
              {shortcuts.map((item) => shortcutTab(item.id))}
            </nav>
            <TabSeparator />
            {/* ...a narzędzia członka w wyciszonej, wydzielonej pigułce. */}
            <nav
              aria-label={t("dock.toolbar")}
              className="flex items-center gap-1.5 rounded-md bg-muted/40 px-1.5 py-0.5"
            >
              {MEMBER_TOOLS.map((tool) => toolTab(tool))}
            </nav>
          </div>
        </div>
      </div>
    </>
  );
}
