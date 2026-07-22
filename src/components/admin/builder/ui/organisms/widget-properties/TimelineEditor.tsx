// Organism: timeline (Elementor-style) editor. Lista wpisów - nagłówek daty
// lub pojedynczy element z ikoną/awatarami, tytułem, opisem i autorem akcji.
// Grafiki renderują się z 6px roundingiem, kolory z tokenów (dark/light).
import { toJson } from "@/lib/builder/types";
import type { WidgetNode, Json } from "@/lib/builder/types";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { PropField, ItemFrame } from "../../atoms";
import { ListShell } from "./ListShell";
import { itemsOf, type Item } from "./shared";
import { useTranslation } from "react-i18next";
import "@/lib/i18n-builder";

interface Props {
  c: WidgetNode["content"];
  lang: "pl" | "en";
  setContent: (k: string, v: Json) => void;
}

const strOf = (v: unknown): string => (typeof v === "string" ? v : "");

export function TimelineEditor({ c, lang, setContent }: Props) {
  const { t } = useTranslation();
  const entries = itemsOf(c, "entries");
  const commit = (next: Item[]) => setContent("entries", toJson(next));

  const patch = (i: number, patchObj: Partial<Item>) =>
    commit(entries.map((x, j) => (j === i ? { ...x, ...patchObj } : x)));

  const remove = (i: number) => commit(entries.filter((_, j) => j !== i));
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= entries.length) return;
    const next = entries.slice();
    [next[i], next[j]] = [next[j], next[i]];
    commit(next);
  };

  const addHeading = () =>
    commit([
      ...entries,
      { type: "heading", date_pl: "Nowa data", date_en: "New date" },
    ]);
  const addItem = () =>
    commit([
      ...entries,
      {
        type: "item",
        iconType: "avatar",
        avatar: "",
        initials: "?",
        iconName: "FileText",
        titleIconName: "",
        title_pl: "Nowe wydarzenie",
        title_en: "New event",
        desc_pl: "",
        desc_en: "",
        actorName: "",
        actorAvatar: "",
        actorInitials: "",
        actorHref: "",
      },
    ]);

  return (
    <ListShell
      title={t("builder.timelineEditor.sectionTitle")}
      items={entries}
      onAdd={addItem}
    >
      <div className="flex gap-1 -mt-1 mb-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 text-[11px] flex-1"
          onClick={addItem}
        >
          + {t("builder.timelineEditor.addItem")}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 text-[11px] flex-1"
          onClick={addHeading}
        >
          + {t("builder.timelineEditor.addHeading")}
        </Button>
      </div>
      <div className="space-y-2">
        {entries.map((it, i) => {
          const kind = strOf(it.type) || "item";
          if (kind === "heading") {
            return (
              <ItemFrame
                key={i}
                title={`${t("builder.timelineEditor.heading")} #${i + 1}`}
                onRemove={() => remove(i)}
              >
                <div className="flex gap-1 mb-1">
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-6 px-1 text-[10px]"
                    onClick={() => move(i, -1)}
                  >
                    ↑
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-6 px-1 text-[10px]"
                    onClick={() => move(i, 1)}
                  >
                    ↓
                  </Button>
                </div>
                <PropField
                  label={t("builder.timelineEditor.date", { lang: lang.toUpperCase() })}
                >
                  <Input
                    value={strOf(it[`date_${lang}`])}
                    onChange={(e) => patch(i, { [`date_${lang}`]: e.target.value })}
                    className="h-8 text-xs"
                  />
                </PropField>
              </ItemFrame>
            );
          }
          const iconType = strOf(it.iconType) || "avatar";
          return (
            <ItemFrame
              key={i}
              title={`${t("builder.timelineEditor.item")} #${i + 1}`}
              onRemove={() => remove(i)}
            >
              <div className="flex gap-1 mb-1">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-6 px-1 text-[10px]"
                  onClick={() => move(i, -1)}
                >
                  ↑
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-6 px-1 text-[10px]"
                  onClick={() => move(i, 1)}
                >
                  ↓
                </Button>
              </div>
              <PropField label={t("builder.timelineEditor.iconType")}>
                <Select
                  value={iconType}
                  onValueChange={(v) => patch(i, { iconType: v })}
                >
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="avatar" className="text-xs">
                      {t("builder.timelineEditor.iconAvatar")}
                    </SelectItem>
                    <SelectItem value="initials" className="text-xs">
                      {t("builder.timelineEditor.iconInitials")}
                    </SelectItem>
                    <SelectItem value="lucide" className="text-xs">
                      {t("builder.timelineEditor.iconLucide")}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </PropField>
              {iconType === "avatar" && (
                <PropField label={t("builder.timelineEditor.avatarUrl")}>
                  <Input
                    value={strOf(it.avatar)}
                    onChange={(e) => patch(i, { avatar: e.target.value })}
                    placeholder="https://…"
                    className="h-8 text-xs"
                  />
                </PropField>
              )}
              {iconType === "initials" && (
                <PropField label={t("builder.timelineEditor.initials")}>
                  <Input
                    value={strOf(it.initials)}
                    onChange={(e) => patch(i, { initials: e.target.value })}
                    maxLength={2}
                    className="h-8 text-xs"
                  />
                </PropField>
              )}
              {iconType === "lucide" && (
                <PropField label={t("builder.timelineEditor.iconName")}>
                  <Input
                    value={strOf(it.iconName)}
                    onChange={(e) => patch(i, { iconName: e.target.value })}
                    placeholder="Flag, FileText, Clock…"
                    className="h-8 text-xs"
                  />
                </PropField>
              )}
              <PropField label={t("builder.timelineEditor.titleIconName")}>
                <Input
                  value={strOf(it.titleIconName)}
                  onChange={(e) => patch(i, { titleIconName: e.target.value })}
                  placeholder="FileText (opcjonalnie)"
                  className="h-8 text-xs"
                />
              </PropField>
              <PropField
                label={t("builder.timelineEditor.itemTitle", { lang: lang.toUpperCase() })}
              >
                <Input
                  value={strOf(it[`title_${lang}`])}
                  onChange={(e) => patch(i, { [`title_${lang}`]: e.target.value })}
                  className="h-8 text-xs"
                />
              </PropField>
              <PropField
                label={t("builder.timelineEditor.desc", { lang: lang.toUpperCase() })}
              >
                <Textarea
                  rows={2}
                  value={strOf(it[`desc_${lang}`])}
                  onChange={(e) => patch(i, { [`desc_${lang}`]: e.target.value })}
                  className="text-xs"
                />
              </PropField>
              <PropField label={t("builder.timelineEditor.actorName")}>
                <Input
                  value={strOf(it.actorName)}
                  onChange={(e) => patch(i, { actorName: e.target.value })}
                  className="h-8 text-xs"
                />
              </PropField>
              <PropField label={t("builder.timelineEditor.actorAvatar")}>
                <Input
                  value={strOf(it.actorAvatar)}
                  onChange={(e) => patch(i, { actorAvatar: e.target.value })}
                  placeholder="https://…"
                  className="h-8 text-xs"
                />
              </PropField>
              <PropField label={t("builder.timelineEditor.actorInitials")}>
                <Input
                  value={strOf(it.actorInitials)}
                  onChange={(e) => patch(i, { actorInitials: e.target.value })}
                  maxLength={2}
                  className="h-8 text-xs"
                />
              </PropField>
              <PropField label={t("builder.timelineEditor.actorHref")}>
                <Input
                  value={strOf(it.actorHref)}
                  onChange={(e) => patch(i, { actorHref: e.target.value })}
                  placeholder="/author/…"
                  className="h-8 text-xs"
                />
              </PropField>
            </ItemFrame>
          );
        })}
      </div>
    </ListShell>
  );
}
