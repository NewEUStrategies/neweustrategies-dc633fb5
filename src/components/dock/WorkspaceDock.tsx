// Przestrzeń robocza członka: stały pasek narzędzi przy dolnej krawędzi
// (czat, zadania, notatki, zapisane, kalendarz, do przeczytania) i JEDEN
// panel otwarty naraz nad paskiem.
//
// Zasady:
//  - tylko dla zalogowanych, nigdy w /admin i /login (jak ChatDock),
//  - na telefonie unosi się nad mobilnym paskiem dolnym (--mbb-space),
//  - panele są lazy - gość i pierwsze wejście nie pobierają ich kodu,
//  - ostatnio używane narzędzie zapamiętujemy lokalnie (nie w bazie).
import { lazy, Suspense, useEffect, useReducer } from "react";
import { useTranslation } from "react-i18next";
import {
  Bookmark,
  BookOpen,
  CalendarDays,
  ListTodo,
  MessageCircle,
  NotebookPen,
} from "lucide-react";
import { DOCK_TOOLS, type DockToolId } from "@/lib/dock/types";
import { dockReducer, initialDockState, readLastTool, writeLastTool } from "@/lib/dock/dockState";
import { useOpenTodoCount } from "@/lib/dock/useTodos";
import { useUnreadLaterCount } from "@/lib/dock/useReadLater";
import { useChatUnreadTotal } from "@/lib/chat/useConversations";
import { cn } from "@/lib/utils";
import "@/lib/i18n-dock";

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

export function WorkspaceDock() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language?.startsWith("en") ? "en" : "pl";
  const [state, dispatch] = useReducer(dockReducer, initialDockState);

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

  const close = () => dispatch({ type: "close" });

  return (
    <div
      className="pointer-events-none fixed inset-x-0 z-40 flex flex-col items-end gap-2 px-3"
      style={{ bottom: "calc(var(--mbb-space, 0px) + 12px)" }}
    >
      {state.open ? (
        <Suspense fallback={null}>
          {state.open === "chat" && <ChatDockPanel onClose={close} />}
          {state.open === "todos" && <TodoPanel onClose={close} />}
          {state.open === "notes" && <NotesPanel onClose={close} />}
          {state.open === "saved" && <SavedPanel onClose={close} lang={lang} />}
          {state.open === "calendar" && <CalendarPanel onClose={close} lang={lang} />}
          {state.open === "readLater" && <ReadLaterPanel onClose={close} />}
        </Suspense>
      ) : null}

      <nav
        aria-label={t("dock.toolbar")}
        className="pointer-events-auto flex items-center gap-1 rounded-full border border-border bg-card/95 px-1.5 py-1 shadow-lg backdrop-blur"
      >
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
  );
}
