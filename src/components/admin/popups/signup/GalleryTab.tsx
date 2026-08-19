// Zakładka "Lewa strona": marka i hasło (PL/EN), logo poziome, siatka kadrów,
// kolejność bloków, przełączniki detali oraz cztery kadry galerii z opisami
// i rekomendowanymi wymiarami. Dla układów stacked/split - grafika i okładka.
import { useTranslation } from "react-i18next";
import { Image as ImageIcon, LayoutGrid, ListOrdered, SlidersHorizontal } from "lucide-react";
import { ImageSlot } from "@/components/admin/builder/ui/organisms/widget-properties/ImageSlot";
import { BilingualRow } from "@/components/admin/atoms/BilingualRow";
import { NumberRow, OrderRow, SectionCard, SegmentedRow, ToggleRow } from "./controls";
import type { SignupPopupTabProps } from "./types";
import type { NewsletterShowcaseImage } from "@/hooks/useNewsletterSettings";
import {
  GALLERY_BLOCKS,
  GALLERY_SLOT_DIMENSIONS,
  type GalleryBlock,
  type PopupGalleryGrid,
} from "@/lib/newsletter/popupDesign";

function emptySlot(): NewsletterShowcaseImage {
  return { url: "", caption_pl: "", caption_en: "", title_pl: "", title_en: "" };
}

/** Zawsze cztery slots - brakujące dopinamy, nadmiarowe ucinamy. */
function normalizeSlots(images: NewsletterShowcaseImage[]): NewsletterShowcaseImage[] {
  const out = [...images];
  while (out.length < 4) out.push(emptySlot());
  return out.slice(0, 4);
}

export function GalleryTab({ value, design, onChange, patchGallery }: SignupPopupTabProps) {
  const { t } = useTranslation();
  const showcase = value.popup_layout === "showcase";
  const slots = normalizeSlots(value.popup_showcase_images ?? []);
  const g = design.gallery;

  const patchSlot = (index: number, patch: Partial<NewsletterShowcaseImage>) => {
    onChange({
      popup_showcase_images: slots.map((slot, i) => (i === index ? { ...slot, ...patch } : slot)),
    });
  };

  const slotHint = (index: number) => {
    const dim = GALLERY_SLOT_DIMENSIONS[index];
    const key = index === 0 ? "main" : index === 3 ? "wide" : "small";
    return `${t(`adminPopupSignup.gallery.slotHints.${key}`)} (${dim.w}x${dim.h}, ${dim.ratio})`;
  };

  const blockLabels = GALLERY_BLOCKS.reduce(
    (acc, block) => {
      acc[block] = t(`adminPopupSignup.gallery.blocks.${block}`);
      return acc;
    },
    {} as Record<GalleryBlock, string>,
  );

  if (!showcase) {
    return (
      <div className="space-y-3">
        <p className="text-[11px] text-muted-foreground">
          {t("adminPopupSignup.gallery.onlyShowcase")}
        </p>
        <ImageSlot
          label={t("adminPopupSignup.gallery.sideImage")}
          icon={<ImageIcon className="h-4 w-4" />}
          value={value.popup_side_image_url ?? ""}
          onChange={(url) => onChange({ popup_side_image_url: url || null })}
          hint={t("adminPopupSignup.gallery.sideImageHint")}
        />
        <ImageSlot
          label={t("adminPopupSignup.gallery.coverImage")}
          icon={<ImageIcon className="h-4 w-4" />}
          value={value.popup_cover_url ?? ""}
          onChange={(url) => onChange({ popup_cover_url: url || null })}
          hint={t("adminPopupSignup.gallery.coverHint")}
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <SectionCard
        title={t("adminPopupSignup.gallery.grid")}
        hint={t("adminPopupSignup.gallery.gridHint")}
        icon={<LayoutGrid className="h-3.5 w-3.5" />}
      >
        <SegmentedRow<PopupGalleryGrid>
          value={g.grid}
          onChange={(grid) => patchGallery({ grid })}
          columns={3}
          options={[
            { value: "reference", label: t("adminPopupSignup.gallery.gridReference") },
            { value: "mosaic", label: t("adminPopupSignup.gallery.gridMosaic") },
            { value: "single", label: t("adminPopupSignup.gallery.gridSingle") },
          ]}
        />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <NumberRow
            label={t("adminPopupSignup.gallery.rotate")}
            value={value.popup_showcase_rotate_ms}
            min={800}
            max={30000}
            step={100}
            onChange={(popup_showcase_rotate_ms) => onChange({ popup_showcase_rotate_ms })}
            hint={t("adminPopupSignup.gallery.rotateHint")}
          />
          <NumberRow
            label={t("adminPopupSignup.gallery.gridHeight")}
            value={g.gridHeightPx}
            min={200}
            max={720}
            step={10}
            onChange={(gridHeightPx) => patchGallery({ gridHeightPx })}
          />
          <NumberRow
            label={t("adminPopupSignup.gallery.gap")}
            value={g.gapPx}
            min={0}
            max={32}
            onChange={(gapPx) => patchGallery({ gapPx })}
          />
          <NumberRow
            label={t("adminPopupSignup.gallery.padding")}
            value={g.paddingPx}
            min={8}
            max={80}
            onChange={(paddingPx) => patchGallery({ paddingPx })}
          />
          <NumberRow
            label={t("adminPopupSignup.gallery.gradAngle")}
            value={g.gradientAngle}
            min={0}
            max={360}
            step={5}
            onChange={(gradientAngle) => patchGallery({ gradientAngle })}
          />
          <NumberRow
            label={t("adminPopupSignup.gallery.inactiveDim")}
            value={g.inactiveDim}
            min={0}
            max={100}
            step={5}
            onChange={(inactiveDim) => patchGallery({ inactiveDim })}
          />
        </div>
      </SectionCard>

      <SectionCard
        title={t("adminPopupSignup.gallery.order")}
        icon={<ListOrdered className="h-3.5 w-3.5" />}
      >
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <OrderRow<GalleryBlock>
            label={t("adminPopupSignup.gallery.order")}
            hint={t("adminPopupSignup.gallery.orderHint")}
            items={g.order}
            labels={blockLabels}
            onChange={(order) => patchGallery({ order })}
            upLabel={t("adminPopupSignup.gallery.up")}
            downLabel={t("adminPopupSignup.gallery.down")}
          />
          <div className="space-y-3">
            <SegmentedRow<"center" | "left">
              label={t("adminPopupSignup.gallery.align")}
              value={g.align}
              onChange={(align) => patchGallery({ align })}
              columns={2}
              options={[
                { value: "center", label: t("adminPopupSignup.gallery.alignCenter") },
                { value: "left", label: t("adminPopupSignup.gallery.alignLeft") },
              ]}
            />
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <ToggleRow
                label={t("adminPopupSignup.gallery.showBrand")}
                checked={value.popup_showcase_show_brand}
                onChange={(popup_showcase_show_brand) => onChange({ popup_showcase_show_brand })}
              />
              <ToggleRow
                label={t("adminPopupSignup.gallery.showLogo")}
                checked={g.showLogo}
                onChange={(showLogo) => patchGallery({ showLogo })}
              />
              <ToggleRow
                label={t("adminPopupSignup.gallery.showCaption")}
                checked={value.popup_showcase_show_caption}
                onChange={(popup_showcase_show_caption) =>
                  onChange({ popup_showcase_show_caption })
                }
              />
              <ToggleRow
                label={t("adminPopupSignup.gallery.showDots")}
                checked={value.popup_showcase_show_dots}
                onChange={(popup_showcase_show_dots) => onChange({ popup_showcase_show_dots })}
              />
              <ToggleRow
                label={t("adminPopupSignup.gallery.showFades")}
                checked={g.showFades}
                onChange={(showFades) => patchGallery({ showFades })}
              />
              <ToggleRow
                label={t("adminPopupSignup.gallery.showCorners")}
                checked={g.showCorners}
                onChange={(showCorners) => patchGallery({ showCorners })}
              />
              <ToggleRow
                label={t("adminPopupSignup.gallery.showArrow")}
                checked={g.showArrow}
                onChange={(showArrow) => patchGallery({ showArrow })}
              />
              <ToggleRow
                label={t("adminPopupSignup.gallery.captionDashed")}
                checked={g.captionDashed}
                onChange={(captionDashed) => patchGallery({ captionDashed })}
              />
            </div>
          </div>
        </div>
      </SectionCard>

      <SectionCard
        title={t("adminPopupSignup.form.texts")}
        icon={<SlidersHorizontal className="h-3.5 w-3.5" />}
      >
        <BilingualRow
          label={t("adminPopupSignup.gallery.brand")}
          pl={value.popup_showcase_brand_pl}
          en={value.popup_showcase_brand_en}
          onPl={(popup_showcase_brand_pl) => onChange({ popup_showcase_brand_pl })}
          onEn={(popup_showcase_brand_en) => onChange({ popup_showcase_brand_en })}
          placeholderPl="New European Strategies"
          placeholderEn="New European Strategies"
        />
        <BilingualRow
          label={t("adminPopupSignup.gallery.tagline")}
          pl={value.popup_showcase_tagline_pl}
          en={value.popup_showcase_tagline_en}
          onPl={(popup_showcase_tagline_pl) => onChange({ popup_showcase_tagline_pl })}
          onEn={(popup_showcase_tagline_en) => onChange({ popup_showcase_tagline_en })}
        />
        <BilingualRow
          label={t("adminPopupSignup.gallery.captionPrefix")}
          pl={g.captionPrefixPl}
          en={g.captionPrefixEn}
          onPl={(captionPrefixPl) => patchGallery({ captionPrefixPl })}
          onEn={(captionPrefixEn) => patchGallery({ captionPrefixEn })}
          hint={t("adminPopupSignup.gallery.captionPrefixHint")}
        />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[2fr_1fr]">
          <div className="space-y-1">
            <ImageSlot
              label={t("adminPopupSignup.gallery.logoUrl")}
              icon={<ImageIcon className="h-4 w-4" />}
              value={g.logoUrl}
              onChange={(logoUrl) => patchGallery({ logoUrl })}
              hint={t("adminPopupSignup.gallery.logoHint")}
            />
          </div>
          <NumberRow
            label={t("adminPopupSignup.gallery.logoHeight")}
            value={g.logoHeightPx}
            min={12}
            max={96}
            onChange={(logoHeightPx) => patchGallery({ logoHeightPx })}
          />
        </div>
      </SectionCard>

      <SectionCard
        title={t("adminPopupSignup.gallery.tiles")}
        icon={<ImageIcon className="h-3.5 w-3.5" />}
      >
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {slots.map((slot, index) => (
            <div key={index} className="space-y-3 rounded-md border border-border p-3">
              <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {t("adminPopupSignup.gallery.tile", { index: index + 1 })}
              </div>
              <ImageSlot
                label={t("adminPopupSignup.gallery.image")}
                icon={<ImageIcon className="h-4 w-4" />}
                value={slot.url}
                onChange={(url) => patchSlot(index, { url })}
                hint={slotHint(index)}
              />
              {/* Kolejnosc jak w popupie: najpierw opis, pod nim tytul kadru. */}
              <BilingualRow
                label={t("adminPopupSignup.gallery.caption2")}
                pl={slot.caption_pl}
                en={slot.caption_en}
                onPl={(caption_pl) => patchSlot(index, { caption_pl })}
                onEn={(caption_en) => patchSlot(index, { caption_en })}
              />
              <BilingualRow
                label={t("adminPopupSignup.gallery.tileTitle")}
                pl={slot.title_pl ?? ""}
                en={slot.title_en ?? ""}
                onPl={(title_pl) => patchSlot(index, { title_pl })}
                onEn={(title_en) => patchSlot(index, { title_en })}
              />
            </div>
          ))}
        </div>
      </SectionCard>
    </div>
  );
}
