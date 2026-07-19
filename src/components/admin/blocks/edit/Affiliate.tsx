import { useTranslation } from "react-i18next";
import "@/lib/i18n-admin-blocks";
import type { Block } from "@/lib/blocks/types";
import { Input } from "@/components/ui/input";
import { ShoppingBag } from "lucide-react";

interface Props {
  block: Block;
  onChange: (next: Block) => void;
}

export function AffiliateBlock({ block, onChange }: Props) {
  const { t } = useTranslation();
  const get = (k: string) => String(block.data[k] ?? "");
  const patch = (k: string, v: unknown) =>
    onChange({ ...block, data: { ...block.data, [k]: v as never } });

  return (
    <div className="not-prose rounded-md border border-border bg-card p-3 space-y-2">
      <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
        <ShoppingBag className="w-3.5 h-3.5" /> {t("adminBlocks.affiliate.heading")}
        <label className="ml-auto flex items-center gap-1 normal-case tracking-normal">
          <input
            type="checkbox"
            checked={Boolean(block.data.sponsored)}
            onChange={(e) => patch("sponsored", e.target.checked)}
          />
          {t("adminBlocks.affiliate.sponsored")}
        </label>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Input
          placeholder={t("adminBlocks.affiliate.title")}
          value={get("title")}
          onChange={(e) => patch("title", e.target.value)}
        />
        <Input
          placeholder={t("adminBlocks.affiliate.store")}
          value={get("store")}
          onChange={(e) => patch("store", e.target.value)}
        />
      </div>
      <Input
        placeholder={t("adminBlocks.affiliate.imageUrl")}
        value={get("image")}
        onChange={(e) => patch("image", e.target.value)}
      />
      <textarea
        placeholder={t("adminBlocks.affiliate.description")}
        value={get("description")}
        onChange={(e) => patch("description", e.target.value)}
        className="w-full rounded border border-border bg-background px-3 py-2 text-sm min-h-[50px]"
      />
      <div className="grid grid-cols-3 gap-2">
        <Input
          placeholder={t("adminBlocks.affiliate.price")}
          value={get("price")}
          onChange={(e) => patch("price", e.target.value)}
        />
        <Input
          placeholder={t("adminBlocks.affiliate.currency")}
          value={get("currency")}
          onChange={(e) => patch("currency", e.target.value)}
        />
        <Input
          type="number"
          min={0}
          max={5}
          step={0.1}
          placeholder={t("adminBlocks.affiliate.rating")}
          value={String(block.data.rating ?? 0)}
          onChange={(e) => patch("rating", Number(e.target.value))}
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Input
          placeholder={t("adminBlocks.affiliate.ctaLabel")}
          value={get("ctaLabel")}
          onChange={(e) => patch("ctaLabel", e.target.value)}
        />
        <Input
          placeholder={t("adminBlocks.affiliate.ctaHref")}
          value={get("ctaHref")}
          onChange={(e) => patch("ctaHref", e.target.value)}
        />
      </div>
    </div>
  );
}
