import type { Block } from "@/lib/blocks/types";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { LogIn } from "lucide-react";
import { useBlocksI18n } from "@/lib/blocks/i18n";

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
  | "showRemember"
  | "showShowPassword"
  | "showForgot"
  | "showRegister"
  | "showOAuthGoogle";

export function LoginFormBlock({ block, onChange }: Props) {
  const i18n = useBlocksI18n();
  const s = (k: Key, fallback = "") => String(block.data[k] ?? fallback);
  const b = (k: BoolKey, fallback = true) =>
    block.data[k] === undefined ? fallback : Boolean(block.data[k]);
  const set = (k: string, v: string | boolean) =>
    onChange({ ...block, data: { ...block.data, [k]: v } });

  return (
    <div className="not-prose space-y-3 rounded-md border border-border bg-muted/30 p-3">
      <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
        <LogIn className="w-3.5 h-3.5" /> Formularz logowania
        <select
          value={s("variant", "card")}
          onChange={(e) => set("variant", e.target.value)}
          className="ml-auto bg-background border border-border rounded px-1 py-0.5 text-[11px] normal-case tracking-normal"
        >
          <option value="card">{i18n.editor("newsletter", "variantCard")}</option>
          <option value="plain">Bez ramki</option>
          <option value="split">Split (z brand panelem)</option>
        </select>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label className="text-[11px] uppercase text-muted-foreground">Tytuł (PL)</Label>
          <Input value={s("title_pl")} onChange={(e) => set("title_pl", e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label className="text-[11px] uppercase text-muted-foreground">Title (EN)</Label>
          <Input value={s("title_en")} onChange={(e) => set("title_en", e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label className="text-[11px] uppercase text-muted-foreground">Podtytuł (PL)</Label>
          <Input value={s("subtitle_pl")} onChange={(e) => set("subtitle_pl", e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label className="text-[11px] uppercase text-muted-foreground">Subtitle (EN)</Label>
          <Input value={s("subtitle_en")} onChange={(e) => set("subtitle_en", e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label className="text-[11px] uppercase text-muted-foreground">
            Etykieta przycisku (PL)
          </Label>
          <Input
            value={s("submitLabel_pl")}
            onChange={(e) => set("submitLabel_pl", e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-[11px] uppercase text-muted-foreground">Submit label (EN)</Label>
          <Input
            value={s("submitLabel_en")}
            onChange={(e) => set("submitLabel_en", e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-[11px] uppercase text-muted-foreground">
            Redirect po logowaniu
          </Label>
          <Input
            value={s("redirectTo", "/")}
            onChange={(e) => set("redirectTo", e.target.value)}
            placeholder="/"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-[11px] uppercase text-muted-foreground">Link „Rejestracja"</Label>
          <Input
            value={s("registerHref", "?mode=signup")}
            onChange={(e) => set("registerHref", e.target.value)}
          />
        </div>
        <div className="space-y-1 md:col-span-2">
          <Label className="text-[11px] uppercase text-muted-foreground">
            Link „Zapomniałem hasła"
          </Label>
          <Input
            value={s("forgotHref", "?mode=reset")}
            onChange={(e) => set("forgotHref", e.target.value)}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
        {(
          [
            ["showRemember", "Pokaż „Zapamiętaj mnie"],
            ["showShowPassword", "Pokaż „Pokaż hasło"],
            ["showForgot", "Pokaż „Zapomniałem hasła"],
            ["showRegister", "Pokaż link do rejestracji"],
            ["showOAuthGoogle", "Logowanie Google"],
          ] as [BoolKey, string][]
        ).map(([k, label]) => (
          <label key={k} className="flex items-center gap-2 text-sm">
            <Switch checked={b(k, k !== "showOAuthGoogle")} onCheckedChange={(v) => set(k, v)} />
            <span>{label}</span>
          </label>
        ))}
      </div>
    </div>
  );
}
