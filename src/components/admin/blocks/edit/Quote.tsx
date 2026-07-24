import type { Block } from "@/lib/blocks/types";
import { useBlocksI18n } from "@/lib/blocks/i18n";
import { useTranslation } from "react-i18next";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import "@/lib/i18n-admin-blocks";

interface Props {
  block: Block;
  onChange: (next: Block) => void;
}

// Warianty ograniczone do 4 stabilnych ekspozycji, spójnych z rendererem
// (`src/components/blocks/renderer/atoms.tsx#renderQuote`).
const VARIANTS = ["default", "plain", "card", "minimal"] as const;
const PALETTES = ["neutral", "brand", "primary", "accent", "success", "warning", "danger"] as const;

const PALETTE_VAR: Record<string, string> = {
  neutral: "var(--foreground)",
  brand: "var(--brand, var(--primary))",
  primary: "var(--primary)",
  accent: "var(--accent-foreground, var(--primary))",
  success: "var(--success, #16a34a)",
  warning: "var(--warning, #d97706)",
  danger: "var(--destructive)",
};

export function QuoteBlock({ block, onChange }: Props) {
  const i18n = useBlocksI18n();
  const { t } = useTranslation();
  const text = String(block.data.text ?? "");
  const cite = String(block.data.cite ?? "");
  const variant = String(block.data.variant ?? "default");
  const palette = String(block.data.colorPalette ?? "neutral");
  const accent = PALETTE_VAR[palette] ?? PALETTE_VAR.neutral;
  const tint = `color-mix(in oklab, ${accent} 8%, transparent)`;

  const set = (patch: Record<string, string>) =>
    onChange({ ...block, data: { ...block.data, ...patch } });

  const wrapperStyle: React.CSSProperties =
    variant === "card"
      ? { borderColor: accent, background: tint }
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

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className="text-xs">{t("blocks.settings.variant")}</Label>
          <Select value={variant} onValueChange={(v) => set({ variant: v })}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {VARIANTS.map((v) => (
                <SelectItem key={v} value={v}>
                  {t(`blocks.settings.quoteVariant.${v}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">{t("blocks.settings.colorPalette")}</Label>
          <Select value={palette} onValueChange={(v) => set({ colorPalette: v })}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PALETTES.map((p) => (
                <SelectItem key={p} value={p}>
                  <span className="inline-flex items-center gap-2">
                    <span
                      aria-hidden
                      className="inline-block h-3 w-3 rounded-[3px] border border-border"
                      style={{ background: PALETTE_VAR[p] }}
                    />
                    {t(`blocks.settings.palette.${p}`)}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <blockquote className={wrapperClass} style={wrapperStyle} data-quote-variant={variant}>
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
        <textarea
          value={text}
          rows={2}
          placeholder={i18n.editor("quote", "textPh")}
          onChange={(e) => set({ text: e.target.value })}
          className="w-full bg-transparent text-lg italic border-none outline-none focus:ring-0 p-0 resize-none"
          style={variant === "minimal" ? { color: accent, textAlign: "center" } : undefined}
        />
        <input
          type="text"
          value={cite}
          placeholder={i18n.editor("quote", "citePh")}
          onChange={(e) => set({ cite: e.target.value })}
          className="w-full bg-transparent text-sm text-muted-foreground border-none outline-none focus:ring-0 p-0"
          style={variant === "minimal" ? { textAlign: "center" } : undefined}
        />
      </blockquote>
    </div>
  );
}
