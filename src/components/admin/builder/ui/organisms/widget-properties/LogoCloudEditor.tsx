// Organism: logo cloud (marquee) editor. Lista logo z URL, linkiem, alt.
// Ustawienia: nagłówek PL/EN, prędkość (s), pauza na hover, fade edges, grayscale.
import { toJson } from "@/lib/builder/types";
import type { WidgetNode, Json } from "@/lib/builder/types";
import { Input } from "@/components/ui/input";
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

export function LogoCloudEditor({ c, lang, setContent }: Props) {
  const { t } = useTranslation();
  const logos = itemsOf(c, "logos");
  const commit = (next: Item[]) => setContent("logos", toJson(next));
  const patch = (i: number, p: Partial<Item>) =>
    commit(logos.map((x, j) => (j === i ? { ...x, ...p } : x)));
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= logos.length) return;
    const next = logos.slice();
    [next[i], next[j]] = [next[j], next[i]];
    commit(next);
  };
  const remove = (i: number) => commit(logos.filter((_, j) => j !== i));
  const add = () =>
    commit([...logos, { label: `Brand ${logos.length + 1}`, src: "", href: "", alt: "" }]);

  const speed = typeof c.speedSeconds === "number" ? c.speedSeconds : 40;
  const pauseOnHover = c.pauseOnHover !== false;
  const fadeEdges = c.fadeEdges !== false;
  const grayscale = c.grayscale !== false;

  return (
    <div className="space-y-3">
      <PropField label={t("builder.logoCloudEditor.heading", { lang: lang.toUpperCase() })}>
        <Input
          value={strOf(c[`heading_${lang}`])}
          onChange={(e) => setContent(`heading_${lang}`, e.target.value)}
          className="h-8 text-xs"
        />
      </PropField>
      <div className="grid grid-cols-2 gap-2">
        <PropField label={t("builder.logoCloudEditor.speed")}>
          <Input
            type="number"
            min={8}
            max={180}
            value={speed}
            onChange={(e) => setContent("speedSeconds", Number(e.target.value) || 40)}
            className="h-8 text-xs"
          />
        </PropField>
        <PropField label={t("builder.logoCloudEditor.toggles")}>
          <div className="flex flex-col gap-1 text-[11px]">
            <label className="inline-flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={pauseOnHover}
                onChange={(e) => setContent("pauseOnHover", e.target.checked)}
              />
              {t("builder.logoCloudEditor.pauseOnHover")}
            </label>
            <label className="inline-flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={fadeEdges}
                onChange={(e) => setContent("fadeEdges", e.target.checked)}
              />
              {t("builder.logoCloudEditor.fadeEdges")}
            </label>
            <label className="inline-flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={grayscale}
                onChange={(e) => setContent("grayscale", e.target.checked)}
              />
              {t("builder.logoCloudEditor.grayscale")}
            </label>
          </div>
        </PropField>
      </div>

      <ListShell title={t("builder.logoCloudEditor.logos")} items={logos} onAdd={add}>
        <div className="space-y-2">
          {logos.map((it, i) => (
            <ItemFrame
              key={i}
              title={strOf(it.label) || `#${i + 1}`}
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
              <PropField label={t("builder.logoCloudEditor.label")}>
                <Input
                  value={strOf(it.label)}
                  onChange={(e) => patch(i, { label: e.target.value })}
                  className="h-8 text-xs"
                />
              </PropField>
              <PropField label={t("builder.logoCloudEditor.src")}>
                <Input
                  value={strOf(it.src)}
                  onChange={(e) => patch(i, { src: e.target.value })}
                  placeholder="https://…"
                  className="h-8 text-xs"
                />
              </PropField>
              <PropField label={t("builder.logoCloudEditor.href")}>
                <Input
                  value={strOf(it.href)}
                  onChange={(e) => patch(i, { href: e.target.value })}
                  placeholder="https://…"
                  className="h-8 text-xs"
                />
              </PropField>
              <PropField label={t("builder.logoCloudEditor.alt")}>
                <Input
                  value={strOf(it.alt)}
                  onChange={(e) => patch(i, { alt: e.target.value })}
                  className="h-8 text-xs"
                />
              </PropField>
            </ItemFrame>
          ))}
        </div>
      </ListShell>
    </div>
  );
}
