// Theme Options panel (Foxiz-style) — Logo + Header sections.
// Stores everything under site_settings.theme_options.
import { useState } from "react";
import { useSettings, useDraft } from "@/lib/admin/useSettings";
import { ImageSlot } from "@/components/admin/ImageSlot";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sun, Moon, Save, Image as ImageIcon, Smartphone, Eye, Star, Globe, Menu, Search, ChevronRight } from "@/lib/lucide-shim";

// ---------- Defaults ----------
const DEFAULTS = {
  logo: {
    main: "",
    main_dark: "",
    mobile: "",
    mobile_dark: "",
    transparent: "",
    organization: "",
    bookmark_ios: "",
    bookmark_windows: "",
    add_to_home_screen: true,
  },
  header: {
    main_menu: {
      hover_effect: "color-border" as "color-border" | "underline" | "background" | "scale" | "none",
      sticky: true,
      smart_sticky: false,
      glass_effect: false,
      item_spacing: 12,
      icon_spacing: 5,
      submenu_bg_from: "",
      submenu_bg_to: "",
    },
    search: {
      enabled: true,
      heading: "Search",
      mode: "standalone" as "standalone" | "dropdown" | "fullscreen",
      live_results: true,
      live_limit: 5,
      more_menu_search: true,
    },
  },
} as const;

type ThemeOptions = typeof DEFAULTS;

const SECTIONS = [
  { id: "logo", label: "Logo", icon: ImageIcon },
  { id: "header.main_menu", label: "Main Menu", icon: Menu },
  { id: "header.search", label: "Header Search", icon: Search },
] as const;

export function ThemeOptionsPane() {
  const { query, save } = useSettings<ThemeOptions>("theme_options", DEFAULTS as unknown as ThemeOptions);
  const [draft, setDraft] = useDraft<ThemeOptions>(query.data);
  const [active, setActive] = useState<(typeof SECTIONS)[number]["id"]>("logo");
  const [logoTab, setLogoTab] = useState<"default" | "mobile" | "transparent" | "organization" | "bookmark">("default");

  if (!draft) return <p className="text-sm text-muted-foreground">Ładowanie…</p>;

  const patchLogo = (p: Partial<ThemeOptions["logo"]>) =>
    setDraft({ ...draft, logo: { ...draft.logo, ...p } });
  const patchMenu = (p: Partial<ThemeOptions["header"]["main_menu"]>) =>
    setDraft({ ...draft, header: { ...draft.header, main_menu: { ...draft.header.main_menu, ...p } } });
  const patchSearch = (p: Partial<ThemeOptions["header"]["search"]>) =>
    setDraft({ ...draft, header: { ...draft.header, search: { ...draft.header.search, ...p } } });

  return (
    <div className="grid grid-cols-[220px_1fr] gap-4 min-h-[600px]">
      {/* Sidebar nav */}
      <aside className="border border-border rounded-lg overflow-hidden bg-card">
        <div className="px-3 py-2 border-b border-border text-[11px] uppercase tracking-wider text-muted-foreground font-medium">
          Opcje motywu
        </div>
        <nav className="flex flex-col">
          {SECTIONS.map((s) => {
            const Icon = s.icon;
            const isActive = active === s.id;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => setActive(s.id)}
                className={`flex items-center gap-2 px-3 py-2 text-sm text-left border-l-2 transition ${
                  isActive
                    ? "border-brand bg-brand/10 text-brand font-medium"
                    : "border-transparent hover:bg-muted text-foreground"
                }`}
              >
                <Icon className="w-4 h-4" />
                <span className="flex-1">{s.label}</span>
                {isActive && <ChevronRight className="w-3 h-3" />}
              </button>
            );
          })}
        </nav>
      </aside>

      {/* Panel */}
      <section className="border border-border rounded-lg bg-card p-5 space-y-5">
        <div className="flex items-center justify-between">
          <h3 className="font-display text-lg">{SECTIONS.find((s) => s.id === active)?.label}</h3>
          <Button size="sm" onClick={() => save.mutate(draft)} disabled={save.isPending}>
            <Save className="w-4 h-4 mr-2" /> {save.isPending ? "Zapisywanie…" : "Zapisz"}
          </Button>
        </div>

        {active === "logo" && (
          <div className="space-y-5">
            <LogoTabs value={logoTab} onChange={setLogoTab} />

            {logoTab === "default" && (
              <div className="grid md:grid-cols-2 gap-4">
                <ImageSlot
                  label="Main Logo"
                  icon={<Sun className="w-3.5 h-3.5" />}
                  value={draft.logo.main}
                  onChange={(v) => patchLogo({ main: v })}
                  hint="Zalecana wysokość 120px (retina)."
                  folder="theme/logo"
                />
                <ImageSlot
                  label="Dark Mode — Main Logo"
                  icon={<Moon className="w-3.5 h-3.5" />}
                  value={draft.logo.main_dark}
                  onChange={(v) => patchLogo({ main_dark: v })}
                  hint="Wariant dla ciemnego motywu."
                  folder="theme/logo"
                />
              </div>
            )}

            {logoTab === "mobile" && (
              <div className="grid md:grid-cols-2 gap-4">
                <ImageSlot
                  label="Mobile Logo"
                  icon={<Smartphone className="w-3.5 h-3.5" />}
                  value={draft.logo.mobile}
                  onChange={(v) => patchLogo({ mobile: v })}
                  hint="Zalecana wysokość 84px."
                  folder="theme/logo"
                />
                <ImageSlot
                  label="Dark Mode — Mobile"
                  icon={<Moon className="w-3.5 h-3.5" />}
                  value={draft.logo.mobile_dark}
                  onChange={(v) => patchLogo({ mobile_dark: v })}
                  folder="theme/logo"
                />
              </div>
            )}

            {logoTab === "transparent" && (
              <ImageSlot
                label="Transparent Logo"
                icon={<Eye className="w-3.5 h-3.5" />}
                value={draft.logo.transparent}
                onChange={(v) => patchLogo({ transparent: v })}
                hint="Logo dla nagłówków z przezroczystym tłem."
                folder="theme/logo"
              />
            )}

            {logoTab === "organization" && (
              <div className="space-y-3">
                <div className="rounded-md border border-l-4 border-l-brand bg-brand/5 p-3 text-xs">
                  Logo dla schema markup (social media, wyniki wyszukiwania). Zostaw puste, by użyć Main Logo.
                </div>
                <ImageSlot
                  label="Organization Logo"
                  icon={<Star className="w-3.5 h-3.5" />}
                  value={draft.logo.organization}
                  onChange={(v) => patchLogo({ organization: v })}
                  folder="theme/logo"
                />
              </div>
            )}

            {logoTab === "bookmark" && (
              <div className="space-y-4">
                <ImageSlot
                  label="iOS Touch Icon"
                  icon={<Globe className="w-3.5 h-3.5" />}
                  value={draft.logo.bookmark_ios}
                  onChange={(v) => patchLogo({ bookmark_ios: v })}
                  hint="Zalecany rozmiar 180×180px."
                  folder="theme/icons"
                />
                <Row label="Add to Home Screen" hint="Wymaga ustawionego iOS Touch Icon.">
                  <Switch
                    checked={draft.logo.add_to_home_screen}
                    onCheckedChange={(v) => patchLogo({ add_to_home_screen: v })}
                  />
                </Row>
                <ImageSlot
                  label="Windows Metro Tile Icon"
                  icon={<Globe className="w-3.5 h-3.5" />}
                  value={draft.logo.bookmark_windows}
                  onChange={(v) => patchLogo({ bookmark_windows: v })}
                  hint="Zalecany rozmiar 144×144px."
                  folder="theme/icons"
                />
              </div>
            )}
          </div>
        )}

        {active === "header.main_menu" && (
          <div className="space-y-4">
            <SectionTitle>Navigation (Top Level)</SectionTitle>
            <Row label="Menu Hover Effect" hint="Stosowane do elementów najwyższego poziomu.">
              <Select
                value={draft.header.main_menu.hover_effect}
                onValueChange={(v) => patchMenu({ hover_effect: v as ThemeOptions["header"]["main_menu"]["hover_effect"] })}
              >
                <SelectTrigger className="w-[220px] h-9 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="color-border">Default (Color Border)</SelectItem>
                  <SelectItem value="underline">Underline</SelectItem>
                  <SelectItem value="background">Background</SelectItem>
                  <SelectItem value="scale">Scale</SelectItem>
                  <SelectItem value="none">None</SelectItem>
                </SelectContent>
              </Select>
            </Row>
            <Row label="Sticky Main Menu" hint="Utrzymuj pasek menu widoczny podczas przewijania.">
              <Switch checked={draft.header.main_menu.sticky} onCheckedChange={(v) => patchMenu({ sticky: v })} />
            </Row>
            <Row label="Smart Sticky" hint="Pokazuj pasek tylko przy przewijaniu w górę.">
              <Switch checked={draft.header.main_menu.smart_sticky} onCheckedChange={(v) => patchMenu({ smart_sticky: v })} />
            </Row>
            <Row label="Glass Effect" hint="Efekt szkła (frosted) na sticky nagłówku.">
              <Switch checked={draft.header.main_menu.glass_effect} onCheckedChange={(v) => patchMenu({ glass_effect: v })} />
            </Row>
            <Row label="Item Spacing (px)" hint="Padding lewy/prawy pozycji menu.">
              <Input
                type="number" min={0} max={64}
                className="w-[120px] h-9 text-xs"
                value={draft.header.main_menu.item_spacing}
                onChange={(e) => patchMenu({ item_spacing: Number(e.target.value) || 0 })}
              />
            </Row>
            <Row label="Menu Icon Spacing (px)" hint="Odstęp między tekstem a ikoną.">
              <Input
                type="number" min={0} max={32}
                className="w-[120px] h-9 text-xs"
                value={draft.header.main_menu.icon_spacing}
                onChange={(e) => patchMenu({ icon_spacing: Number(e.target.value) || 0 })}
              />
            </Row>

            <SectionTitle>Sub-Level Menus</SectionTitle>
            <Row label="Tło submenu — From">
              <Input type="color" className="w-[80px] h-9" value={draft.header.main_menu.submenu_bg_from || "#ffffff"} onChange={(e) => patchMenu({ submenu_bg_from: e.target.value })} />
            </Row>
            <Row label="Tło submenu — To">
              <Input type="color" className="w-[80px] h-9" value={draft.header.main_menu.submenu_bg_to || "#ffffff"} onChange={(e) => patchMenu({ submenu_bg_to: e.target.value })} />
            </Row>
          </div>
        )}

        {active === "header.search" && (
          <div className="space-y-4">
            <Row label="Header Search Icon" hint="Włącz lub wyłącz ikonę wyszukiwarki w nagłówku.">
              <Switch checked={draft.header.search.enabled} onCheckedChange={(v) => patchSearch({ enabled: v })} />
            </Row>
            <Row label="Search Heading" hint="Nagłówek nad formularzem wyszukiwania.">
              <Input value={draft.header.search.heading} onChange={(e) => patchSearch({ heading: e.target.value })} className="w-[260px] h-9 text-xs" />
            </Row>
            <Row label="Search Form Appearance Mode" hint="Sposób pojawiania się formularza.">
              <Select value={draft.header.search.mode} onValueChange={(v) => patchSearch({ mode: v as ThemeOptions["header"]["search"]["mode"] })}>
                <SelectTrigger className="w-[260px] h-9 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="standalone">Standalone Search Form</SelectItem>
                  <SelectItem value="dropdown">Dropdown</SelectItem>
                  <SelectItem value="fullscreen">Fullscreen Overlay</SelectItem>
                </SelectContent>
              </Select>
            </Row>
            <Row label="Live Search Result" hint="Wyświetlaj wyniki na żywo podczas pisania.">
              <Switch checked={draft.header.search.live_results} onCheckedChange={(v) => patchSearch({ live_results: v })} />
            </Row>
            <Row label="Live Search Limit Posts" hint="Maksymalnie 10 pozycji.">
              <Input
                type="number" min={1} max={10}
                className="w-[120px] h-9 text-xs"
                value={draft.header.search.live_limit}
                onChange={(e) => patchSearch({ live_limit: Math.min(10, Math.max(1, Number(e.target.value) || 1)) })}
              />
            </Row>
            <Row label="More Menu — Search Form" hint="Pokaż formularz w sekcji „More”.">
              <Switch checked={draft.header.search.more_menu_search} onCheckedChange={(v) => patchSearch({ more_menu_search: v })} />
            </Row>
          </div>
        )}
      </section>
    </div>
  );
}

function LogoTabs({ value, onChange }: { value: string; onChange: (v: "default" | "mobile" | "transparent" | "organization" | "bookmark") => void }) {
  const tabs: { id: "default" | "mobile" | "transparent" | "organization" | "bookmark"; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
    { id: "default", label: "Default Logos", icon: ImageIcon },
    { id: "mobile", label: "Mobile Logos", icon: Smartphone },
    { id: "transparent", label: "Transparent", icon: Eye },
    { id: "organization", label: "Organization", icon: Star },
    { id: "bookmark", label: "Globelet", icon: Globe },
  ];
  return (
    <div className="inline-flex flex-wrap gap-1 rounded-md border border-border p-1 bg-muted/30">
      {tabs.map((t) => {
        const Icon = t.icon;
        const active = value === t.id;
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => onChange(t.id)}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs transition ${
              active ? "bg-brand text-brand-foreground" : "hover:bg-background text-muted-foreground"
            }`}
          >
            <Icon className="w-3.5 h-3.5" />
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-md bg-sky-500 text-white text-xs font-semibold px-3 py-2">
      {children}
    </div>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[1fr_auto] gap-4 py-2 border-b border-border/60 last:border-0 items-center">
      <div>
        <Label className="text-sm font-medium">{label}</Label>
        {hint && <p className="text-[11px] text-muted-foreground mt-0.5">{hint}</p>}
      </div>
      <div>{children}</div>
    </div>
  );
}
