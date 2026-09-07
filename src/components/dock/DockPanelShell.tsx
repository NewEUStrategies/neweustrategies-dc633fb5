// Szablon panelu doku: nagłówek, przycisk zamknięcia, obszar przewijany.
// Na telefonie panel jest pełnej szerokości, od `sm` - dokowanym oknem w rogu.
// Escape zamyka panel, focus wchodzi do wnętrza po otwarciu (bez pułapki na
// całą stronę - użytkownik ma móc wrócić do treści tabulatorem).
import { useEffect, useRef, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  title: string;
  icon?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  /** Dodatkowe akcje w nagłówku (np. „Otwórz wiadomości"). */
  actions?: ReactNode;
  className?: string;
}

export function DockPanelShell({ title, icon, onClose, children, actions, className }: Props) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    ref.current?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      ref={ref}
      tabIndex={-1}
      role="dialog"
      aria-label={title}
      className={cn(
        "pointer-events-auto flex w-full flex-col overflow-hidden rounded-[10px] border border-border bg-card shadow-2xl outline-none",
        "h-[70vh] max-h-[560px] sm:w-[380px]",
        className,
      )}
    >
      <header className="flex items-center gap-2 border-b border-border px-3 py-2">
        {icon ? <span className="text-muted-foreground">{icon}</span> : null}
        <h2 className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">{title}</h2>
        {actions}
        <button
          type="button"
          onClick={onClose}
          aria-label={t("dock.close")}
          className="rounded-[6px] p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{children}</div>
    </div>
  );
}
