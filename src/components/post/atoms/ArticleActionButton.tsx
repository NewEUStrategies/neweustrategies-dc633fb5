// Atom: przycisk rzędu akcji artykułu (odsłuchaj / pobierz).
//
// POWSTAŁ ZE DWÓCH IDENTYCZNYCH ŁAŃCUCHÓW KLAS: `ArticleListenButton` miał go
// jako wartość domyślną propa `className`, a `MobileArticleActions` jako lokalną
// stałą `ACTION_CLASS` - ten sam 200-znakowy napis w dwóch plikach, bez żadnego
// związku poza kopiowaniem. Kopia w `MobileArticleActions` zgubiła przy tym
// `disabled:opacity-60`, więc przycisk pobierania nie miał stanu wyłączonego.
// Jeden atom = jeden kontrakt a11y i jedna geometria dla całego rzędu.
import type { ComponentType, ReactNode, SVGProps } from "react";
import { cn } from "@/lib/utils";

/** Wspólna geometria rzędu akcji. Eksportowana, bo obie molekuły ją współdzielą. */
export const ARTICLE_ACTION_CLASS =
  "cms-widget-label inline-flex h-8 w-full items-center justify-center gap-1.5 whitespace-nowrap rounded-[5px] border border-border bg-background px-3 font-semibold tracking-tight text-foreground transition-colors hover:bg-muted hover:text-brand active:scale-[0.98] disabled:opacity-60";

export interface ArticleActionButtonProps {
  /**
   * Ikona akcji - renderowana jako DEKORACJA (`aria-hidden`). Etykietę niesie
   * `label`, więc czytnik ekranu nigdy nie ogłasza samej ikony.
   */
  icon: ComponentType<SVGProps<SVGSVGElement> & { className?: string }>;
  /**
   * Etykieta dostępna I widoczna - JEDNO źródło, więc nie mogą się rozjechać.
   * To był realny defekt w kopiach: jedna miała `aria-label`, druga tylko tekst.
   */
  label: string;
  onClick: () => void;
  /** Trwająca operacja: przycisk jest wyłączony i ogłasza `aria-busy`. */
  busy?: boolean;
  disabled?: boolean;
  /** Element renderowany zamiast ikony (np. spinner w trakcie generowania). */
  leading?: ReactNode;
  className?: string;
}

export function ArticleActionButton({
  icon: Icon,
  label,
  onClick,
  busy,
  disabled,
  leading,
  className,
}: ArticleActionButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || busy || undefined}
      aria-label={label}
      aria-busy={busy || undefined}
      className={cn(ARTICLE_ACTION_CLASS, className)}
    >
      {leading ?? <Icon className="h-[14px] w-[14px] text-brand" aria-hidden />}
      <span>{label}</span>
    </button>
  );
}
