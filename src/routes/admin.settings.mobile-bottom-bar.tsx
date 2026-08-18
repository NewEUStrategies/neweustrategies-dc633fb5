// Admin → Ustawienia → Pasek mobilny.
// Edycja treści (PL/EN), ikon, kolorów i linków dolnego paska nawigacji na
// mobile. Zapis do site_settings[key="mobile_bottom_bar"]; publiczny komponent
// czyta dokładnie te same wartości przez useSiteSetting().
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useSettings, useDraft } from "@/lib/admin/useSettings";
import {
  Field,
  Text,
  Checkbox,
  NumberInput,
  Select,
  SaveBar,
} from "@/components/admin/settings/fields";
import { LucideIconPicker } from "@/components/admin/builder/ui/molecules/LucideIconPicker";
import { MobileBottomBarView } from "@/components/mobile/bottomBar/MobileBottomBarView";
import {
  BOTTOM_BAR_BADGE_SOURCES,
  MAX_BOTTOM_BAR_ITEMS,
  MOBILE_BOTTOM_BAR_DEFAULTS,
  MOBILE_BOTTOM_BAR_SETTINGS_KEY,
  bottomBarLabel,
  clampOffset,
  clampRadius,
  newBottomBarItem,
  normalizeBadgeSource,
  visibleBottomBarItems,
  type BottomBarBadgeSource,
  type MobileBottomBarConfig,
  type MobileBottomBarItem,
} from "@/lib/mobileBottomBar/config";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { ensureI18n as ensureMobileBottomBarI18n } from "@/lib/i18n-mobile-bottom-bar";

/** Etykiety opcji licznika - klucze i18n, żeby panel też był dwujęzyczny. */
const BADGE_LABEL_KEYS: Record<BottomBarBadgeSource, string> = {
  none: "mobileBottomBar.badgeNone",
  chat: "mobileBottomBar.badgeChat",
  network: "mobileBottomBar.badgeNetwork",
  notifications: "mobileBottomBar.badgeNotifications",
  clubs: "mobileBottomBar.badgeClubs",
};

export const Route = createFileRoute("/admin/settings/mobile-bottom-bar")({
  head: () => ({
    meta: [
      { title: "Pasek mobilny - Ustawienia" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: MobileBottomBarSettings,
});

function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <Field label={label}>
      <div className="flex items-center gap-2">
        <input
          type="color"
          aria-label={label}
          value={/^#[0-9a-fA-F]{6}$/.test(value) ? value : "#ffffff"}
          onChange={(e) => onChange(e.currentTarget.value)}
          className="h-10 w-12 cursor-pointer rounded-md border border-border bg-transparent p-1"
        />
        <Text value={value} onChange={(e) => onChange(e.currentTarget.value)} className="w-40" />
      </div>
    </Field>
  );
}

function MobileBottomBarSettings() {
  // Rejestracja słownika w chunku KOMPONENTU trasy (nie w entry) - patrz
  // komentarz przy ensureI18n w lib/i18n-mobile-bottom-bar.ts.
  ensureMobileBottomBarI18n();
  const { t, i18n } = useTranslation();
  const { query, save } = useSettings<MobileBottomBarConfig>(
    MOBILE_BOTTOM_BAR_SETTINGS_KEY,
    MOBILE_BOTTOM_BAR_DEFAULTS,
  );
  const [draft, setDraft] = useDraft(query.data);
  const [previewTheme, setPreviewTheme] = useState<"light" | "dark">("light");

  if (!draft) return <p className="text-sm text-muted-foreground">{t("admin.loading")}</p>;

  const items = Array.isArray(draft.items) ? draft.items : [];
  const patchItem = (index: number, patch: Partial<MobileBottomBarItem>) =>
    setDraft({
      ...draft,
      items: items.map((item, i) => (i === index ? { ...item, ...patch } : item)),
    });
  const moveItem = (index: number, delta: number) => {
    const next = [...items];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setDraft({ ...draft, items: next });
  };

  const previewItems = visibleBottomBarItems(draft);

  return (
    <div>
      <h2 className="font-display text-xl">{t("mobileBottomBar.adminTitle")}</h2>
      <p className="mt-1 mb-5 text-sm text-muted-foreground">
        {t("mobileBottomBar.adminSubtitle")}
      </p>

      <section className="mb-6">
        <Field label={t("mobileBottomBar.enabled")} hint={t("mobileBottomBar.enabledHint")}>
          <Checkbox
            label={t("mobileBottomBar.enabledLabel")}
            checked={draft.enabled}
            onChange={(v) => setDraft({ ...draft, enabled: v })}
          />
        </Field>
        <Field label={t("mobileBottomBar.showLabels")}>
          <Checkbox
            label={t("mobileBottomBar.showLabelsLabel")}
            checked={draft.show_labels}
            onChange={(v) => setDraft({ ...draft, show_labels: v })}
          />
        </Field>
        <Field label={t("mobileBottomBar.hideOnScroll")}>
          <Checkbox
            label={t("mobileBottomBar.hideOnScrollLabel")}
            checked={draft.hide_on_scroll}
            onChange={(v) => setDraft({ ...draft, hide_on_scroll: v })}
          />
        </Field>
        <Field label={t("mobileBottomBar.offset")} hint={t("mobileBottomBar.offsetHint")}>
          <NumberInput
            value={draft.offset_bottom}
            min={0}
            max={40}
            onChange={(e) =>
              setDraft({ ...draft, offset_bottom: clampOffset(e.currentTarget.value) })
            }
          />
        </Field>
        <Field label={t("mobileBottomBar.radius")} hint={t("mobileBottomBar.radiusHint")}>
          <NumberInput
            value={draft.radius}
            min={0}
            max={40}
            onChange={(e) => setDraft({ ...draft, radius: clampRadius(e.currentTarget.value) })}
          />
        </Field>
      </section>

      <section className="mb-6">
        <h3 className="mb-2 text-sm font-semibold">{t("mobileBottomBar.colors")}</h3>
        <ColorField
          label={t("mobileBottomBar.backgroundLight")}
          value={draft.background_light}
          onChange={(v) => setDraft({ ...draft, background_light: v })}
        />
        <ColorField
          label={t("mobileBottomBar.backgroundDark")}
          value={draft.background_dark}
          onChange={(v) => setDraft({ ...draft, background_dark: v })}
        />
        <ColorField
          label={t("mobileBottomBar.iconLight")}
          value={draft.icon_light}
          onChange={(v) => setDraft({ ...draft, icon_light: v })}
        />
        <ColorField
          label={t("mobileBottomBar.iconDark")}
          value={draft.icon_dark}
          onChange={(v) => setDraft({ ...draft, icon_dark: v })}
        />
        <Field
          label={t("mobileBottomBar.useItemColor")}
          hint={t("mobileBottomBar.useItemColorHint")}
        >
          <Checkbox
            label={t("mobileBottomBar.useItemColor")}
            checked={draft.use_item_color}
            onChange={(v) => setDraft({ ...draft, use_item_color: v })}
          />
        </Field>
      </section>

      <section className="mb-6">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-semibold">{t("mobileBottomBar.items")}</h3>
          <button
            type="button"
            disabled={items.length >= MAX_BOTTOM_BAR_ITEMS}
            onClick={() =>
              setDraft({ ...draft, items: [...items, newBottomBarItem(items.length)] })
            }
            className="inline-flex h-8 items-center gap-1 rounded-md border border-border px-3 text-xs transition-colors hover:bg-muted disabled:opacity-50"
          >
            <Plus size={14} /> {t("mobileBottomBar.addItem")}
          </button>
        </div>
        <p className="mb-3 text-xs text-muted-foreground">
          {t("mobileBottomBar.itemsHint", { max: MAX_BOTTOM_BAR_ITEMS })}
        </p>

        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("mobileBottomBar.emptyItems")}</p>
        ) : (
          <ul className="space-y-3">
            {items.map((item, index) => (
              <li key={item.id || index} className="rounded-lg border border-border p-4">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-muted-foreground">#{index + 1}</span>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      aria-label={t("mobileBottomBar.moveUp")}
                      onClick={() => moveItem(index, -1)}
                      className="rounded-md border border-border p-1.5 transition-colors hover:bg-muted"
                    >
                      <ArrowUp size={14} />
                    </button>
                    <button
                      type="button"
                      aria-label={t("mobileBottomBar.moveDown")}
                      onClick={() => moveItem(index, 1)}
                      className="rounded-md border border-border p-1.5 transition-colors hover:bg-muted"
                    >
                      <ArrowDown size={14} />
                    </button>
                    <button
                      type="button"
                      aria-label={t("mobileBottomBar.removeItem")}
                      onClick={() =>
                        setDraft({ ...draft, items: items.filter((_, i) => i !== index) })
                      }
                      className="rounded-md border border-border p-1.5 text-destructive transition-colors hover:bg-muted"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  {/* Pozycje domyślne mają etykietę w i18n (label_key). Puste
                      pole = używamy tłumaczenia; wpis administratora je
                      nadpisuje. Placeholder pokazuje, co zobaczy czytelnik. */}
                  <label className="text-xs font-medium">
                    {t("mobileBottomBar.labelPl")}
                    <Text
                      value={item.label_pl}
                      placeholder={bottomBarLabel({ ...item, label_pl: "" }, "pl", (k) => t(k))}
                      onChange={(e) => patchItem(index, { label_pl: e.currentTarget.value })}
                      className="mt-1"
                    />
                  </label>
                  <label className="text-xs font-medium">
                    {t("mobileBottomBar.labelEn")}
                    <Text
                      value={item.label_en}
                      placeholder={bottomBarLabel({ ...item, label_en: "" }, "en", (k) => t(k))}
                      onChange={(e) => patchItem(index, { label_en: e.currentTarget.value })}
                      className="mt-1"
                    />
                  </label>
                  <label className="text-xs font-medium">
                    {t("mobileBottomBar.href")}
                    <Text
                      value={item.href}
                      onChange={(e) => patchItem(index, { href: e.currentTarget.value })}
                      className="mt-1"
                    />
                    <span className="mt-1 block text-[11px] font-normal text-muted-foreground">
                      {t("mobileBottomBar.hrefHint")}
                    </span>
                  </label>
                  <div className="text-xs font-medium">
                    {t("mobileBottomBar.icon")}
                    <div className="mt-1">
                      <LucideIconPicker
                        value={item.icon}
                        onChange={(icon) => patchItem(index, { icon })}
                      />
                    </div>
                  </div>
                  {/* Akcent osobno na motyw jasny i ciemny - jeden kolor nigdy
                      nie ma dobrego kontrastu na obu tłach naraz. */}
                  <div className="text-xs font-medium">
                    {t("mobileBottomBar.colorLight")}
                    <div className="mt-1 flex items-center gap-2">
                      <input
                        type="color"
                        aria-label={t("mobileBottomBar.colorLight")}
                        value={/^#[0-9a-fA-F]{6}$/.test(item.color) ? item.color : "#4343f5"}
                        onChange={(e) => patchItem(index, { color: e.currentTarget.value })}
                        className="h-10 w-12 cursor-pointer rounded-md border border-border bg-transparent p-1"
                      />
                      <Text
                        value={item.color}
                        onChange={(e) => patchItem(index, { color: e.currentTarget.value })}
                      />
                    </div>
                  </div>
                  <div className="text-xs font-medium">
                    {t("mobileBottomBar.colorDark")}
                    <div className="mt-1 flex items-center gap-2">
                      <input
                        type="color"
                        aria-label={t("mobileBottomBar.colorDark")}
                        value={
                          /^#[0-9a-fA-F]{6}$/.test(item.color_dark ?? "")
                            ? (item.color_dark as string)
                            : "#8f8ffb"
                        }
                        onChange={(e) => patchItem(index, { color_dark: e.currentTarget.value })}
                        className="h-10 w-12 cursor-pointer rounded-md border border-border bg-transparent p-1"
                      />
                      <Text
                        value={item.color_dark ?? ""}
                        onChange={(e) => patchItem(index, { color_dark: e.currentTarget.value })}
                      />
                    </div>
                  </div>
                  <label className="text-xs font-medium">
                    {t("mobileBottomBar.badge")}
                    <Select
                      value={normalizeBadgeSource(item.badge)}
                      onChange={(e) =>
                        patchItem(index, { badge: normalizeBadgeSource(e.currentTarget.value) })
                      }
                      className="mt-1"
                    >
                      {BOTTOM_BAR_BADGE_SOURCES.map((source) => (
                        <option key={source} value={source}>
                          {t(BADGE_LABEL_KEYS[source])}
                        </option>
                      ))}
                    </Select>
                    <span className="mt-1 block text-[11px] font-normal text-muted-foreground">
                      {t("mobileBottomBar.badgeHint")}
                    </span>
                  </label>
                  <div className="flex items-end">
                    <Checkbox
                      label={t("mobileBottomBar.itemEnabled")}
                      checked={item.enabled !== false}
                      onChange={(v) => patchItem(index, { enabled: v })}
                    />
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mb-6">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-semibold">{t("mobileBottomBar.preview")}</h3>
          <button
            type="button"
            onClick={() => setPreviewTheme((s) => (s === "light" ? "dark" : "light"))}
            className="h-8 rounded-md border border-border px-3 text-xs transition-colors hover:bg-muted"
          >
            {previewTheme === "light"
              ? t("mobileBottomBar.previewLight")
              : t("mobileBottomBar.previewDark")}
          </button>
        </div>
        <div
          // Górny padding jest większy: nad paskiem unosi się garb z aktywną
          // pozycją, więc podgląd musi zostawić mu miejsce, żeby nie wyglądał
          // na przycięty.
          className={`${previewTheme === "dark" ? "dark bg-neutral-900" : "bg-neutral-100"} flex justify-center rounded-lg border border-border px-6 pt-14 pb-6`}
        >
          <div className="w-full max-w-sm">
            {previewItems.length > 0 ? (
              // Podgląd celuje w środkową pozycję - dokładnie tam, gdzie w
              // domyślnej konfiguracji siedzi strona główna. withBadges=false,
              // bo panel nie ma odpytywać czatu i sieci o liczniki admina.
              <MobileBottomBarView
                config={draft}
                items={previewItems}
                activeIndex={Math.floor((previewItems.length - 1) / 2)}
                lang={i18n.language || "pl"}
                withBadges={false}
              />
            ) : (
              <p className="text-center text-sm text-muted-foreground">
                {t("mobileBottomBar.emptyItems")}
              </p>
            )}
          </div>
        </div>
      </section>

      <SaveBar saving={save.isPending} onSave={() => save.mutate(draft)} />
    </div>
  );
}
