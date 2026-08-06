// Atom: podstawowa akcja popovera udostępniania - "Skopiuj link".
// Czysto prezentacyjny: stan „skopiowano" i etykiety przychodzą z zewnątrz,
// bo efekt uboczny (schowek + toast) należy do organizmu, nie do atomu.
// Tonacja wyłącznie z tokenów semantycznych (brand / border), promień 5px -
// jak reszta akcji w pasku artykułu.
import { Check } from "lucide-react";
import { Copy } from "@/lib/lucide-shim";

interface GiftCopyButtonProps {
  copied: boolean;
  label: string;
  copiedLabel: string;
  disabled?: boolean;
  onClick: () => void;
}

export function GiftCopyButton({
  copied,
  label,
  copiedLabel,
  disabled = false,
  onClick,
}: GiftCopyButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      data-testid="gift-copy-button"
      aria-live="polite"
      className={[
        "w-full inline-flex items-center justify-center gap-1.5 h-9 rounded-[5px]",
        "text-[12px] font-semibold tracking-tight transition active:scale-[0.98]",
        "disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100",
        copied
          ? "bg-brand/10 text-brand border border-brand/40"
          : "bg-brand text-brand-foreground hover:opacity-90 shadow-sm",
      ].join(" ")}
    >
      {copied ? (
        <Check className="w-[14px] h-[14px]" aria-hidden />
      ) : (
        <Copy className="w-[14px] h-[14px]" aria-hidden />
      )}
      {copied ? copiedLabel : label}
    </button>
  );
}
