import { useId } from "react";
import type { Block } from "@/lib/blocks/types";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { UserPlus } from "lucide-react";
import { useBlocksI18n } from "@/lib/blocks/i18n";
import "@/lib/i18n-admin-blocks";
import { readAuthFlag } from "@/lib/content-model/authFormSettings";
import { AdminSelect } from "../AdminSelect";

interface Props {
  block: Block;
  onChange: (next: Block) => void;
}

export function RegisterFormBlock({ block, onChange }: Props) {
  const i18n = useBlocksI18n();
  const af = (k: string) => i18n.editor("authForms", k);
  const uid = useId();
  // Odczyt tą samą koercją, co renderer (`AuthFormBlocks`): tekst wyłącznie
  // jako napis, przełącznik przez `readAuthFlag` - „0" to wyłączone, a `null`
  // to wartość domyślna (`Boolean(null)` pokazywał wyłączenie).
  const s = (k: string, fallback = "") => {
    const v = block.data[k];
    return typeof v === "string" ? v : fallback;
  };
  const b = (k: string, fallback = true) => readAuthFlag(block.data, [k], fallback);
  const set = (k: string, v: string | boolean) =>
    onChange({ ...block, data: { ...block.data, [k]: v } });

  /** Pole z etykietą powiązaną przez `htmlFor` - czytnik ekranu czyta nazwę pola, nie samą wartość. */
  const field = (k: string, label: string, fallback = "") => (
    <div className="space-y-1">
      <Label htmlFor={`${uid}-${k}`} className="text-[11px] uppercase text-muted-foreground">
        {label}
      </Label>
      <Input id={`${uid}-${k}`} value={s(k, fallback)} onChange={(e) => set(k, e.target.value)} />
    </div>
  );

  return (
    <div className="not-prose space-y-3 rounded-md border border-border bg-muted/30 p-3">
      <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
        <UserPlus className="w-3.5 h-3.5" /> {af("registerLabel")}
        <AdminSelect
          value={s("variant", "card")}
          onChange={(e) => set("variant", e.target.value)}
          className="ml-auto bg-background border border-border rounded px-1 py-0.5 text-[11px] normal-case tracking-normal"
        >
          <option value="card">{i18n.editor("newsletter", "variantCard")}</option>
          <option value="plain">{af("variantPlain")}</option>
          <option value="split">{af("variantSplit")}</option>
        </AdminSelect>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        {field("title_pl", af("fTitlePl"))}
        {field("title_en", af("fTitleEn"))}
        {field("subtitle_pl", af("fSubtitlePl"))}
        {field("subtitle_en", af("fSubtitleEn"))}
        {field("submitLabel_pl", af("fSubmitPl"))}
        {field("submitLabel_en", af("fSubmitEn"))}
        {field("consentLabel_pl", af("fConsentPl"))}
        {field("consentLabel_en", af("fConsentEn"))}
        {field("redirectTo", af("redirectRegister"), "/")}
        {field("loginHref", af("linkLogin"), "?mode=signin")}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
        {(
          [
            ["showName", af("showName")],
            ["showConfirmPassword", af("showConfirmPassword")],
            ["showNewsletterOptIn", af("showNewsletterOptIn")],
            ["requireConsent", af("requireConsent")],
          ] as [string, string][]
        ).map(([k, label]) => (
          <label key={k} className="flex items-center gap-2 text-sm">
            <Switch checked={b(k, true)} onCheckedChange={(v) => set(k, v)} />
            <span>{label}</span>
          </label>
        ))}
      </div>
    </div>
  );
}
