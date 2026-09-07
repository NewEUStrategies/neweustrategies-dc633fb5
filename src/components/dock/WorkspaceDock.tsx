// Przestrzeń robocza członka: JEDEN pasek na całej szerokości dolnej krawędzi
// ekranu i JEDEN panel otwarty naraz nad paskiem.
//
// Lewa strona paska to skróty nawigacyjne z konfiguracji mobilnego paska
// (sieć, czaty, start, kluby, profil). Prawa strona to narzędzia członka
// (zadania, notatki, zapisane, kalendarz, do przeczytania). Czat nie jest
// w narzędziach, bo czaty znajdują się już po lewej stronie jako skrót.
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
} from "react";
import { useTranslation } from "react-i18next";
import { useRouterState } from "@tanstack/react-router";

import { useAuth } from "@/hooks/useAuth";
import { Bookmark, BookOpen, CalendarDays, ListTodo, NotebookPen } from "lucide-react";
import { AppLink } from "@/components/atoms/AppLink";
import { DynamicIcon } from "@/lib/icons/DynamicIcon";
import { LiveTabBadge } from "@/components/mobile/bottomBar/LiveTabBadge";
import { type DockToolId } from "@/lib/dock/types";
import { dockReducer, initialDockState, readLastTool, writeLastTool } from "@/lib/dock/dockState";
import { useOpenTodoCount } from "@/lib/dock/useTodos";
import { useUnreadLaterCount } from "@/lib/dock/useReadLater";
import { useSiteSetting } from "@/lib/useSiteSetting";
import {
  activeBottomBarIndex,
  bottomBarHref,
  bottomBarLabel,
  MOBILE_BOTTOM_BAR_DEFAULTS,
  MOBILE_BOTTOM_BAR_SETTINGS_KEY,
  visibleBottomBarItems,
  type MobileBottomBarConfig,
  type MobileBottomBarItem,
} from "@/lib/mobileBottomBar/config";
import { cn } from "@/lib/utils";
import "@/lib/i18n-dock";

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

// Czat jest dostępny po lewej stronie jako skrót /messages, więc nie
// powtarzamy go w narzędziach po prawej.
type MemberTool = Exclude<DockToolId, "chat">;
const MEMBER_TOOLS: MemberTool[] = ["todos", "notes", "saved", "calendar", "readLater"];

const ICONS: Record<MemberTool, typeof ListTodo> = {
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

/**
 * Mobilna pozycja skrótu (atom paska): ikona + etykieta pod spodem, jak w
 * referencyjnej aplikacji. `center` wyróżnia Home - pełne kółko marki,
 * niezależnie od tego, czy trasa jest aktywna.
 */
function MobileShortcut({
  item,
  activeId,
  lang,
  t,
  center = false,
}: {
  item: MobileBottomBarItem | undefined;
  activeId: string | undefined;
  lang: "pl" | "en";
  t: (key: string) => string;
  center?: boolean;
}) {
  if (!item) return <span aria-hidden="true" />;
  const label = bottomBarLabel(item, lang, (key) => t(key));
  const active = item.id === activeId;
  return (
    <AppLink
      href={bottomBarHref(item, lang)}
      aria-current={active ? "page" : undefined}
      aria-label={label}
      className={cn(
        "flex min-w-0 flex-col items-center gap-0.5 rounded-xl px-1 py-1.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active ? "text-primary" : "text-muted-foreground hover:text-foreground",
      )}
    >
      <span
        className={cn(
          "relative grid place-items-center rounded-full",
          center ? "h-9 w-9 bg-primary text-primary-foreground" : "p-0.5",
        )}
      >
        <DynamicIcon
          name={item.icon || "circle"}
          className={center ? "h-5 w-5" : "h-5 w-5"}
          aria-hidden="true"
        />
        <LiveTabBadge source={item.badge} />
      </span>
      <span className="max-w-full truncate text-[10px] font-medium leading-tight">
        {label}
      </span>
    </AppLink>
  );
}

/** Mobilny przycisk "Zapisane" - otwiera panel zapisanych elementów. */
function MobileSavedButton({
  active,
  label,
  onPress,
}: {
  active: boolean;
  label: string;
  onPress: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onPress}
      aria-pressed={active}
      aria-label={label}
      className={cn(
        "flex min-w-0 flex-col items-center gap-0.5 rounded-xl px-1 py-1.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active ? "text-primary" : "text-muted-foreground hover:text-foreground",
      )}
    >
      <span className="grid place-items-center p-0.5">
        <Bookmark className="h-5 w-5" aria-hidden="true" />
      </span>
      <span className="max-w-full truncate text-[10px] font-medium leading-tight">
        {label}
      </span>
    </button>
  );
}

export function WorkspaceDock() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language?.startsWith("en") ? "en" : "pl";
  const pathname = useRouterState({ select: (s) => s.location.pathname });
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
  const unreadLater = useUnreadLaterCount();

  const badge = (tool: MemberTool): number => {
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
        {/* Mobile: pasek jak w aplikacji - Home dokładnie na środku,
            po lewej Network i Czat, po prawej Zapisane i Klub.
            Pozycje, ikony i etykiety nadal pochodzą z konfiguracji
            administratora; zmienia się tylko układ i slot "saved". */}
        <nav
          aria-label={t("dock.shortcuts")}
          className="grid grid-cols-5 items-stretch px-1 py-1 sm:hidden"
        >
          {(["network", "chats"] as const).map((id) => (
            <MobileShortcut
              key={id}
              item={shortcutById.get(id)}
              activeId={activeId}
              lang={lang}
              t={t}
            />
          ))}
          <MobileShortcut
            item={shortcutById.get("home")}
            activeId={activeId}
            lang={lang}
            t={t}
            center
          />
          <MobileSavedButton
            active={state.open === "saved"}
            label={t("dock.tools.saved")}
            onPress={() => dispatch({ type: "toggle", tool: "saved" })}
          />
          <MobileShortcut
            item={shortcutById.get("clubs")}
            activeId={activeId}
            lang={lang}
            t={t}
          />
        </nav>

        <div className="hidden items-center justify-between gap-2 px-2 py-1.5 sm:flex sm:px-4">
          {/* Skróty nawigacyjne po lewej - konfigurowalne w ustawieniach. */}
          <nav aria-label={t("dock.shortcuts")} className="flex shrink-0 items-center gap-0.5">
            {shortcuts.map((item, index) => {
              const label = bottomBarLabel(item, lang, (key) => t(key));
              const active = index === activeShortcut;
              return (
                <AppLink
                  key={item.id}
                  href={bottomBarHref(item, lang)}
                  className={cn(
                    "relative rounded-full p-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    active
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                  aria-current={active ? "page" : undefined}
                  aria-label={label}
                  title={label}
                >
                  <DynamicIcon
                    name={item.icon || "circle"}
                    className="h-4.5 w-4.5"
                    aria-hidden="true"
                  />
                  <LiveTabBadge source={item.badge} />
                </AppLink>
              );
            })}
          </nav>

          {/* Narzędzia członka po prawej - czat został usunięty, bo jest po lewej. */}
          <nav aria-label={t("dock.toolbar")} className="flex shrink-0 items-center gap-0.5">
            {MEMBER_TOOLS.map((tool) => {
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
