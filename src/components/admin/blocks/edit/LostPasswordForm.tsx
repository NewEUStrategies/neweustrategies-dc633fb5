import type { Block } from "@/lib/blocks/types";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { KeyRound } from "lucide-react";

interface Props {
  block: Block;
  onChange: (next: Block) => void;
}

export function LostPasswordFormBlock({ block, onChange }: Props) {
  const s = (k: string, fallback = "") => String(block.data[k] ?? fallback);
  const set = (k: string, v: string) => onChange({ ...block, data: { ...block.data, [k]: v } });

  return (
    <div className="not-prose space-y-3 rounded-md border border-border bg-muted/30 p-3">
      <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
        <KeyRound className="w-3.5 h-3.5" /> Reset hasła - „zapomniałem"
        <select
          value={s("variant", "card")}
          onChange={(e) => set("variant", e.target.value)}
          className="ml-auto bg-background border border-border rounded px-1 py-0.5 text-[11px] normal-case tracking-normal"
        >
          <option value="card">Karta</option>
          <option value="plain">Bez ramki</option>
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
        <div className="space-y-1 md:col-span-2">
          <Label className="text-[11px] uppercase text-muted-foreground">Podtytuł (PL)</Label>
          <Input value={s("subtitle_pl")} onChange={(e) => set("subtitle_pl", e.target.value)} />
        </div>
        <div className="space-y-1 md:col-span-2">
          <Label className="text-[11px] uppercase text-muted-foreground">Subtitle (EN)</Label>
          <Input value={s("subtitle_en")} onChange={(e) => set("subtitle_en", e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label className="text-[11px] uppercase text-muted-foreground">Strona resetu (link w e-mailu)</Label>
          <Input value={s("redirectTo", "/reset-password")} onChange={(e) => set("redirectTo", e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label className="text-[11px] uppercase text-muted-foreground">Link „Powrót do logowania"</Label>
          <Input value={s("loginHref", "?mode=signin")} onChange={(e) => set("loginHref", e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label className="text-[11px] uppercase text-muted-foreground">Etykieta przycisku (PL)</Label>
          <Input value={s("submitLabel_pl")} onChange={(e) => set("submitLabel_pl", e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label className="text-[11px] uppercase text-muted-foreground">Submit label (EN)</Label>
          <Input value={s("submitLabel_en")} onChange={(e) => set("submitLabel_en", e.target.value)} />
        </div>
      </div>
    </div>
  );
}
