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
    onChange: (id: string) => void;
    presets: LayoutPreset[];
    title: string;
    hint?: string;
  }) => {
    const selected = presets.find((p) => p.id === value) ?? presets[0];
    const overrides = local.layout_sidebar_overrides ?? {};
    const toggleSidebar = (presetId: string, next: boolean) => {
      const nextMap = { ...overrides, [presetId]: next };
      upd({ layout_sidebar_overrides: nextMap });
    };
    const selectedHasSidebar = effectiveHasSidebar(selected, local);
    return (
      <section className="space-y-3">
        <div className="flex items-baseline justify-between">
          <h2 className="font-display text-lg">{title}</h2>
          <span className="text-xs text-muted-foreground">
            Wybrany: <b>{selected.label}</b>
          </span>
        </div>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}

        {/* Duży podgląd wybranego presetu */}
        <div className="grid md:grid-cols-[1fr_280px] gap-4 items-start">
          <div>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {presets.map((p) => {
                const cardHasSidebar = effectiveHasSidebar(p, local);
                return (
                  <div
                    key={p.id}
                    className={`p-2 border rounded-lg transition ${value === p.id ? "border-brand ring-2 ring-brand/30" : "border-border"}`}
                  >
                    <button
                      type="button"
                      onClick={() => onChange(p.id)}
                      className="w-full text-left"
                      aria-label={`Wybierz ${p.label}`}
                    >
                      <LayoutPreview
                        preset={p}
                        settings={local}
                        hasSidebarOverride={cardHasSidebar}
                        className="mb-2"
                      />
                      <p className="text-[11px] font-medium truncate">{p.label}</p>
                    </button>
                    <label className="mt-2 flex items-center justify-between gap-2 pt-2 border-t border-border/60">
                      <span className="text-[10px] text-muted-foreground">Sidebar</span>
                      <button
                        type="button"
                        aria-label={`Sidebar w ${p.label}`}
                        aria-pressed={cardHasSidebar}
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleSidebar(p.id, !cardHasSidebar);
                        }}
                        className={`relative w-8 h-4 rounded-full transition ${cardHasSidebar ? "bg-brand" : "bg-muted"}`}
                      >
                        <span
                          className={`absolute top-0.5 ${cardHasSidebar ? "left-4" : "left-0.5"} w-3 h-3 rounded-full bg-background transition-all`}
                        />
                      </button>
                    </label>
                  </div>
                );
              })}
            </div>
          </div>
          <aside className="sticky top-4 space-y-2 border border-border rounded-lg p-3 bg-muted/30">
            <div className="text-xs uppercase tracking-wider text-muted-foreground">
              Live preview
            </div>
            <LayoutPreview
              preset={selected}
              settings={local}
              hasSidebarOverride={selectedHasSidebar}
            />
            <ul className="text-[11px] text-muted-foreground space-y-0.5 pt-2">
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
                  Featured ratio: <b>{local[selected.featuredRatioKey]}%</b>
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
      <div className="max-w-6xl mx-auto p-6 space-y-10">
        <header className="flex items-center justify-between">
          <div>
            <h1 className="font-display text-2xl">Layouty wpisów</h1>
            <p className="text-sm text-muted-foreground">
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
          onChange={(id) => upd({ standard_layout: id })}
        />
        <LayoutGrid
          title="Video Post"
          value={local.video_layout}
          presets={VIDEO_LAYOUTS}
          onChange={(id) => upd({ video_layout: id })}
        />
        <LayoutGrid
          title="Audio Post"
          value={local.audio_layout}
          presets={AUDIO_LAYOUTS}
          onChange={(id) => upd({ audio_layout: id })}
        />
        <LayoutGrid
          title="Gallery Post"
          value={local.gallery_layout}
          presets={GALLERY_LAYOUTS}
          onChange={(id) => upd({ gallery_layout: id })}
        />

        <section className="space-y-3">
          <h2 className="font-display text-lg">Featured Ratio</h2>
          <p className="text-xs text-muted-foreground">
            Procent szerokości względem obrazu wyróżniającego (Layout 6/10/11).
          </p>
          <div className="grid sm:grid-cols-3 gap-3">
            {(["featured_ratio_l6", "featured_ratio_l10", "featured_ratio_l11"] as const).map(
              (k) => (
                <label key={k} className="block">
                  <span className="text-xs text-muted-foreground">
                    {k.replace("featured_ratio_", "Layout ")}
                  </span>
                  <input
                    type="number"
                    value={local[k]}
                    onChange={(e) =>
                      upd({ [k]: Number(e.target.value) } as Partial<PostLayoutSettings>)
                    }
                    className="w-full px-3 py-2 rounded border border-input bg-background text-sm"
                  />
                </label>
              ),
            )}
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="font-display text-lg">Centering Header</h2>
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

        <section className="space-y-3">
          <h2 className="font-display text-lg">Stopka wpisu</h2>
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
    <label className="flex items-center justify-between gap-4 py-2 border-b border-border/60">
      <span className="text-sm">{label}</span>
      <button
        type="button"
        onClick={() => onChange(!checked)}
        className={`relative w-10 h-6 rounded-full transition ${checked ? "bg-brand" : "bg-muted"}`}
      >
        <span
          className={`absolute top-0.5 ${checked ? "left-5" : "left-0.5"} w-5 h-5 rounded-full bg-background transition-all`}
        />
      </button>
    </label>
  );
}
