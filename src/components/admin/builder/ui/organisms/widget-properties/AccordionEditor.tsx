// Organism: FAQ-style accordion editor.
import { toJson } from "@/lib/builder/types";
import type { WidgetNode, Json } from "@/lib/builder/types";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { PropField, ItemFrame } from "../../atoms";
import { VariantPicker } from "../../molecules/VariantPicker";
import { ListShell } from "./ListShell";
import { itemsOf, type Item } from "./shared";
import { asOneOf } from "@/lib/content-model/contentValue";
import { useTranslation } from "react-i18next";
import "@/lib/i18n-builder";

interface Props {
  c: WidgetNode["content"];
  lang: "pl" | "en";
  setContent: (k: string, v: Json) => void;
}

/** Warianty, które renderer accordionu (SimpleWidgets) naprawdę rysuje. */
const ACCORDION_VARIANTS = ["bordered", "separated", "minimal"] as const;

export function AccordionEditor({ c, lang, setContent }: Props) {
  const { t } = useTranslation();
  const items = itemsOf(c, "items");
  const update = (next: Item[]) => setContent("items", toJson(next));
  const addItem = () => {
    // Seedujemy OBA języki. Wcześniej pozycja dodana w EN nie miała kluczy
    // `q_pl` / `a_pl`, więc polska wersja strony renderowała puste pytanie.
    // `lng` wymusza konkretny język niezależnie od aktywnej lokalizacji panelu.
    const seeded: Item = {
      q_pl: t("builder.accordionEditor.defaultQuestion", {
        lng: "pl",
        defaultValue: "Nowe pytanie",
      }),
      q_en: t("builder.accordionEditor.defaultQuestion", {
        lng: "en",
        defaultValue: "New question",
      }),
      a_pl: t("builder.accordionEditor.defaultAnswer", { lng: "pl", defaultValue: "Odpowiedź…" }),
      a_en: t("builder.accordionEditor.defaultAnswer", { lng: "en", defaultValue: "Answer…" }),
    };
    update([...items, seeded]);
  };
  const variant = asOneOf(c.variant, ACCORDION_VARIANTS, "bordered");
  const variantOptions = [
    {
      value: "bordered",
      label: t("builder.accordionEditor.variantBordered", { defaultValue: "Ramka" }),
    },
    {
      value: "separated",
      label: t("builder.accordionEditor.variantSeparated", { defaultValue: "Osobne karty" }),
    },
    {
      value: "minimal",
      label: t("builder.accordionEditor.variantMinimal", { defaultValue: "Minimalny" }),
    },
  ];
  return (
    <div className="space-y-3">
      <VariantPicker
        label={t("builder.accordionEditor.variant", { defaultValue: "Wariant" })}
        value={variant}
        options={variantOptions}
        onChange={(next) => setContent("variant", next)}
        hint={t("builder.accordionEditor.variantHint", {
          defaultValue: "Ramka, osobne karty albo same linie rozdzielające.",
        })}
      />
      <ListShell title={t("builder.accordionEditor.title")} items={items} onAdd={addItem}>
        <div className="space-y-2">
          {items.map((it, i) => (
            <ItemFrame
              key={i}
              title={t("builder.accordionEditor.item", { n: i + 1 })}
              onRemove={() => update(items.filter((_, j) => j !== i))}
            >
              <PropField
                label={t("builder.accordionEditor.question", { lang: lang.toUpperCase() })}
              >
                <Input
                  value={typeof it[`q_${lang}`] === "string" ? (it[`q_${lang}`] as string) : ""}
                  onChange={(e) =>
                    update(
                      items.map((x, j) => (j === i ? { ...x, [`q_${lang}`]: e.target.value } : x)),
                    )
                  }
                  className="h-8 text-xs"
                />
              </PropField>
              <PropField label={t("builder.accordionEditor.answer", { lang: lang.toUpperCase() })}>
                <Textarea
                  rows={3}
                  value={typeof it[`a_${lang}`] === "string" ? (it[`a_${lang}`] as string) : ""}
                  onChange={(e) =>
                    update(
                      items.map((x, j) => (j === i ? { ...x, [`a_${lang}`]: e.target.value } : x)),
                    )
                  }
                  className="text-xs font-mono"
                />
              </PropField>
            </ItemFrame>
          ))}
        </div>
      </ListShell>
    </div>
  );
}
