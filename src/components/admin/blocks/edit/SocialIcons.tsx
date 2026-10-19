import type { Block, Json } from "@/lib/blocks/types";
import { toJson } from "@/lib/content-model/json";
import { objList, str } from "@/components/blocks/renderer/data";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Plus, Trash2 } from "lucide-react";
import { useBlocksI18n } from "@/lib/blocks/i18n";
import { AdminSelect } from "../AdminSelect";

interface Props {
  block: Block;
  onChange: (next: Block) => void;
}
interface Item {
  [key: string]: Json;
  platform: string;
  url: string;
}

/** Każda ikona, którą umie narysować `renderSocialIcons` (`SOCIAL_ICON_MAP`). */
const PLATFORMS: readonly string[] = [
  "facebook",
  "x",
  "instagram",
  "youtube",
  "linkedin",
  "spotify",
  "tiktok",
  "github",
  "mail",
  "rss",
];

/**
 * Platforma tak, jak narysuje ją renderer: bez rozróżniania wielkości liter,
 * stary alias „twitter" to X, a nieznana platforma dostaje ikonę zastępczą RSS.
 */
function shownPlatform(platform: string): string {
  const key = platform.toLowerCase();
  if (key === "twitter") return "x";
  return PLATFORMS.includes(key) ? key : "rss";
}

/** Ikony socjalne (Gutenberg "Social Icons"). Pozycje czyta `objList`, jak renderer. */
export function SocialIconsBlock({ block, onChange }: Props) {
  const i18n = useBlocksI18n();
  const items: Item[] = objList(block.data, "items", (o) => ({
    ...o,
    platform: str(o, "platform"),
    url: str(o, "url"),
  }));
  const rawSize = str(block.data, "size", "md");
  const size = rawSize === "sm" || rawSize === "lg" ? rawSize : "md";
  const rawAlign = str(block.data, "align", "left");
  const align = rawAlign === "center" || rawAlign === "right" ? rawAlign : "left";

  const update = (next: Item[]) =>
    onChange({ ...block, data: { ...block.data, items: toJson(next) } });

  return (
    <div className="rounded-lg border border-dashed border-border p-3 space-y-2 bg-muted/20">
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium uppercase tracking-wide text-muted-foreground">
          {i18n.editor("socialIcons", "shellLabel")}
        </span>
        <div className="flex gap-2">
          <AdminSelect
            className="text-xs bg-background border border-border rounded px-2 py-1"
            value={size}
            onChange={(e) => onChange({ ...block, data: { ...block.data, size: e.target.value } })}
          >
            <option value="sm">{i18n.editor("common", "sizeSm")}</option>
            <option value="md">{i18n.editor("common", "sizeMd")}</option>
            <option value="lg">{i18n.editor("common", "sizeLg")}</option>
          </AdminSelect>
          <AdminSelect
            className="text-xs bg-background border border-border rounded px-2 py-1"
            value={align}
            onChange={(e) => onChange({ ...block, data: { ...block.data, align: e.target.value } })}
          >
            <option value="left">{i18n.editor("common", "alignLeft")}</option>
            <option value="center">{i18n.editor("common", "alignCenter")}</option>
            <option value="right">{i18n.editor("common", "alignRight")}</option>
          </AdminSelect>
        </div>
      </div>
      <div className="space-y-2">
        {items.map((it, i) => (
          <div key={i} className="grid grid-cols-[160px_1fr_auto] gap-2 items-center">
            <AdminSelect
              className="text-xs bg-background border border-border rounded px-2 py-2 h-9"
              value={shownPlatform(it.platform)}
              onChange={(e) => {
                const next = [...items];
                next[i] = { ...it, platform: e.target.value };
                update(next);
              }}
            >
              {PLATFORMS.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </AdminSelect>
            <Input
              value={it.url}
              placeholder={i18n.field("urlPh")}
              onChange={(e) => {
                const next = [...items];
                next[i] = { ...it, url: e.target.value };
                update(next);
              }}
            />
            <Button
              type="button"
              size="icon"
              variant="ghost"
              onClick={() => update(items.filter((_, j) => j !== i))}
              aria-label={i18n.editor("common", "remove")}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ))}
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => update([...items, { platform: "facebook", url: "" }])}
        >
          <Plus className="h-4 w-4 mr-1" /> {i18n.editor("socialIcons", "add")}
        </Button>
      </div>
    </div>
  );
}
