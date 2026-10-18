import { useId } from "react";
import type { Block } from "@/lib/blocks/types";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ShieldCheck } from "lucide-react";
import { useBlocksI18n } from "@/lib/blocks/i18n";
import "@/lib/i18n-admin-blocks";
import { readAuthFlag } from "@/lib/content-model/authFormSettings";
import { asNum } from "@/lib/content-model/contentValue";
import { AdminSelect } from "../AdminSelect";

interface Props {
  block: Block;
  onChange: (next: Block) => void;
}

const CONFIRM_KEYS = ["showPasswordConfirm", "showConfirmPassword"] as const;

/**
 * Górna granica pola. Strona przyjmuje do 128 (`asNumInRange(…, 6, 128)`),
 * ale Supabase odrzuca hasła dłuższe niż 72 znaki - minimum powyżej tego
 * zamyka reset hasła na amen. Wpis spoza pola zapisuje więc granicę pola.
 */
const MIN_LENGTH_MAX = 64;

export function ResetPasswordFormBlock({ block, onChange }: Props) {
  const i18n = useBlocksI18n();
  const af = (k: string) => i18n.editor("authForms", k);
  const uid = useId();
  // Odczyt tą samą koercją, co renderer (`AuthFormBlocks`): tekst wyłącznie
  // jako napis, liczba przez `asNum` (słowo z importu = domyślne 8, a nie
  // `NaN` w polu), przełącznik przez `readAuthFlag` („0" = wyłączone).
  const s = (k: string, fallback = "") => {
    const v = block.data[k];
    return typeof v === "string" ? v : fallback;
  };
  const minLength = asNum(block.data.minLength, 8);
  const set = (k: string, v: string | number | boolean) =>
    onChange({ ...block, data: { ...block.data, [k]: v } });
  // Potwierdzenie hasła czytamy tak jak `ResetPasswordFormView`: kanoniczny
  // klucz schematu przed historycznym. Zapis trafia w klucz, który strona
  // przeczyta PIERWSZY - inaczej przełącznik obok klucza kanonicznego nic by
  // na stronie nie zmieniał.
  const confirmShown = readAuthFlag(block.data, CONFIRM_KEYS, true);
  const confirmKey =
    CONFIRM_KEYS.find((k) => block.data[k] !== undefined && block.data[k] !== null) ??
    "showConfirmPassword";

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
        {field("title_pl", af("fTitlePl"))}
        {field("title_en", af("fTitleEn"))}
        <div className="space-y-1">
          <Label
            htmlFor={`${uid}-minLength`}
            className="text-[11px] uppercase text-muted-foreground"
          >
            {af("minLength")}
          </Label>
          <Input
            id={`${uid}-minLength`}
            type="number"
            min={6}
            max={MIN_LENGTH_MAX}
            value={minLength}
            onChange={(e) =>
              set("minLength", Math.min(MIN_LENGTH_MAX, Number(e.target.value) || 8))
            }
          />
        </div>
        {field("redirectTo", af("redirectSave"), "/login")}
        {field("submitLabel_pl", af("fSubmitPl"))}
        {field("submitLabel_en", af("fSubmitEn"))}
      </div>
      <label className="flex items-center gap-2 text-sm pt-1">
        <Switch checked={confirmShown} onCheckedChange={(v) => set(confirmKey, v)} />
        <span>{af("resetConfirmPassword")}</span>
      </label>
    </div>
  );
}
