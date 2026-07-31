import type { Block } from "@/lib/blocks/types";
import { useBlocksI18n } from "@/lib/blocks/i18n";
import { AutoGrowTextarea } from "../atoms/AutoGrowTextarea";
import { BLOCK_PALETTE_VAR } from "@/lib/blocks/variants";
import "@/lib/i18n-admin-blocks";

interface Props {
  block: Block;
  onChange: (next: Block) => void;
}

export function QuoteBlock({ block, onChange }: Props) {
  const i18n = useBlocksI18n();
  const text = String(block.data.text ?? "");
  const cite = String(block.data.cite ?? "");
  // Wariant i kolorystyka są ustawiane wyłącznie z toolbara widgetu
  // (pojawia się dopiero po kliknięciu bloku) - tutaj tylko konsumujemy stan,
  // żeby podgląd wyglądał dokładnie jak render publiczny.
  const variant = String(block.data.variant ?? "default");
  const palette = String(block.data.colorPalette ?? "neutral");
  const accent = BLOCK_PALETTE_VAR[palette] ?? BLOCK_PALETTE_VAR.neutral;
  const tint = `color-mix(in oklab, ${accent} 8%, transparent)`;

  const set = (patch: Record<string, string>) =>
    onChange({ ...block, data: { ...block.data, ...patch } });

  // Layout / typografia 1:1 z publicznym rendererem (renderQuote w
  // components/blocks/renderer/atoms.tsx) - żeby podgląd nie różnił się
  // wysokością, odstępami ani zawijaniem od strony publicznej.
  const wrapperStyle: React.CSSProperties =
    variant === "card"
      ? { borderColor: accent, background: tint }
      : variant === "plain"
        ? { color: accent }
        : variant === "default"
          ? { borderColor: accent }
          : {};

  const wrapperClass =
    variant === "plain"
      ? "relative pl-10 pr-2 py-2 space-y-2"
      : variant === "card"
        ? "rounded-[6px] border p-5 space-y-2"
        : variant === "minimal"
          ? "text-center italic space-y-2 py-4"
          : "border-l-4 pl-4 space-y-2";

  // Klasy tekstu cytatu per wariant - identyczne z rendererem publicznym.
  const textClass =
    variant === "plain"
      ? "text-foreground text-lg leading-relaxed italic"
      : variant === "card"
        ? "text-foreground text-lg leading-relaxed"
        : variant === "minimal"
          ? "text-xl leading-relaxed"
          : "";

  const textStyle: React.CSSProperties | undefined =
    variant === "minimal"
      ? { color: accent, textAlign: "center" }
      : variant === "plain"
        ? { color: "var(--foreground)" }
        : undefined;

  return (
    <blockquote
      className={`min-w-0 max-w-full ${wrapperClass}`}
      style={wrapperStyle}
      data-quote-variant={variant}
    >
      {variant === "plain" && (
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          className="absolute left-0 top-1 h-6 w-6 opacity-70"
          fill="currentColor"
          style={{ color: accent }}
        >
          <path d="M7.17 6C4.87 6 3 7.87 3 10.17V18h7.5v-7.83H6.6c0-1.42 1.16-2.58 2.58-2.58V6H7.17zm10 0c-2.3 0-4.17 1.87-4.17 4.17V18H20.5v-7.83h-3.9c0-1.42 1.16-2.58 2.58-2.58V6h-1.01z" />
        </svg>
      )}
      <AutoGrowTextarea
        value={text}
        placeholder={i18n.editor("quote", "textPh")}
        onChange={(e) => set({ text: e.target.value })}
        data-quote-field="text"
        className={`cms-quote-text w-full max-w-full bg-transparent border-none outline-none focus:ring-0 p-0 break-words whitespace-pre-wrap ${textClass}`}
        style={textStyle}
      />
      <input
        type="text"
        value={cite}
        placeholder={i18n.editor("quote", "citePh")}
        onChange={(e) => set({ cite: e.target.value })}
        data-quote-field="cite"
        className="cms-quote-cite w-full max-w-full bg-transparent text-sm text-muted-foreground not-italic border-none outline-none focus:ring-0 p-0"
        style={variant === "minimal" ? { textAlign: "center" } : undefined}
      />

    </blockquote>
  );
}
