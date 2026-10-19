import { useId } from "react";
import type { Block } from "@/lib/blocks/types";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { KeyRound } from "lucide-react";
import { useBlocksI18n } from "@/lib/blocks/i18n";
import "@/lib/i18n-admin-blocks";
import { AdminSelect } from "../AdminSelect";

interface Props {
  block: Block;
  onChange: (next: Block) => void;
}

export function LostPasswordFormBlock({ block, onChange }: Props) {
  const i18n = useBlocksI18n();
  const af = (k: string) => i18n.editor("authForms", k);
  const uid = useId();
  // Tekst wyłącznie jako napis - jak w rendererze (`pickAuthText`/`asStr`);
  // obiekt z migracji nie wchodzi do pola jako „[object Object]".
  const s = (k: string, fallback = "") => {
    const v = block.data[k];
    return typeof v === "string" ? v : fallback;
  };
  const set = (k: string, v: string) => onChange({ ...block, data: { ...block.data, [k]: v } });

  /** Pole z etykietą powiązaną przez `htmlFor` - czytnik ekranu czyta nazwę pola, nie samą wartość. */
  const field = (k: string, label: string, fallback = "", wide = false) => (
    <div className={wide ? "space-y-1 md:col-span-2" : "space-y-1"}>
      <Label htmlFor={`${uid}-${k}`} className="text-[11px] uppercase text-muted-foreground">
        {label}
      </Label>
      <Input id={`${uid}-${k}`} value={s(k, fallback)} onChange={(e) => set(k, e.target.value)} />
    </div>
  );

  return (
    <div className="not-prose space-y-3 rounded-md border border-border bg-muted/30 p-3">
      <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
        <KeyRound className="w-3.5 h-3.5" /> {af("lostLabel")}
        <AdminSelect
          value={s("variant", "card")}
          onChange={(e) => set("variant", e.target.value)}
          className="ml-auto bg-background border border-border rounded px-1 py-0.5 text-[11px] normal-case tracking-normal"
        >
          <option value="card">{i18n.editor("newsletter", "variantCard")}</option>
          <option value="plain">{af("variantPlain")}</option>
        </AdminSelect>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        {field("title_pl", af("fTitlePl"))}
        {field("title_en", af("fTitleEn"))}
        {field("subtitle_pl", af("fSubtitlePl"), "", true)}
        {field("subtitle_en", af("fSubtitleEn"), "", true)}
        {field("redirectTo", af("resetPageLink"), "/reset-password")}
        {field("loginHref", af("linkBackToLogin"), "?mode=signin")}
        {field("submitLabel_pl", af("fSubmitPl"))}
        {field("submitLabel_en", af("fSubmitEn"))}
      </div>
    </div>
  );
}
