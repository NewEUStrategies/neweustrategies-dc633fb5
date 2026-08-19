// Molekuła: pozycja na liście wersji (klikalna, z metadanymi i akcjami).
import type { ReactNode } from "react";

export function VersionRow({
  title,
  meta,
  active,
  onSelect,
  badge,
  actions,
}: {
  title: string;
  meta: string;
  active: boolean;
  onSelect: () => void;
  badge?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <li className={active ? "bg-muted" : "hover:bg-muted/60"}>
      <div className="flex items-start gap-2 px-3 py-2">
        {/* `aria-current` obok klasy tła: wybraną wersję sygnalizowało dotąd
            WYŁĄCZNIE podświetlenie, więc czytnik ekranu czytał listę wersji
            jako identyczne przyciski bez wskazania, którą właśnie oglądamy. */}
        <button
          type="button"
          onClick={onSelect}
          aria-current={active ? "true" : undefined}
          className="flex-1 text-left"
        >
          <span className="flex items-center gap-2">
            <span className="text-sm font-medium">{title}</span>
            {badge}
          </span>
          <span className="mt-0.5 block text-[0.6875rem] text-muted-foreground">{meta}</span>
        </button>
        {actions ? <div className="flex shrink-0 items-center gap-1">{actions}</div> : null}
      </div>
    </li>
  );
}
