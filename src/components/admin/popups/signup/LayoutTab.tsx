// Zakładka "Układ": wariant popupu, strona galerii, proporcje kolumn,
// zaokrąglenie (standard platformy = 6px), szerokość, ramka i cień panelu.
import { useTranslation } from "react-i18next";
import { Clock, LayoutGrid, PanelsTopLeft } from "lucide-react";
import { NumberRow, SectionCard, SegmentedRow, ToggleRow } from "./controls";
import type { SignupPopupTabProps } from "./types";
import type { NewsletterSettings } from "@/hooks/useNewsletterSettings";

type Layout = NewsletterSettings["popup_layout"];

export function LayoutTab({ value, design, onChange, patchPanel }: SignupPopupTabProps) {
  const { t } = useTranslation();
  const showcase = value.popup_layout === "showcase";

  return (
    <div className="space-y-4">
      <SectionCard
        title={t("adminPopupSignup.trigger.section")}
        icon={<Clock className="h-3.5 w-3.5" />}
      >
        <div className="space-y-3">
          <ToggleRow
            label={t("adminPopupSignup.trigger.enabled")}
            checked={value.popup_enabled}
            onChange={(popup_enabled) => onChange({ popup_enabled })}
            hint={t("adminPopupSignup.trigger.enabledHint")}
          />
          <SegmentedRow<NewsletterSettings["popup_trigger"]>
            label={t("adminPopupSignup.trigger.mode")}
            value={value.popup_trigger}
            onChange={(popup_trigger) => onChange({ popup_trigger })}
            columns={3}
            options={[
              { value: "delay", label: t("adminPopupSignup.trigger.delay") },
              { value: "scroll", label: t("adminPopupSignup.trigger.scroll") },
              { value: "exit-intent", label: t("adminPopupSignup.trigger.exit") },
            ]}
          />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {value.popup_trigger === "delay" && (
              <NumberRow
                label={t("adminPopupSignup.trigger.delaySeconds")}
                value={value.popup_delay_seconds}
                min={1}
                max={600}
                onChange={(popup_delay_seconds) => onChange({ popup_delay_seconds })}
                hint={t("adminPopupSignup.trigger.delaySecondsHint")}
              />
            )}
            {value.popup_trigger === "scroll" && (
              <NumberRow
                label={t("adminPopupSignup.trigger.scrollPercent")}
                value={value.popup_scroll_percent}
                min={1}
                max={100}
                step={5}
                onChange={(popup_scroll_percent) => onChange({ popup_scroll_percent })}
              />
            )}
            <NumberRow
              label={t("adminPopupSignup.trigger.frequencyDays")}
              value={value.popup_frequency_days}
              min={0}
              max={365}
              onChange={(popup_frequency_days) => onChange({ popup_frequency_days })}
              hint={t("adminPopupSignup.trigger.frequencyDaysHint")}
            />
          </div>
        </div>
      </SectionCard>

      <SectionCard
        title={t("adminPopupSignup.layout.variant")}
        icon={<LayoutGrid className="h-3.5 w-3.5" />}
      >
        <SegmentedRow<Layout>
          value={value.popup_layout}
          onChange={(popup_layout) => onChange({ popup_layout })}
          columns={3}
          options={[
            {
              value: "stacked",
              label: t("adminPopupSignup.layout.stacked"),
              desc: t("adminPopupSignup.layout.stackedDesc"),
            },
            {
              value: "split",
              label: t("adminPopupSignup.layout.split"),
              desc: t("adminPopupSignup.layout.splitDesc"),
            },
            {
              value: "showcase",
              label: t("adminPopupSignup.layout.showcase"),
              desc: t("adminPopupSignup.layout.showcaseDesc"),
            },
          ]}
        />
      </SectionCard>

      <SectionCard
        title={t("adminPopupSignup.tabs.layout")}
        icon={<PanelsTopLeft className="h-3.5 w-3.5" />}
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {showcase && (
            <SegmentedRow<"left" | "right">
              label={t("adminPopupSignup.layout.side")}
              value={value.popup_showcase_side}
              onChange={(popup_showcase_side) => onChange({ popup_showcase_side })}
              columns={2}
              options={[
                { value: "left", label: t("adminPopupSignup.layout.sideLeft") },
                { value: "right", label: t("adminPopupSignup.layout.sideRight") },
              ]}
            />
          )}
          {showcase && (
            <SegmentedRow<"half" | "gallery-wide" | "form-wide">
              label={t("adminPopupSignup.layout.split2")}
              value={design.panel.split}
              onChange={(split) => patchPanel({ split })}
              columns={3}
              options={[
                { value: "half", label: t("adminPopupSignup.layout.splitHalf") },
                { value: "gallery-wide", label: t("adminPopupSignup.layout.splitGalleryWide") },
                { value: "form-wide", label: t("adminPopupSignup.layout.splitFormWide") },
              ]}
            />
          )}
          <NumberRow
            label={t("adminPopupSignup.layout.radius")}
            value={value.popup_border_radius_px}
            min={0}
            max={40}
            onChange={(popup_border_radius_px) => onChange({ popup_border_radius_px })}
            hint={t("adminPopupSignup.layout.radiusHint")}
          />
          <NumberRow
            label={t("adminPopupSignup.layout.maxWidth")}
            value={design.panel.maxWidthPx}
            min={480}
            max={1600}
            step={20}
            onChange={(maxWidthPx) => patchPanel({ maxWidthPx })}
            hint={t("adminPopupSignup.layout.maxWidthHint")}
          />
          <NumberRow
            label={t("adminPopupSignup.layout.shadow")}
            value={design.panel.shadow}
            min={0}
            max={100}
            step={5}
            onChange={(shadow) => patchPanel({ shadow })}
          />
          <div className="flex items-end">
            <ToggleRow
              label={t("adminPopupSignup.layout.border")}
              checked={design.panel.showBorder}
              onChange={(showBorder) => patchPanel({ showBorder })}
            />
          </div>
        </div>
      </SectionCard>
    </div>
  );
}
