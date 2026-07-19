import type { Block } from "@/lib/blocks/types";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ShieldCheck } from "lucide-react";
import { useBlocksI18n } from "@/lib/blocks/i18n";
import "@/lib/i18n-admin-blocks";
import { AdminSelect } from "../AdminSelect";

interface Props {
  block: Block;
  onChange: (next: Block) => void;
}

export function ResetPasswordFormBlock({ block, onChange }: Props) {
  const i18n = useBlocksI18n();
  const af = (k: string) => i18n.editor("authForms", k);
  const s = (k: string, fallback = "") => String(block.data[k] ?? fallback);
  const n = (k: string, fallback = 8) => Number(block.data[k] ?? fallback);
  const b = (k: string, fallback = true) =>
    block.data[k] === undefined ? fallback : Boolean(block.data[k]);
  const set = (k: string, v: string | number | boolean) =>
    onChange({ ...block, data: { ...block.data, [k]: v } });

  return (
    <div className="not-prose space-y-3 rounded-md border border-border bg-muted/30 p-3">
      <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
        <ShieldCheck className="w-3.5 h-3.5" /> {af("resetLabel")}
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
        <div className="space-y-1">
          <Label className="text-[11px] uppercase text-muted-foreground">{af("fTitlePl")}</Label>
          <Input value={s("title_pl")} onChange={(e) => set("title_pl", e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label className="text-[11px] uppercase text-muted-foreground">{af("fTitleEn")}</Label>
          <Input value={s("title_en")} onChange={(e) => set("title_en", e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label className="text-[11px] uppercase text-muted-foreground">{af("minLength")}</Label>
          <Input
            type="number"
            min={6}
            max={64}
            value={n("minLength", 8)}
            onChange={(e) => set("minLength", Number(e.target.value) || 8)}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-[11px] uppercase text-muted-foreground">
            {af("redirectSave")}
          </Label>
          <Input
            value={s("redirectTo", "/login")}
            onChange={(e) => set("redirectTo", e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-[11px] uppercase text-muted-foreground">{af("fSubmitPl")}</Label>
          <Input
            value={s("submitLabel_pl")}
            onChange={(e) => set("submitLabel_pl", e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-[11px] uppercase text-muted-foreground">{af("fSubmitEn")}</Label>
          <Input
            value={s("submitLabel_en")}
            onChange={(e) => set("submitLabel_en", e.target.value)}
          />
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm pt-1">
        <Switch
          checked={b("showConfirmPassword", true)}
          onCheckedChange={(v) => set("showConfirmPassword", v)}
        />
        <span>{af("resetConfirmPassword")}</span>
      </label>
    </div>
  );
}
