import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface SelectableOptionCardProps {
  /** Dostępna nazwa opcji. Wymagana - bez niej opcja jest dla czytnika bezimienna. */
  label: string;
  /** Czy opcja jest aktualnie wybrana. Trafia do `aria-pressed`. */
  selected: boolean;
  onSelect: () => void;
  /** Treść widoczna. Gdy pusta, widoczną treścią staje się `label`. */
  children?: ReactNode;
  /**
   * Nadpisanie dostępnej nazwy, gdy widoczna treść jest sama w sobie zbyt
   * skąpa (miniatura układu, ikona bez podpisu).
   */
  ariaLabel?: string;
  className?: string;
  disabled?: boolean;
  /**
   * Kształt opcji. `card` to kafel z opisem, `chip` - wąski przycisk słowa
   * (podświetlenia etykiety). Kontrakt dostępności jest w obu identyczny,
   * różni się wyłącznie rozmiar.
   */
  variant?: OptionCardVariant;
}

export type OptionCardVariant = "card" | "chip";

/** Wspólne klasy stanu wybranego i niewybranego - jeden pierścień, jedno tło. */
export const OPTION_CARD_CLASS =
  "text-left rounded-md border transition-colors disabled:opacity-60 disabled:cursor-not-allowed";
// Nieeksportowana: kształt jest wewnętrzną sprawą atomu, a eksport obiektu
// z pliku komponentu psuje wymianę modułu na gorąco (react-refresh).
const OPTION_CARD_SHAPE: Readonly<Record<OptionCardVariant, string>> = {
  card: "px-2 py-2.5",
  chip: "h-8 px-3 text-xs font-medium",
};
export const OPTION_CARD_SELECTED = "border-brand bg-brand/10 text-brand ring-1 ring-brand/40";
export const OPTION_CARD_IDLE = "border-border bg-background hover:border-brand/50";

/**
 * Atom: karta wyboru jednej opcji z zestawu (układ, wariant, ikona, kolumny).
 *
 * CO SCALIŁ I CO NAPRAWIŁ. Cztery panele modułu miały cztery kopie tego samego
 * przycisku i tylko DWIE z nich ogłaszały stan wyboru:
 * - wybór kolumn ToC oraz warianty układu wpisu miały `aria-pressed`,
 * - wybór wariantu wizualnego sekcji „dowiesz się" NIE miał go wcale,
 * - siatka dwunastu ikon Lucide miała `aria-label`, ale też bez `aria-pressed`.
 * Czytnik ekranu słyszał więc „przycisk, gwiazdka" i nie miał skąd wiedzieć,
 * która ikona jest ustawiona - stan wyboru istniał wyłącznie jako kolor ramki.
 * Atom wymusza jedno: każda opcja ma nazwę i ogłasza `aria-pressed`.
 */
export function SelectableOptionCard({
  label,
  selected,
  onSelect,
  children,
  ariaLabel,
  className,
  disabled = false,
  variant = "card",
}: SelectableOptionCardProps) {
  return (
    <button
      type="button"
      onClick={() => onSelect()}
      aria-pressed={selected}
      aria-label={ariaLabel ?? label}
      disabled={disabled}
      className={cn(
        OPTION_CARD_CLASS,
        OPTION_CARD_SHAPE[variant],
        selected ? OPTION_CARD_SELECTED : OPTION_CARD_IDLE,
        className,
      )}
    >
      {children ?? label}
    </button>
  );
}
