// Panel właściwości pojedynczego bloku EmailDoc. Wszystkie teksty są
// dwujęzyczne (PL/EN edytowane obok siebie), więc jeden dokument wysyła się
// w obu językach zależnie od subskrybenta.
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MediaPickerDialog } from "@/components/admin/media/MediaPickerDialog";
import { searchCampaignPosts } from "@/lib/newsletter-campaigns.functions";
import type { EmailBlock, EmailI18n, EmailPostListBlock } from "@/lib/newsletter/emailDoc";

type PostOption = { id: string; slug: string; title_pl: string | null; title_en: string | null };

export function CampaignBlockProperties({
  block,
  onChange,
  isPl,
}: {
  block: EmailBlock;
  onChange: (b: EmailBlock) => void;
  isPl: boolean;
}) {
  switch (block.type) {
    case "heading":
      return (
        <div className="space-y-2">
          <I18nField
            label={isPl ? "Tekst" : "Text"}
            value={block.text}
            onChange={(text) => onChange({ ...block, text })}
            isPl={isPl}
          />
          <div className="grid grid-cols-2 gap-2">
            <SelectField
              label={isPl ? "Poziom" : "Level"}
              value={String(block.level)}
              options={[
                { value: "1", label: "H1" },
                { value: "2", label: "H2" },
              ]}
              onChange={(v) => onChange({ ...block, level: v === "1" ? 1 : 2 })}
            />
            <AlignField
              value={block.align}
              onChange={(align) => onChange({ ...block, align })}
              isPl={isPl}
            />
          </div>
        </div>
      );
    case "paragraph":
      return (
        <div className="space-y-2">
          <I18nField
            label={isPl ? "Treść (dozwolone b, i, a, br)" : "Content (b, i, a, br allowed)"}
            value={block.html}
            onChange={(html) => onChange({ ...block, html })}
            multiline
            isPl={isPl}
          />
          <AlignField
            value={block.align}
            onChange={(align) => onChange({ ...block, align })}
            isPl={isPl}
          />
        </div>
      );
    case "image":
      return <ImageProps block={block} onChange={onChange} isPl={isPl} />;
    case "button":
      return (
        <div className="space-y-2">
          <I18nField
            label={isPl ? "Etykieta" : "Label"}
            value={block.label}
            onChange={(label) => onChange({ ...block, label })}
            isPl={isPl}
          />
          <TextField
            label="URL"
            value={block.url}
            placeholder="https://…"
            onChange={(url) => onChange({ ...block, url })}
          />
          <AlignField
            value={block.align}
            onChange={(align) => onChange({ ...block, align })}
            isPl={isPl}
          />
        </div>
      );
    case "quote":
      return (
        <div className="space-y-2">
          <I18nField
            label={isPl ? "Cytat" : "Quote"}
            value={block.text}
            onChange={(text) => onChange({ ...block, text })}
            multiline
            isPl={isPl}
          />
          <I18nField
            label={isPl ? "Autor" : "Attribution"}
            value={block.attribution}
            onChange={(attribution) => onChange({ ...block, attribution })}
            isPl={isPl}
          />
        </div>
      );
    case "spacer":
      return (
        <div>
          <Label className="text-[12px]">{isPl ? "Wysokość (px)" : "Height (px)"}</Label>
          <Input
            type="number"
            min={4}
            max={96}
            value={block.size}
            onChange={(e) => onChange({ ...block, size: Number(e.target.value) || 24 })}
            className="h-8 mt-1"
          />
        </div>
      );
    case "divider":
      return (
        <p className="text-[12px] text-muted-foreground">
          {isPl ? "Pozioma linia oddzielająca sekcje." : "Horizontal rule separating sections."}
        </p>
      );
    case "footer-note":
      return (
        <I18nField
          label={isPl ? "Nota (drobny tekst na dole)" : "Note (small text at the bottom)"}
          value={block.html}
          onChange={(html) => onChange({ ...block, html })}
          multiline
          isPl={isPl}
        />
      );
    case "post-list":
      return <PostListProps block={block} onChange={onChange} isPl={isPl} />;
  }
}

function I18nField({
  label,
  value,
  onChange,
  multiline,
  isPl,
}: {
  label: string;
  value: EmailI18n;
  onChange: (v: EmailI18n) => void;
  multiline?: boolean;
  isPl: boolean;
}) {
  const Field = multiline ? Textarea : Input;
  return (
    <div>
      <Label className="text-[12px]">{label}</Label>
      <div className="grid grid-cols-2 gap-2 mt-1">
        <Field
          value={value.pl}
          onChange={(e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
            onChange({ ...value, pl: e.target.value })
          }
          placeholder="PL"
          className={multiline ? "text-[12px] min-h-[64px]" : "h-8 text-[12px]"}
        />
        <Field
          value={value.en}
          onChange={(e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
            onChange({ ...value, en: e.target.value })
          }
          placeholder="EN"
          className={multiline ? "text-[12px] min-h-[64px]" : "h-8 text-[12px]"}
        />
      </div>
    </div>
  );
}

function TextField({
  label,
  value,
  placeholder,
  onChange,
}: {
  label: string;
  value: string;
  placeholder?: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <Label className="text-[12px]">{label}</Label>
      <Input
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 mt-1 text-[12px]"
      />
    </div>
  );
}

function SelectField({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <Label className="text-[12px]">{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="h-8 mt-1 text-[12px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function AlignField({
  value,
  onChange,
  isPl,
}: {
  value: "left" | "center";
  onChange: (v: "left" | "center") => void;
  isPl: boolean;
}) {
  return (
    <SelectField
      label={isPl ? "Wyrównanie" : "Alignment"}
      value={value}
      options={[
        { value: "left", label: isPl ? "Do lewej" : "Left" },
        { value: "center", label: isPl ? "Wyśrodkuj" : "Center" },
      ]}
      onChange={(v) => onChange(v === "center" ? "center" : "left")}
    />
  );
}

function ImageProps({
  block,
  onChange,
  isPl,
}: {
  block: Extract<EmailBlock, { type: "image" }>;
  onChange: (b: EmailBlock) => void;
  isPl: boolean;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  return (
    <div className="space-y-2">
      <div>
        <Label className="text-[12px]">{isPl ? "Obraz" : "Image"}</Label>
        <div className="flex items-center gap-2 mt-1">
          {block.url && (
            <img src={block.url} alt="" className="h-10 w-16 object-cover rounded border" />
          )}
          <Button type="button" variant="outline" size="sm" onClick={() => setPickerOpen(true)}>
            {block.url ? (isPl ? "Zmień" : "Change") : isPl ? "Wybierz" : "Choose"}
          </Button>
          {block.url && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onChange({ ...block, url: null })}
            >
              {isPl ? "Usuń" : "Remove"}
            </Button>
          )}
        </div>
      </div>
      <TextField
        label={isPl ? "Tekst alternatywny" : "Alt text"}
        value={block.alt}
        onChange={(alt) => onChange({ ...block, alt })}
      />
      <TextField
        label={isPl ? "Link (opcjonalnie)" : "Link (optional)"}
        value={block.href ?? ""}
        placeholder="https://…"
        onChange={(href) => onChange({ ...block, href: href || null })}
      />
      <MediaPickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        accept="image"
        onPick={(url) => {
          onChange({ ...block, url });
          setPickerOpen(false);
        }}
      />
    </div>
  );
}

function PostListProps({
  block,
  onChange,
  isPl,
}: {
  block: EmailPostListBlock;
  onChange: (b: EmailBlock) => void;
  isPl: boolean;
}) {
  return (
    <div className="space-y-2">
      <I18nField
        label={isPl ? "Nagłówek sekcji" : "Section heading"}
        value={block.heading}
        onChange={(heading) => onChange({ ...block, heading })}
        isPl={isPl}
      />
      <div className="grid grid-cols-2 gap-2">
        <SelectField
          label={isPl ? "Źródło" : "Source"}
          value={block.mode}
          options={[
            { value: "latest", label: isPl ? "Najnowsze" : "Latest" },
            { value: "manual", label: isPl ? "Ręcznie wybrane" : "Hand-picked" },
          ]}
          onChange={(v) => onChange({ ...block, mode: v === "manual" ? "manual" : "latest" })}
        />
        <SelectField
          label={isPl ? "Układ" : "Layout"}
          value={block.layout}
          options={[
            { value: "list", label: isPl ? "Lista" : "List" },
            { value: "cards", label: isPl ? "Karty (z obrazem)" : "Cards (with image)" },
          ]}
          onChange={(v) => onChange({ ...block, layout: v === "cards" ? "cards" : "list" })}
        />
      </div>
      {block.mode === "latest" ? (
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label className="text-[12px]">{isPl ? "Liczba wpisów" : "Post count"}</Label>
            <Input
              type="number"
              min={1}
              max={10}
              value={block.count}
              onChange={(e) =>
                onChange({
                  ...block,
                  count: Math.min(10, Math.max(1, Number(e.target.value) || 3)),
                })
              }
              className="h-8 mt-1 text-[12px]"
            />
          </div>
          <TextField
            label={isPl ? "Slug kategorii (opcj.)" : "Category slug (opt.)"}
            value={block.categorySlug ?? ""}
            onChange={(v) => onChange({ ...block, categorySlug: v || null })}
          />
        </div>
      ) : (
        <ManualPostPicker block={block} onChange={onChange} isPl={isPl} />
      )}
      <label className="flex items-center gap-2 text-[12px]">
        <Switch
          checked={block.showExcerpt}
          onCheckedChange={(v) => onChange({ ...block, showExcerpt: Boolean(v) })}
        />
        {isPl ? "Pokaż zajawki" : "Show excerpts"}
      </label>
    </div>
  );
}

function ManualPostPicker({
  block,
  onChange,
  isPl,
}: {
  block: EmailPostListBlock;
  onChange: (b: EmailBlock) => void;
  isPl: boolean;
}) {
  const [search, setSearch] = useState("");
  const searchFn = useServerFn(searchCampaignPosts);
  const resultsQ = useQuery({
    queryKey: ["campaign-post-search", search],
    queryFn: async () => {
      const r = await searchFn({ data: { search } });
      return JSON.parse((r as { json: string }).json) as PostOption[];
    },
  });
  const titleOf = (p: PostOption) => (isPl ? p.title_pl : p.title_en) || p.title_pl || p.slug;
  const selected = block.postIds;

  const toggle = (id: string) => {
    const next = selected.includes(id)
      ? selected.filter((x) => x !== id)
      : [...selected, id].slice(0, 10);
    onChange({ ...block, postIds: next });
  };

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={isPl ? "Szukaj wpisu…" : "Search a post…"}
          className="pl-8 h-8 text-[12px]"
        />
      </div>
      <p className="text-[11px] text-muted-foreground">
        {isPl ? "Wybrane" : "Selected"}: {selected.length}/10
      </p>
      <div className="max-h-48 overflow-y-auto rounded border divide-y">
        {(resultsQ.data ?? []).map((p) => (
          <label
            key={p.id}
            className="flex items-center gap-2 p-2 text-[12px] cursor-pointer hover:bg-muted/40"
          >
            <input
              type="checkbox"
              checked={selected.includes(p.id)}
              onChange={() => toggle(p.id)}
              className="accent-brand"
            />
            <span className="truncate">{titleOf(p)}</span>
          </label>
        ))}
        {(resultsQ.data ?? []).length === 0 && (
          <p className="p-2 text-[12px] text-muted-foreground">
            {isPl ? "Brak wyników." : "No results."}
          </p>
        )}
      </div>
    </div>
  );
}
