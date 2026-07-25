// Pola metadanych Apple Podcasts Connect - jeden komponent dla kanału
// sieciowego (/admin/podcasts -> Ustawienia) i, w przyszłości, dla programu.
//
// Kanał bez `<itunes:category>`, `<itunes:explicit>`, `<itunes:image>` i
// e-maila właściciela nie zostanie przyjęty przez Apple; do 25.07 nie było ich
// gdzie wpisać, więc feed wychodził nieprzyjmowalny mimo poprawnej reszty.
// Kategoria i podkategoria pochodzą z zamkniętej taksonomii Apple (jedno źródło:
// `@/lib/seo/applePodcastCategories`), żeby redakcja nie mogła wpisać wartości,
// którą Apple odrzuci.
import * as React from "react";
import { useTranslation } from "react-i18next";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  APPLE_CATEGORY_NAMES,
  DEFAULT_APPLE_CATEGORY,
  appleSubcategories,
} from "@/lib/seo/applePodcastCategories";
import type { PodcastShowType } from "@/lib/podcast/types";

const NO_SUBCATEGORY = "__none__";

export interface ApplePodcastMetaValue {
  author: string;
  ownerName: string;
  ownerEmail: string;
  category: string;
  subcategory: string;
  explicit: boolean;
  showType: PodcastShowType;
  imageUrl: string;
  copyright: string;
}

interface Props {
  value: ApplePodcastMetaValue;
  onChange: (patch: Partial<ApplePodcastMetaValue>) => void;
}

function Field({
  htmlFor,
  label,
  hint,
  children,
}: {
  htmlFor: string;
  label: string;
  hint?: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function ApplePodcastMetaFields({ value, onChange }: Props): React.ReactElement {
  const { t } = useTranslation();
  const category = APPLE_CATEGORY_NAMES.includes(value.category)
    ? value.category
    : DEFAULT_APPLE_CATEGORY;
  const subcategories = appleSubcategories(category);
  const subcategory = subcategories.includes(value.subcategory)
    ? value.subcategory
    : NO_SUBCATEGORY;

  return (
    <section className="grid gap-4 rounded-lg border border-border bg-muted/20 p-4">
      <header className="grid gap-1">
        <h3 className="text-sm font-semibold">{t("adminPodcasts.settings.apple.heading")}</h3>
        <p className="text-xs text-muted-foreground">{t("adminPodcasts.settings.apple.intro")}</p>
      </header>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field htmlFor="itunes-author" label={t("adminPodcasts.settings.apple.author")}>
          <Input
            id="itunes-author"
            value={value.author}
            onChange={(e) => onChange({ author: e.target.value })}
          />
        </Field>
        <Field htmlFor="itunes-owner-name" label={t("adminPodcasts.settings.apple.ownerName")}>
          <Input
            id="itunes-owner-name"
            value={value.ownerName}
            onChange={(e) => onChange({ ownerName: e.target.value })}
          />
        </Field>
      </div>

      <Field
        htmlFor="itunes-owner-email"
        label={t("adminPodcasts.settings.apple.ownerEmail")}
        hint={t("adminPodcasts.settings.apple.ownerEmailHint")}
      >
        <Input
          id="itunes-owner-email"
          type="email"
          inputMode="email"
          autoComplete="email"
          value={value.ownerEmail}
          onChange={(e) => onChange({ ownerEmail: e.target.value })}
        />
      </Field>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field htmlFor="itunes-category" label={t("adminPodcasts.settings.apple.category")}>
          <Select
            value={category}
            onValueChange={(v) => onChange({ category: v, subcategory: "" })}
          >
            <SelectTrigger id="itunes-category">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {APPLE_CATEGORY_NAMES.map((name) => (
                <SelectItem key={name} value={name}>
                  {name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field htmlFor="itunes-subcategory" label={t("adminPodcasts.settings.apple.subcategory")}>
          <Select
            value={subcategory}
            onValueChange={(v) => onChange({ subcategory: v === NO_SUBCATEGORY ? "" : v })}
            disabled={subcategories.length === 0}
          >
            <SelectTrigger id="itunes-subcategory">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_SUBCATEGORY}>
                {t("adminPodcasts.settings.apple.subcategoryNone")}
              </SelectItem>
              {subcategories.map((name) => (
                <SelectItem key={name} value={name}>
                  {name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </div>

      <Field
        htmlFor="itunes-image"
        label={t("adminPodcasts.settings.apple.image")}
        hint={t("adminPodcasts.settings.apple.imageHint")}
      >
        <Input
          id="itunes-image"
          value={value.imageUrl}
          onChange={(e) => onChange({ imageUrl: e.target.value })}
          placeholder="https://…/cover-3000x3000.jpg"
        />
      </Field>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field htmlFor="itunes-type" label={t("adminPodcasts.settings.apple.showType")}>
          <Select
            value={value.showType}
            onValueChange={(v) => onChange({ showType: v === "serial" ? "serial" : "episodic" })}
          >
            <SelectTrigger id="itunes-type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="episodic">
                {t("adminPodcasts.settings.apple.showTypeEpisodic")}
              </SelectItem>
              <SelectItem value="serial">
                {t("adminPodcasts.settings.apple.showTypeSerial")}
              </SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Field htmlFor="itunes-copyright" label={t("adminPodcasts.settings.apple.copyright")}>
          <Input
            id="itunes-copyright"
            value={value.copyright}
            onChange={(e) => onChange({ copyright: e.target.value })}
          />
        </Field>
      </div>

      <label className="flex items-center justify-between gap-4 py-1">
        <span className="text-sm">{t("adminPodcasts.settings.apple.explicit")}</span>
        <Switch
          checked={value.explicit}
          onCheckedChange={(v) => onChange({ explicit: v })}
          aria-label={t("adminPodcasts.settings.apple.explicit")}
        />
      </label>
    </section>
  );
}
