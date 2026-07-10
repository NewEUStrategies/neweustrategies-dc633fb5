import { createFileRoute } from "@tanstack/react-router";
import { AdminShell } from "@/components/admin/AdminShell";
import { usePostLayoutSettings, useSavePostLayoutSettings } from "@/hooks/usePostLayoutSettings";
import {
  STANDARD_LAYOUTS,
  VIDEO_LAYOUTS,
  AUDIO_LAYOUTS,
  GALLERY_LAYOUTS,
  effectiveHasSidebar,
  type PostLayoutSettings,
  type LayoutPreset,
} from "@/lib/postLayouts";
import { LayoutPreview } from "@/components/admin/LayoutPreview";
import { useEffect, useState } from "react";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/post-layouts")({ component: Page });

function Page() {
  const { data } = usePostLayoutSettings();
  const save = useSavePostLayoutSettings();
  const [local, setLocal] = useState<PostLayoutSettings | null>(null);
  useEffect(() => {
    if (data && !local) setLocal(data);
  }, [data, local]);
  if (!local)
    return (
      <AdminShell hideSidebar>
        <div className="p-6">Ładowanie…</div>
      </AdminShell>
    );

  const upd = (p: Partial<PostLayoutSettings>) => setLocal({ ...local, ...p });
  const onSave = async () => {
    const { tenant_id, ...rest } = local;
    void tenant_id;
    try {
      await save.mutateAsync(rest);
      toast.success("Zapisano - layout wpisów został zaktualizowany");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Nie udało się zapisać";
      toast.error(`Błąd zapisu: ${msg}`);
      console.error("[post-layouts] save failed", e);
    }
  };

  const LayoutGrid = ({
    value,
    onChange,
    presets,
    title,
    hint,
  }: {
    value: string;
    onChange: (id: string, extra?: Partial<PostLayoutSettings>) => void;
    presets: LayoutPreset[];
    title: string;
    hint?: string;
  }) => {
    const selected = presets.find((p) => p.id === value) ?? presets[0];
    const overrides = local.layout_sidebar_overrides ?? {};
    const selectedHasSidebar = effectiveHasSidebar(selected, local);

    // Każdy preset występuje w DWÓCH wariantach: bez sidebara i z sidebarem.
    // Wybór karty ustawia jednocześnie layout id oraz override dla sidebara,
    // więc użytkownik nie musi klikać dodatkowego przełącznika.
    const pickVariant = (presetId: string, withSidebar: boolean) => {
      const nextMap = { ...overrides, [presetId]: withSidebar };
      // Jedno wywołanie setLocal, żeby uniknąć wyścigu (drugi setState
      // nadpisywałby pierwszy używając stale `local` z closure).
      onChange(presetId, { layout_sidebar_overrides: nextMap });
    };

    return (
      <section className="space-y-2">
        <div className="flex items-baseline justify-between gap-3 flex-wrap">
          <h2 className="font-display text-base">{title}</h2>
          <span className="text-[11px] text-muted-foreground">
            Wybrany: <b>{selected.label}</b> ({selectedHasSidebar ? "z sidebarem" : "bez sidebara"})
          </span>
        </div>
        {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}

        <div className="grid md:grid-cols-[1fr_220px] gap-3 items-start">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {presets.map((p) => {
              const isSelected = value === p.id;
              const currentHasSidebar = isSelected
                ? selectedHasSidebar
                : (overrides[p.id] ?? p.hasSidebar);
              return (
                <div
                  key={p.id}
                  className={`border rounded-md p-2 bg-background/50 ${isSelected ? "border-brand" : "border-border"}`}
                >
                  <div className="flex items-center justify-between gap-2 mb-1.5">
                    <p className="text-[11px] font-medium truncate">{p.label}</p>
                    {p.recommendedImage ? (
                      <span
                        className="text-[9px] px-1 py-px rounded bg-muted text-muted-foreground shrink-0"
                        title="Rekomendowany rozmiar grafiki"
                      >
                        {p.recommendedImage.width}×{p.recommendedImage.height}
                      </span>
                    ) : (
                      <span className="text-[9px] px-1 py-px rounded bg-muted text-muted-foreground shrink-0">
                        brak
                      </span>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-1.5">
                    {[false, true].map((withSidebar) => {
                      const active = isSelected && currentHasSidebar === withSidebar;
                      return (
                        <button
                          key={String(withSidebar)}
                          type="button"
                          onClick={() => pickVariant(p.id, withSidebar)}
                          aria-pressed={active}
                          aria-label={`${p.label} - ${withSidebar ? "z sidebarem" : "bez sidebara"}`}
                          className={`text-left p-1 rounded border transition ${
                            active
                              ? "border-brand ring-1 ring-brand/40 bg-brand/5"
                              : "border-border hover:border-brand/50"
                          }`}
                        >
                          <LayoutPreview
                            preset={p}
                            settings={local}
                            hasSidebarOverride={withSidebar}
                          />
                          <p className="text-[9px] text-muted-foreground mt-1 leading-tight">
                            {withSidebar ? "+ sidebar" : "bez sidebara"}
                          </p>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
          <aside className="sticky top-4 space-y-1.5 border border-border rounded-md p-2 bg-muted/30">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Live preview
            </div>
            <LayoutPreview
              preset={selected}
              settings={local}
              hasSidebarOverride={selectedHasSidebar}
            />
            <ul className="text-[10px] text-muted-foreground space-y-0.5 pt-1">
              <li>
                Nagłówek: <b>{selected.header}</b>
              </li>
              <li>
                Cover: <b>{selected.cover}</b>
              </li>
              <li>
                Sidebar: <b>{selectedHasSidebar ? "tak" : "nie"}</b>
              </li>
              {selected.featuredRatioKey && (
                <li>
                  Ratio: <b>{local[selected.featuredRatioKey]}%</b>
                </li>
              )}
              {selected.recommendedImage && (
                <li className="pt-1 mt-1 border-t border-border/60">
                  Grafika:{" "}
                  <b className="text-foreground">
                    {selected.recommendedImage.width}×{selected.recommendedImage.height}px
                  </b>
                  {selected.recommendedImage.ratio ? ` · ${selected.recommendedImage.ratio}` : ""}
                </li>
              )}
            </ul>
          </aside>
        </div>
      </section>
    );
  };

  return (
    <AdminShell hideSidebar>
      <div className="max-w-5xl mx-auto p-4 space-y-6">
        <header className="flex items-center justify-between gap-3">
          <div>
            <h1 className="font-display text-xl">Layouty wpisów</h1>
            <p className="text-xs text-muted-foreground">
              Globalne ustawienia. Każdy wpis może je nadpisać w swoim edytorze.
            </p>
          </div>
          <button
            onClick={onSave}
            className="bg-brand text-brand-foreground px-4 py-2 rounded text-sm"
          >
            Zapisz
          </button>
        </header>

        <LayoutGrid
          title="Standard Post"
          value={local.standard_layout}
          presets={STANDARD_LAYOUTS}
          onChange={(id, extra) => upd({ standard_layout: id, ...(extra ?? {}) })}
        />
        <LayoutGrid
          title="Video Post"
          value={local.video_layout}
          presets={VIDEO_LAYOUTS}
          onChange={(id, extra) => upd({ video_layout: id, ...(extra ?? {}) })}
        />
        <LayoutGrid
          title="Audio Post"
          value={local.audio_layout}
          presets={AUDIO_LAYOUTS}
          onChange={(id, extra) => upd({ audio_layout: id, ...(extra ?? {}) })}
        />
        <LayoutGrid
          title="Gallery Post"
          value={local.gallery_layout}
          presets={GALLERY_LAYOUTS}
          onChange={(id, extra) => upd({ gallery_layout: id, ...(extra ?? {}) })}
        />

        <section className="space-y-2">
          <h2 className="font-display text-base">Featured Ratio</h2>
          <p className="text-[11px] text-muted-foreground">
            Procent szerokości względem obrazu wyróżniającego (Layout 6/10/11).
          </p>
          <div className="grid sm:grid-cols-3 gap-2">
            {(["featured_ratio_l6", "featured_ratio_l10", "featured_ratio_l11"] as const).map(
              (k) => (
                <label key={k} className="block">
                  <span className="text-[11px] text-muted-foreground">
                    {k.replace("featured_ratio_", "Layout ")}
                  </span>
                  <input
                    type="number"
                    value={local[k]}
                    onChange={(e) =>
                      upd({ [k]: Number(e.target.value) } as Partial<PostLayoutSettings>)
                    }
                    className="w-full px-2 py-1.5 rounded border border-input bg-background text-xs"
                  />
                </label>
              ),
            )}
          </div>
        </section>

        <TypographySection local={local} upd={upd} />

        <div className="grid md:grid-cols-2 gap-6">
          <section className="space-y-1">
            <h2 className="font-display text-base mb-1">Centering Header</h2>
            <Toggle
              label="Wycentruj tytuł i opis wpisu"
              checked={local.center_header}
              onChange={(v) => upd({ center_header: v })}
            />
            <Toggle
              label="Wycentruj pasek meta (data, autor)"
              checked={local.center_entry_meta}
              onChange={(v) => upd({ center_entry_meta: v })}
            />
          </section>

          <section className="space-y-1">
            <h2 className="font-display text-base mb-1">Stopka wpisu</h2>
            <Toggle
              label="Pasek tagów"
              checked={local.show_post_tags_bar}
              onChange={(v) => upd({ show_post_tags_bar: v })}
            />
            <Toggle
              label="Pasek źródeł"
              checked={local.show_sources_bar}
              onChange={(v) => upd({ show_sources_bar: v })}
            />
            <Toggle
              label="Pasek Via"
              checked={local.show_via_bar}
              onChange={(v) => upd({ show_via_bar: v })}
            />
            <Toggle
              label="Karta autora"
              checked={local.show_author_card}
              onChange={(v) => upd({ show_author_card: v })}
            />
            <Toggle
              label="Nawigacja Poprzedni/Następny"
              checked={local.show_prev_next}
              onChange={(v) => upd({ show_prev_next: v })}
            />
            <Toggle
              label="Ukryj paginację na mobile"
              checked={local.prev_next_mobile_hide}
              onChange={(v) => upd({ prev_next_mobile_hide: v })}
            />
            <Toggle
              label="Dolny newsletter w treści"
              checked={local.show_bottom_newsletter}
              onChange={(v) => upd({ show_bottom_newsletter: v })}
            />
            <Toggle
              label="Pływający pasek udostępniania (lewa strona, desktop)"
              checked={local.show_floating_share_bar}
              onChange={(v) => upd({ show_floating_share_bar: v })}
            />
            <Toggle
              label="Auto-load następnego wpisu (przy scrollu do końca)"
              checked={local.auto_load_next_post}
              onChange={(v) => upd({ auto_load_next_post: v })}
            />
          </section>
        </div>
      </div>
    </AdminShell>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-3 py-1 border-b border-border/60">
      <span className="text-xs">{label}</span>
      <button
        type="button"
        onClick={() => onChange(!checked)}
        className={`relative w-8 h-4 rounded-full transition shrink-0 ${checked ? "bg-brand" : "bg-muted"}`}
      >
        <span
          className={`absolute top-0.5 ${checked ? "left-4" : "left-0.5"} w-3 h-3 rounded-full bg-background transition-all`}
        />
      </button>
    </label>
  );
}

// Sekcja "Typografia overlay + nagłówek" - steruje CSS-vars w globalnym CSS
// (.overlay-title-typography, .overlay-excerpt-typography,
// .header-title-typography, .header-excerpt-typography). Panel edytuje ten
// sam obiekt `post_layout_settings`, który konsumuje PostLayoutRenderer
// (publiczny) i LayoutScaffold (podgląd CMS) - jedno źródło prawdy, zmiana
// widoczna natychmiast w obydwu widokach po zapisie.
interface TypoRow {
  key: keyof PostLayoutSettings;
  label: string;
  min: number;
  max: number;
}

function TypographySection({
  local,
  upd,
}: {
  local: PostLayoutSettings;
  upd: (p: Partial<PostLayoutSettings>) => void;
}) {
  const overlayTitle: TypoRow[] = [
    { key: "overlay_title_size_base", label: "Mobile", min: 12, max: 96 },
    { key: "overlay_title_size_md", label: "Tablet", min: 12, max: 96 },
    { key: "overlay_title_size_lg", label: "Desktop", min: 12, max: 96 },
  ];
  const overlayExcerpt: TypoRow[] = [
    { key: "overlay_excerpt_size_base", label: "Mobile", min: 8, max: 48 },
    { key: "overlay_excerpt_size_md", label: "Tablet", min: 8, max: 48 },
    { key: "overlay_excerpt_size_lg", label: "Desktop", min: 8, max: 48 },
  ];
  const headerTitle: TypoRow[] = [
    { key: "header_title_size_base", label: "Mobile", min: 14, max: 128 },
    { key: "header_title_size_md", label: "Tablet", min: 14, max: 128 },
    { key: "header_title_size_lg", label: "Desktop", min: 14, max: 128 },
  ];
  const headerExcerpt: TypoRow[] = [
    { key: "header_excerpt_size_base", label: "Mobile", min: 8, max: 48 },
    { key: "header_excerpt_size_md", label: "Tablet", min: 8, max: 48 },
    { key: "header_excerpt_size_lg", label: "Desktop", min: 8, max: 48 },
  ];

  const Group = ({ heading, hint, rows }: { heading: string; hint: string; rows: TypoRow[] }) => (
    <div className="space-y-2">
      <div>
        <h3 className="text-xs font-semibold text-foreground/80">{heading}</h3>
        <p className="text-[10px] text-muted-foreground">{hint}</p>
      </div>
      <div className="grid sm:grid-cols-3 gap-3">
        {rows.map((r) => {
          const value = Number(local[r.key] ?? 0);
          return (
            <label key={String(r.key)} className="block space-y-1">
              <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                <span>{r.label}</span>
                <span className="tabular-nums font-medium text-foreground/90">{value}px</span>
              </div>
              <input
                type="range"
                min={r.min}
                max={r.max}
                step={1}
                value={value}
                onChange={(e) =>
                  upd({ [r.key]: Number(e.target.value) } as Partial<PostLayoutSettings>)
                }
                className="w-full accent-brand"
                aria-label={`${heading} - ${r.label}`}
              />
              <input
                type="number"
                min={r.min}
                max={r.max}
                value={value}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  if (!Number.isFinite(n)) return;
                  const clamped = Math.max(r.min, Math.min(r.max, n));
                  upd({ [r.key]: clamped } as Partial<PostLayoutSettings>);
                }}
                className="w-full px-2 py-1 rounded border border-input bg-background text-xs"
              />
            </label>
          );
        })}
      </div>
    </div>
  );

  return (
    <section className="space-y-4">
      <div>
        <h2 className="font-display text-base">Typografia wpisu</h2>
        <p className="text-[11px] text-muted-foreground">
          Rozmiary czcionek tytułu i podtytułu (excerpt) per breakpoint. Wartości w pikselach.
          Zmiana natychmiast synchronizuje publiczny widok wpisu i podgląd w CMS.
        </p>
      </div>

      <Group
        heading="Tytuł - overlay (Layout 4 / 5 / 12)"
        hint="Widoczne w wariantach z pełnoekranowym coverem i nakładką."
        rows={overlayTitle}
      />
      <Group
        heading="Podtytuł - overlay"
        hint="Krótki opis (excerpt) na nakładce cover photo."
        rows={overlayExcerpt}
      />
      <Group
        heading="Tytuł - klasyczny nagłówek"
        hint="Layouty 1-3, 6-11 (nagłówek nad/pod cover, side-by-side, bez cover)."
        rows={headerTitle}
      />
      <Group
        heading="Podtytuł - klasyczny nagłówek"
        hint="Excerpt w klasycznych nagłówkach wpisu."
        rows={headerExcerpt}
      />
    </section>
  );
}
