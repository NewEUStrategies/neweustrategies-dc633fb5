// Panel właściwości pojedynczego bloku EmailDoc. Wszystkie teksty są
// dwujęzyczne (PL/EN edytowane obok siebie), więc jeden dokument wysyła się
// w obu językach zależnie od subskrybenta.
import { useTranslation } from "react-i18next";
import { uiLang } from "@/lib/i18n/format";
import { pickLocalized } from "@/lib/i18n/pickLocalized";
import { ensureI18n as ensureNewsletterAdminI18n } from "@/lib/i18n-newsletter-admin";
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
import {
  clampPostCount,
  MAX_POST_LIST_ITEMS,
  nullIfEmpty,
  spacerSize,
  togglePostId,
} from "./campaignBlocks";
import type { EmailBlock, EmailI18n, EmailPostListBlock } from "@/lib/newsletter/emailDoc";

type PostOption = { id: string; slug: string; title_pl: string | null; title_en: string | null };

export function CampaignBlockProperties({
  block,
  onChange,
}: {
  block: EmailBlock;
  onChange: (b: EmailBlock) => void;
}) {
  ensureNewsletterAdminI18n();
  const { t } = useTranslation();
  switch (block.type) {
    case "heading":
      return (
        <div className="space-y-2">
          <I18nField
            label={t("adminNewsletter.blockProps.text")}
            value={block.text}
            onChange={(text) => onChange({ ...block, text })}
          />
          <div className="grid grid-cols-2 gap-2">
            <SelectField
              label={t("adminNewsletter.blockProps.level")}
              value={String(block.level)}
              options={[
                { value: "1", label: "H1" },
                { value: "2", label: "H2" },
              ]}
              onChange={(v) => onChange({ ...block, level: v === "1" ? 1 : 2 })}
            />
            <AlignField value={block.align} onChange={(align) => onChange({ ...block, align })} />
          </div>
        </div>
      );
    case "paragraph":
      return (
        <div className="space-y-2">
          <I18nField
            label={t("adminNewsletter.blockProps.richContent")}
            value={block.html}
            onChange={(html) => onChange({ ...block, html })}
            multiline
          />
          <AlignField value={block.align} onChange={(align) => onChange({ ...block, align })} />
        </div>
      );
    case "image":
      return <ImageProps block={block} onChange={onChange} />;
    case "button":
      return (
        <div className="space-y-2">
          <I18nField
            label={t("adminNewsletter.blockProps.label")}
            value={block.label}
            onChange={(label) => onChange({ ...block, label })}
          />
          <TextField
            label="URL"
            value={block.url}
            placeholder="https://…"
            onChange={(url) => onChange({ ...block, url })}
          />
          <AlignField value={block.align} onChange={(align) => onChange({ ...block, align })} />
        </div>
      );
    case "quote":
      return (
        <div className="space-y-2">
          <I18nField
            label={t("adminNewsletter.blockProps.quote")}
            value={block.text}
            onChange={(text) => onChange({ ...block, text })}
            multiline
          />
          <I18nField
            label={t("adminNewsletter.blockProps.attribution")}
            value={block.attribution}
            onChange={(attribution) => onChange({ ...block, attribution })}
          />
        </div>
      );
    case "spacer":
      return (
        <div>
          <Label className="text-[12px]">{t("adminNewsletter.blockProps.heightPx")}</Label>
          <Input
            type="number"
            min={4}
            max={96}
            value={block.size}
            onChange={(e) => onChange({ ...block, size: spacerSize(e.target.value) })}
            className="h-8 mt-1"
          />
        </div>
      );
    case "divider":
      return (
        <p className="text-[12px] text-muted-foreground">
          {t("adminNewsletter.blockProps.dividerHint")}
        </p>
      );
    case "footer-note":
      return (
        <I18nField
          label={t("adminNewsletter.blockProps.footerNote")}
          value={block.html}
          onChange={(html) => onChange({ ...block, html })}
          multiline
        />
      );
    case "post-list":
      return <PostListProps block={block} onChange={onChange} />;
  }
}

function I18nField({
  label,
  value,
  onChange,
  multiline,
}: {
  label: string;
  value: EmailI18n;
  onChange: (v: EmailI18n) => void;
  multiline?: boolean;
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
}: {
  value: "left" | "center";
  onChange: (v: "left" | "center") => void;
}) {
  ensureNewsletterAdminI18n();
  const { t } = useTranslation();
  return (
    <SelectField
      label={t("adminNewsletter.blockProps.alignment")}
      value={value}
      options={[
        { value: "left", label: t("adminNewsletter.blockProps.alignLeft") },
        { value: "center", label: t("adminNewsletter.blockProps.alignCenter") },
      ]}
      onChange={(v) => onChange(v === "center" ? "center" : "left")}
    />
  );
}

function ImageProps({
  block,
  onChange,
}: {
  block: Extract<EmailBlock, { type: "image" }>;
  onChange: (b: EmailBlock) => void;
}) {
  ensureNewsletterAdminI18n();
  const { t } = useTranslation();
  const [pickerOpen, setPickerOpen] = useState(false);
  return (
    <div className="space-y-2">
      <div>
        <Label className="text-[12px]">{t("adminNewsletter.blockProps.image")}</Label>
        <div className="flex items-center gap-2 mt-1">
          {block.url && (
            <img src={block.url} alt="" className="h-10 w-16 object-cover rounded border" />
          )}
          <Button type="button" variant="outline" size="sm" onClick={() => setPickerOpen(true)}>
            {block.url
              ? t("adminNewsletter.blockProps.change")
              : t("adminNewsletter.blockProps.choose")}
          </Button>
          {block.url && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onChange({ ...block, url: null })}
            >
              {t("adminNewsletter.blockProps.remove")}
            </Button>
          )}
        </div>
      </div>
      <TextField
        label={t("adminNewsletter.blockProps.altText")}
        value={block.alt}
        onChange={(alt) => onChange({ ...block, alt })}
      />
      <TextField
        label={t("adminNewsletter.blockProps.linkOptional")}
        value={block.href ?? ""}
        placeholder="https://…"
        onChange={(href) => onChange({ ...block, href: nullIfEmpty(href) })}
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
}: {
  block: EmailPostListBlock;
  onChange: (b: EmailBlock) => void;
}) {
  ensureNewsletterAdminI18n();
  const { t } = useTranslation();
  return (
    <div className="space-y-2">
      <I18nField
        label={t("adminNewsletter.blockProps.sectionHeading")}
        value={block.heading}
        onChange={(heading) => onChange({ ...block, heading })}
      />
      <div className="grid grid-cols-2 gap-2">
        <SelectField
          label={t("adminNewsletter.blockProps.source")}
          value={block.mode}
          options={[
            { value: "latest", label: t("adminNewsletter.blockProps.sourceLatest") },
            { value: "manual", label: t("adminNewsletter.blockProps.sourceManual") },
          ]}
          onChange={(v) => onChange({ ...block, mode: v === "manual" ? "manual" : "latest" })}
        />
        <SelectField
          label={t("adminNewsletter.blockProps.layout")}
          value={block.layout}
          options={[
            { value: "list", label: t("adminNewsletter.blockProps.layoutList") },
            { value: "cards", label: t("adminNewsletter.blockProps.layoutCards") },
          ]}
          onChange={(v) => onChange({ ...block, layout: v === "cards" ? "cards" : "list" })}
        />
      </div>
      {block.mode === "latest" ? (
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label className="text-[12px]">{t("adminNewsletter.blockProps.postCount")}</Label>
            <Input
              type="number"
              min={1}
              max={MAX_POST_LIST_ITEMS}
              value={block.count}
              onChange={(e) => onChange({ ...block, count: clampPostCount(e.target.value) })}
              className="h-8 mt-1 text-[12px]"
            />
          </div>
          <TextField
            label={t("adminNewsletter.blockProps.categorySlug")}
            value={block.categorySlug ?? ""}
            onChange={(v) => onChange({ ...block, categorySlug: nullIfEmpty(v) })}
          />
        </div>
      ) : (
        <ManualPostPicker block={block} onChange={onChange} />
      )}
      <label className="flex items-center gap-2 text-[12px]">
        <Switch
          checked={block.showExcerpt}
          onCheckedChange={(v) => onChange({ ...block, showExcerpt: Boolean(v) })}
        />
        {t("adminNewsletter.blockProps.showExcerpts")}
      </label>
    </div>
  );
}

function ManualPostPicker({
  block,
  onChange,
}: {
  block: EmailPostListBlock;
  onChange: (b: EmailBlock) => void;
}) {
  ensureNewsletterAdminI18n();
  const { t, i18n } = useTranslation();
  const lang = uiLang(i18n.language);
  const [search, setSearch] = useState("");
  const searchFn = useServerFn(searchCampaignPosts);
  const resultsQ = useQuery({
    queryKey: ["campaign-post-search", search],
    queryFn: async () => {
      const r = await searchFn({ data: { search } });
      return JSON.parse((r as { json: string }).json) as PostOption[];
    },
  });
  const titleOf = (p: PostOption) => pickLocalized(p, "title", lang) || p.title_pl || p.slug;
  const selected = block.postIds;

  const toggle = (id: string) => onChange({ ...block, postIds: togglePostId(selected, id) });

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t("adminNewsletter.blockProps.searchPost")}
          className="pl-8 h-8 text-[12px]"
        />
      </div>
      <p className="text-[11px] text-muted-foreground">
        {t("adminNewsletter.blockProps.selected")}: {selected.length}/{MAX_POST_LIST_ITEMS}
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
            {t("adminNewsletter.blockProps.noResults")}
          </p>
        )}
      </div>
    </div>
  );
}
