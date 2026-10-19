import { useId } from "react";
import type { Block } from "@/lib/blocks/types";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { LogIn } from "lucide-react";
import { useBlocksI18n } from "@/lib/blocks/i18n";
import "@/lib/i18n-admin-blocks";
import { readAuthFlag } from "@/lib/content-model/authFormSettings";
import { AdminSelect } from "../AdminSelect";

interface Props {
  block: Block;
  onChange: (next: Block) => void;
}

type Key =
  | "title_pl"
  | "title_en"
  | "subtitle_pl"
  | "subtitle_en"
  | "submitLabel_pl"
  | "submitLabel_en"
  | "redirectTo"
  | "registerHref"
  | "forgotHref"
  | "variant";

type BoolKey =
  "showRemember" | "showShowPassword" | "showForgot" | "showRegister" | "showOAuthGoogle";

export function LoginFormBlock({ block, onChange }: Props) {
  const i18n = useBlocksI18n();
  const af = (k: string) => i18n.editor("authForms", k);
  const uid = useId();
  // Odczyt tą samą koercją, co renderer (`AuthFormBlocks`): tekst wyłącznie
  // jako napis (obiekt z migracji nie wchodzi do pola jako „[object Object]"),
  // przełącznik przez `readAuthFlag` - „0" to wyłączone, `null` to domyślne.
  const s = (k: Key, fallback = "") => {
    const v = block.data[k];
    return typeof v === "string" ? v : fallback;
  };
  const b = (k: BoolKey) => readAuthFlag(block.data, [k], true);
  const set = (k: string, v: string | boolean) =>
    onChange({ ...block, data: { ...block.data, [k]: v } });

  /** Pole z etykietą powiązaną przez `htmlFor` - czytnik ekranu czyta nazwę pola, nie samą wartość. */
  const field = (k: Key, label: string, fallback = "", extra?: { placeholder?: string }) => (
    <div className={k === "forgotHref" ? "space-y-1 md:col-span-2" : "space-y-1"}>
      <Label htmlFor={`${uid}-${k}`} className="text-[11px] uppercase text-muted-foreground">
        {label}
      </Label>
      <Input
        id={`${uid}-${k}`}
        value={s(k, fallback)}
        onChange={(e) => set(k, e.target.value)}
        placeholder={extra?.placeholder}
      />
    </div>
  );

  return (
    <div className="not-prose space-y-3 rounded-md border border-border bg-muted/30 p-3">
      <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
        <LogIn className="w-3.5 h-3.5" /> {af("loginLabel")}
        <AdminSelect
          value={s("variant", "card")}
          onChange={(e) => set("variant", e.target.value)}
          className="ml-auto bg-background border border-border rounded px-1 py-0.5 text-[11px] normal-case tracking-normal"
        >
          <option value="card">{i18n.editor("newsletter", "variantCard")}</option>
          <option value="plain">{af("variantPlain")}</option>
          <option value="split">{af("variantSplitBrand")}</option>
        </AdminSelect>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        {field("title_pl", af("fTitlePl"))}
        {field("title_en", af("fTitleEn"))}
        {field("subtitle_pl", af("fSubtitlePl"))}
        {field("subtitle_en", af("fSubtitleEn"))}
        {field("submitLabel_pl", af("fSubmitPl"))}
        {field("submitLabel_en", af("fSubmitEn"))}
        {field("redirectTo", af("redirectLogin"), "/", { placeholder: "/" })}
        {field("registerHref", af("linkRegister"), "?mode=signup")}
        {field("forgotHref", af("linkForgot"), "?mode=reset")}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
        {(
          [
            ["showRemember", af("showRemember")],
            ["showShowPassword", af("showShowPassword")],
            ["showForgot", af("showForgot")],
            ["showRegister", af("showRegister")],
            ["showOAuthGoogle", af("oauthGoogle")],
          ] as [BoolKey, string][]
        ).map(([k, label]) => (
          <label key={k} className="flex items-center gap-2 text-sm">
            {/* Wszystkie domyślnie włączone - także Google: `LoginFormView` czyta
                brak klucza jako `true`, a panel pokazywał wtedy wyłączenie. */}
            <Switch checked={b(k)} onCheckedChange={(v) => set(k, v)} />
            <span>{label}</span>
          </label>
        ))}
      </div>
    </div>
  );
}
