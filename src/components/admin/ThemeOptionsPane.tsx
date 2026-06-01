// Theme Options panel (Foxiz-style) — Logo + Header sections.
// Stores everything under site_settings.theme_options.
import { useEffect, useState } from "react";
import { useSettings } from "@/lib/admin/useSettings";
import { ImageSlot } from "@/components/admin/ImageSlot";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sun, Moon, Save, Image as ImageIcon, Smartphone, Eye, Star, Globe, Menu, Search, ChevronRight, Megaphone, LayoutDashboard, Users, LogIn, Layers, MousePointerClick, Pencil } from "@/lib/lucide-shim";
import { GlobalColorsEditor } from "@/components/admin/GlobalColorsEditor";
import { useTheme } from "@/components/ThemeProvider";


// ---------- Defaults ----------
type HoverEffect = "color-border" | "underline" | "background" | "scale" | "none";
type SearchMode = "standalone" | "dropdown" | "fullscreen";
type AlertStyle = "info" | "warning" | "success" | "brand";
type HeaderLayout = "layout-1" | "layout-2" | "layout-3" | "layout-4" | "layout-5";
type SocialPlacement = "topbar" | "navbar" | "both" | "hidden";
type ButtonVariant = "solid" | "outline" | "ghost" | "pill";
type ButtonSize = "sm" | "md" | "lg";
type InputStyle = "filled" | "outline" | "underline";
type FocusRing = "none" | "brand" | "border";

interface ThemeOptions extends Record<string, unknown> {
  logo: {
    main: string; main_dark: string;
    mobile: string; mobile_dark: string;
    transparent: string; transparent_dark: string;
    organization: string; organization_dark: string;
    sidebar_icon: string; sidebar_icon_dark: string;
    sidebar_expanded: string; sidebar_expanded_dark: string;
    bookmark_ios: string; bookmark_ios_dark: string;
    bookmark_windows: string; bookmark_windows_dark: string;
    add_to_home_screen: boolean;
  };
  header: {
    layout: HeaderLayout;
    main_menu: {
      hover_effect: HoverEffect; sticky: boolean; smart_sticky: boolean; glass_effect: boolean;
      item_spacing: number; icon_spacing: number;
      submenu_bg_from: string; submenu_bg_to: string;
    };
    search: {
      enabled: boolean; heading: string; mode: SearchMode;
      live_results: boolean; live_limit: number; more_menu_search: boolean;
    };
    alert_bar: {
      enabled: boolean;
      message_pl: string; message_en: string;
      link_url: string;
      style: AlertStyle;
      dismissible: boolean;
    };
    mobile: {
      breakpoint: number;
      use_mobile_logo: boolean;
      sticky: boolean;
      show_search: boolean;
    };
    socials: {
      placement: SocialPlacement;
      facebook: string; twitter: string; instagram: string;
      linkedin: string; youtube: string; email: string;
      size: number;
    };
    signin: {
      enabled: boolean;
      signin_label_pl: string; signin_label_en: string;
      signup_label_pl: string; signup_label_en: string;
      variant: ButtonVariant;
      show_signup: boolean;
    };
  };
  buttons: {
    default_variant: ButtonVariant;
    default_size: ButtonSize;
    radius: number;
    padding_x: number;
    padding_y: number;
    font_weight: number;
    uppercase: boolean;
    letter_spacing: number;
  };
  text_fields: {
    style: InputStyle;
    radius: number;
    height: number;
    border_width: number;
    focus_ring: FocusRing;
    focus_ring_width: number;
    show_label_above: boolean;
  };
}

const DEFAULTS: ThemeOptions = {
  logo: { main: "", main_dark: "", mobile: "", mobile_dark: "", transparent: "", transparent_dark: "", organization: "", organization_dark: "", sidebar_icon: "", sidebar_icon_dark: "", sidebar_expanded: "", sidebar_expanded_dark: "", bookmark_ios: "", bookmark_ios_dark: "", bookmark_windows: "", bookmark_windows_dark: "", add_to_home_screen: true },
  header: {
    layout: "layout-1",
    main_menu: { hover_effect: "color-border", sticky: true, smart_sticky: false, glass_effect: false, item_spacing: 12, icon_spacing: 5, submenu_bg_from: "", submenu_bg_to: "" },
    search: { enabled: true, heading: "Search", mode: "standalone", live_results: true, live_limit: 5, more_menu_search: true },
    alert_bar: { enabled: false, message_pl: "", message_en: "", link_url: "", style: "brand", dismissible: true },
    mobile: { breakpoint: 1024, use_mobile_logo: true, sticky: true, show_search: true },
    socials: { placement: "topbar", facebook: "", twitter: "", instagram: "", linkedin: "", youtube: "", email: "", size: 16 },
    signin: { enabled: true, signin_label_pl: "Zaloguj", signin_label_en: "Sign in", signup_label_pl: "Zarejestruj", signup_label_en: "Sign up", variant: "ghost", show_signup: true },
  },
  buttons: {
    default_variant: "solid",
    default_size: "md",
    radius: 8,
    padding_x: 16,
    padding_y: 10,
    font_weight: 600,
    uppercase: false,
    letter_spacing: 0,
  },
  text_fields: {
    style: "outline",
    radius: 6,
    height: 40,
    border_width: 1,
    focus_ring: "brand",
    focus_ring_width: 2,
    show_label_above: true,
  },
};

const SECTIONS = [
  { id: "logo", label: "Logo", icon: ImageIcon },
  { id: "global_colors", label: "Global Colors", icon: Eye },
  { id: "header.layout", label: "Header Layout", icon: Layers },
  { id: "header.main_menu", label: "Main Menu", icon: Menu },
  { id: "header.search", label: "Header Search", icon: Search },
  { id: "header.alert_bar", label: "Alert Bar", icon: Megaphone },
  { id: "header.socials", label: "Social Icons", icon: Users },
  { id: "header.signin", label: "Sign In Buttons", icon: LogIn },
  { id: "header.mobile", label: "Mobile Header", icon: LayoutDashboard },
  { id: "buttons", label: "Buttons", icon: MousePointerClick },
  { id: "text_fields", label: "Text Fields", icon: Pencil },
] as const;

const LAYOUT_PREVIEWS: Record<HeaderLayout, { label: string; hint: string }> = {
  "layout-1": { label: "Layout 1 — Classic Centered", hint: "Utility bar + centered logo + nav (current default)" },
  "layout-2": { label: "Layout 2 — Logo Left", hint: "Logo po lewej, nav po prawej, jeden pasek" },
  "layout-3": { label: "Layout 3 — Split Nav", hint: "Logo centralnie, menu po obu stronach" },
  "layout-4": { label: "Layout 4 — Stacked", hint: "Utility bar + logo + nav (3 paski)" },
  "layout-5": { label: "Layout 5 — Minimal", hint: "Tylko logo + menu, bez utility bar" },
};

export function ThemeOptionsPane() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { query, save } = useSettings<any>("theme_options", DEFAULTS as any);
  const [draft, setDraft] = useState<ThemeOptions | null>(null);
  useEffect(() => { if (query.data && !draft) setDraft(query.data as ThemeOptions); }, [query.data, draft]);
  const [active, setActive] = useState<(typeof SECTIONS)[number]["id"]>("logo");
  const [logoTab, setLogoTab] = useState<"default" | "mobile" | "transparent" | "organization" | "sidebar" | "bookmark">("default");

  if (!draft) return <p className="text-sm text-muted-foreground">Ładowanie…</p>;

  const patchLogo = (p: Partial<ThemeOptions["logo"]>) =>
    setDraft({ ...draft, logo: { ...draft.logo, ...p } });
  const patchMenu = (p: Partial<ThemeOptions["header"]["main_menu"]>) =>
    setDraft({ ...draft, header: { ...draft.header, main_menu: { ...draft.header.main_menu, ...p } } });
  const patchSearch = (p: Partial<ThemeOptions["header"]["search"]>) =>
    setDraft({ ...draft, header: { ...draft.header, search: { ...draft.header.search, ...p } } });
  const patchAlert = (p: Partial<ThemeOptions["header"]["alert_bar"]>) =>
    setDraft({ ...draft, header: { ...draft.header, alert_bar: { ...draft.header.alert_bar, ...p } } });
  const patchMobile = (p: Partial<ThemeOptions["header"]["mobile"]>) =>
    setDraft({ ...draft, header: { ...draft.header, mobile: { ...draft.header.mobile, ...p } } });
  const patchSocials = (p: Partial<ThemeOptions["header"]["socials"]>) =>
    setDraft({ ...draft, header: { ...draft.header, socials: { ...draft.header.socials, ...p } } });
  const patchSignin = (p: Partial<ThemeOptions["header"]["signin"]>) =>
    setDraft({ ...draft, header: { ...draft.header, signin: { ...draft.header.signin, ...p } } });
  const patchLayout = (layout: HeaderLayout) =>
    setDraft({ ...draft, header: { ...draft.header, layout } });
  const patchButtons = (p: Partial<ThemeOptions["buttons"]>) =>
    setDraft({ ...draft, buttons: { ...draft.buttons, ...p } });
  const patchInputs = (p: Partial<ThemeOptions["text_fields"]>) =>
    setDraft({ ...draft, text_fields: { ...draft.text_fields, ...p } });

  return (
    <ThemeOptionsBody
      draft={draft}
      active={active}
      setActive={(id) => setActive(id as typeof active)}
      save={save}
    >
      {/* Panel */}
      <section className="border border-border rounded-lg bg-card p-5 space-y-5">
        {active === "global_colors" ? (
          <GlobalColorsEditor />
        ) : (
        <>
        <div className="flex items-center justify-between">
          <h3 className="font-display text-lg">{SECTIONS.find((s) => s.id === active)?.label}</h3>
          <Button size="sm" onClick={() => save.mutate(draft)} disabled={save.isPending}>
            <Save className="w-4 h-4 mr-2" /> {save.isPending ? "Zapisywanie…" : "Zapisz"}
          </Button>
        </div>


        {active === "logo" && (
          <div className="space-y-5">
            <LogoPreview logo={draft.logo} tab={logoTab} />
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
              <div className="grid md:grid-cols-2 gap-4">
                <ImageSlot
                  label="Transparent Logo"
                  icon={<Sun className="w-3.5 h-3.5" />}
                  value={draft.logo.transparent}
                  onChange={(v) => patchLogo({ transparent: v })}
                  hint="Logo dla nagłówków z przezroczystym tłem."
                  folder="theme/logo"
                />
                <ImageSlot
                  label="Dark Mode — Transparent"
                  icon={<Moon className="w-3.5 h-3.5" />}
                  value={draft.logo.transparent_dark}
                  onChange={(v) => patchLogo({ transparent_dark: v })}
                  hint="Wariant dla ciemnego motywu."
                  folder="theme/logo"
                />
              </div>
            )}

            {logoTab === "organization" && (
              <div className="space-y-3">
                <div className="rounded-md border border-l-4 border-l-brand bg-brand/5 p-3 text-xs">
                  Logo dla schema markup (social media, wyniki wyszukiwania). Zostaw puste, by użyć Main Logo.
                </div>
                <div className="grid md:grid-cols-2 gap-4">
                  <ImageSlot
                    label="Organization Logo"
                    icon={<Sun className="w-3.5 h-3.5" />}
                    value={draft.logo.organization}
                    onChange={(v) => patchLogo({ organization: v })}
                    folder="theme/logo"
                  />
                  <ImageSlot
                    label="Dark Mode — Organization"
                    icon={<Moon className="w-3.5 h-3.5" />}
                    value={draft.logo.organization_dark}
                    onChange={(v) => patchLogo({ organization_dark: v })}
                    folder="theme/logo"
                  />
                </div>
              </div>
            )}

            {logoTab === "sidebar" && (
              <div className="space-y-4">
                <div className="rounded-md border border-l-4 border-l-brand bg-brand/5 p-3 text-xs">
                  Logo sidebaru. <strong>Kwadrat</strong> pokazywany po zwinięciu, <strong>podłużne logo</strong> po rozwinięciu sidebaru.
                </div>
                <div>
                  <div className="text-[11px] uppercase tracking-wider font-bold text-muted-foreground mb-2">Zwinięty sidebar — ikona (kwadrat)</div>
                  <div className="grid md:grid-cols-2 gap-4">
                    <ImageSlot
                      label="Sidebar Icon"
                      icon={<Sun className="w-3.5 h-3.5" />}
                      value={draft.logo.sidebar_icon}
                      onChange={(v) => patchLogo({ sidebar_icon: v })}
                      hint="Kwadratowa ikona (np. 64×64px)."
                      folder="theme/logo"
                    />
                    <ImageSlot
                      label="Dark Mode — Sidebar Icon"
                      icon={<Moon className="w-3.5 h-3.5" />}
                      value={draft.logo.sidebar_icon_dark}
                      onChange={(v) => patchLogo({ sidebar_icon_dark: v })}
                      folder="theme/logo"
                    />
                  </div>
                </div>
                <div>
                  <div className="text-[11px] uppercase tracking-wider font-bold text-muted-foreground mb-2">Rozwinięty sidebar — podłużne logo</div>
                  <div className="grid md:grid-cols-2 gap-4">
                    <ImageSlot
                      label="Sidebar Expanded Logo"
                      icon={<Sun className="w-3.5 h-3.5" />}
                      value={draft.logo.sidebar_expanded}
                      onChange={(v) => patchLogo({ sidebar_expanded: v })}
                      hint="Podłużne logo (np. 200×48px)."
                      folder="theme/logo"
                    />
                    <ImageSlot
                      label="Dark Mode — Sidebar Expanded"
                      icon={<Moon className="w-3.5 h-3.5" />}
                      value={draft.logo.sidebar_expanded_dark}
                      onChange={(v) => patchLogo({ sidebar_expanded_dark: v })}
                      folder="theme/logo"
                    />
                  </div>
                </div>
              </div>
            )}

            {logoTab === "bookmark" && (
              <div className="space-y-5">
                <div>
                  <div className="text-[11px] uppercase tracking-wider font-bold text-muted-foreground mb-2">iOS Touch Icon · 180×180px</div>
                  <div className="grid md:grid-cols-2 gap-4">
                    <ImageSlot
                      label="iOS Touch Icon"
                      icon={<Sun className="w-3.5 h-3.5" />}
                      value={draft.logo.bookmark_ios}
                      onChange={(v) => patchLogo({ bookmark_ios: v })}
                      folder="theme/icons"
                    />
                    <ImageSlot
                      label="Dark Mode — iOS Touch Icon"
                      icon={<Moon className="w-3.5 h-3.5" />}
                      value={draft.logo.bookmark_ios_dark}
                      onChange={(v) => patchLogo({ bookmark_ios_dark: v })}
                      folder="theme/icons"
                    />
                  </div>
                </div>
                <Row label="Add to Home Screen" hint="Wymaga ustawionego iOS Touch Icon.">
                  <Switch
                    checked={draft.logo.add_to_home_screen}
                    onCheckedChange={(v) => patchLogo({ add_to_home_screen: v })}
                  />
                </Row>
                <div>
                  <div className="text-[11px] uppercase tracking-wider font-bold text-muted-foreground mb-2">Windows Metro Tile · 144×144px</div>
                  <div className="grid md:grid-cols-2 gap-4">
                    <ImageSlot
                      label="Windows Metro Tile Icon"
                      icon={<Sun className="w-3.5 h-3.5" />}
                      value={draft.logo.bookmark_windows}
                      onChange={(v) => patchLogo({ bookmark_windows: v })}
                      folder="theme/icons"
                    />
                    <ImageSlot
                      label="Dark Mode — Windows Metro Tile"
                      icon={<Moon className="w-3.5 h-3.5" />}
                      value={draft.logo.bookmark_windows_dark}
                      onChange={(v) => patchLogo({ bookmark_windows_dark: v })}
                      folder="theme/icons"
                    />
                  </div>
                </div>
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

        {active === "header.alert_bar" && (
          <div className="space-y-4">
            <Row label="Włącz Alert Bar" hint="Pasek powiadomień nad nagłówkiem.">
              <Switch checked={draft.header.alert_bar.enabled} onCheckedChange={(v) => patchAlert({ enabled: v })} />
            </Row>
            <Row label="Treść (PL)">
              <Input value={draft.header.alert_bar.message_pl} onChange={(e) => patchAlert({ message_pl: e.target.value })} className="w-[320px] h-9 text-xs" placeholder="Nowa publikacja dostępna…" />
            </Row>
            <Row label="Treść (EN)">
              <Input value={draft.header.alert_bar.message_en} onChange={(e) => patchAlert({ message_en: e.target.value })} className="w-[320px] h-9 text-xs" placeholder="New publication available…" />
            </Row>
            <Row label="Link (URL)" hint="Opcjonalny — całość paska klikalna.">
              <Input value={draft.header.alert_bar.link_url} onChange={(e) => patchAlert({ link_url: e.target.value })} className="w-[320px] h-9 text-xs" placeholder="/blog" />
            </Row>
            <Row label="Styl">
              <Select value={draft.header.alert_bar.style} onValueChange={(v) => patchAlert({ style: v as AlertStyle })}>
                <SelectTrigger className="w-[200px] h-9 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="brand">Brand</SelectItem>
                  <SelectItem value="info">Info</SelectItem>
                  <SelectItem value="warning">Warning</SelectItem>
                  <SelectItem value="success">Success</SelectItem>
                </SelectContent>
              </Select>
            </Row>
            <Row label="Możliwość zamknięcia" hint="Użytkownik może ukryć pasek (zapamiętane w localStorage).">
              <Switch checked={draft.header.alert_bar.dismissible} onCheckedChange={(v) => patchAlert({ dismissible: v })} />
            </Row>
          </div>
        )}

        {active === "header.mobile" && (
          <div className="space-y-4">
            <Row label="Mobile Breakpoint (px)" hint="Poniżej tej szerokości aktywuje się układ mobilny.">
              <Input
                type="number" min={480} max={1400}
                className="w-[120px] h-9 text-xs"
                value={draft.header.mobile.breakpoint}
                onChange={(e) => patchMobile({ breakpoint: Number(e.target.value) || 1024 })}
              />
            </Row>
            <Row label="Użyj Mobile Logo" hint="Zamiast głównego logo na mobile.">
              <Switch checked={draft.header.mobile.use_mobile_logo} onCheckedChange={(v) => patchMobile({ use_mobile_logo: v })} />
            </Row>
            <Row label="Sticky na mobile">
              <Switch checked={draft.header.mobile.sticky} onCheckedChange={(v) => patchMobile({ sticky: v })} />
            </Row>
            <Row label="Pokaż ikonę wyszukiwania">
              <Switch checked={draft.header.mobile.show_search} onCheckedChange={(v) => patchMobile({ show_search: v })} />
            </Row>
          </div>
        )}

        {active === "header.layout" && (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">Wybierz układ nagłówka. Wpływa na pozycję logo, menu i utility bar.</p>
            <div className="grid md:grid-cols-2 gap-3">
              {(Object.keys(LAYOUT_PREVIEWS) as HeaderLayout[]).map((id) => {
                const meta = LAYOUT_PREVIEWS[id];
                const active = draft.header.layout === id;
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => patchLayout(id)}
                    className={`text-left rounded-lg border-2 p-3 transition ${
                      active ? "border-brand bg-brand/5" : "border-border hover:border-brand/40"
                    }`}
                  >
                    <div className="text-sm font-medium">{meta.label}</div>
                    <div className="text-[11px] text-muted-foreground mt-0.5">{meta.hint}</div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {active === "header.socials" && (
          <div className="space-y-4">
            <Row label="Placement" hint="Gdzie pokazywać ikony społecznościowe.">
              <Select value={draft.header.socials.placement} onValueChange={(v) => patchSocials({ placement: v as SocialPlacement })}>
                <SelectTrigger className="w-[200px] h-9 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="topbar">Utility bar (góra)</SelectItem>
                  <SelectItem value="navbar">Nav bar</SelectItem>
                  <SelectItem value="both">Oba paski</SelectItem>
                  <SelectItem value="hidden">Ukryj</SelectItem>
                </SelectContent>
              </Select>
            </Row>
            <Row label="Rozmiar ikon (px)">
              <Input type="number" min={12} max={32} className="w-[120px] h-9 text-xs"
                value={draft.header.socials.size}
                onChange={(e) => patchSocials({ size: Number(e.target.value) || 16 })} />
            </Row>
            {(["facebook", "twitter", "instagram", "linkedin", "youtube", "email"] as const).map((k) => (
              <Row key={k} label={k.charAt(0).toUpperCase() + k.slice(1)} hint={k === "email" ? "Adres e-mail (bez mailto:)" : "URL profilu"}>
                <Input value={draft.header.socials[k]} onChange={(e) => patchSocials({ [k]: e.target.value } as Partial<ThemeOptions["header"]["socials"]>)} className="w-[320px] h-9 text-xs" placeholder={k === "email" ? "kontakt@example.com" : `https://${k}.com/...`} />
              </Row>
            ))}
          </div>
        )}

        {active === "header.signin" && (
          <div className="space-y-4">
            <Row label="Pokaż przyciski auth" hint="Włącz/wyłącz przyciski logowania w nagłówku.">
              <Switch checked={draft.header.signin.enabled} onCheckedChange={(v) => patchSignin({ enabled: v })} />
            </Row>
            <Row label="Pokaż przycisk rejestracji">
              <Switch checked={draft.header.signin.show_signup} onCheckedChange={(v) => patchSignin({ show_signup: v })} />
            </Row>
            <Row label="Wariant przycisku">
              <Select value={draft.header.signin.variant} onValueChange={(v) => patchSignin({ variant: v as ButtonVariant })}>
                <SelectTrigger className="w-[200px] h-9 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="solid">Solid</SelectItem>
                  <SelectItem value="outline">Outline</SelectItem>
                  <SelectItem value="ghost">Ghost (tekst)</SelectItem>
                  <SelectItem value="pill">Pill (zaokrąglony)</SelectItem>
                </SelectContent>
              </Select>
            </Row>
            <Row label="Sign in (PL)">
              <Input value={draft.header.signin.signin_label_pl} onChange={(e) => patchSignin({ signin_label_pl: e.target.value })} className="w-[220px] h-9 text-xs" />
            </Row>
            <Row label="Sign in (EN)">
              <Input value={draft.header.signin.signin_label_en} onChange={(e) => patchSignin({ signin_label_en: e.target.value })} className="w-[220px] h-9 text-xs" />
            </Row>
            <Row label="Sign up (PL)">
              <Input value={draft.header.signin.signup_label_pl} onChange={(e) => patchSignin({ signup_label_pl: e.target.value })} className="w-[220px] h-9 text-xs" />
            </Row>
            <Row label="Sign up (EN)">
              <Input value={draft.header.signin.signup_label_en} onChange={(e) => patchSignin({ signup_label_en: e.target.value })} className="w-[220px] h-9 text-xs" />
            </Row>
          </div>
        )}

        {active === "buttons" && (
          <div className="space-y-4">
            <div className="rounded-md border border-l-4 border-l-brand bg-brand/5 p-3 text-xs">
              Globalne ustawienia kształtu i typografii przycisków. Kolory (w tym hover) konfiguruj w <strong>Global Colors → Button</strong>.
            </div>
            <Row label="Domyślny wariant">
              <Select value={draft.buttons.default_variant} onValueChange={(v) => patchButtons({ default_variant: v as ButtonVariant })}>
                <SelectTrigger className="w-[200px] h-9 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="solid">Solid</SelectItem>
                  <SelectItem value="outline">Outline</SelectItem>
                  <SelectItem value="ghost">Ghost</SelectItem>
                  <SelectItem value="pill">Pill</SelectItem>
                </SelectContent>
              </Select>
            </Row>
            <Row label="Domyślny rozmiar">
              <Select value={draft.buttons.default_size} onValueChange={(v) => patchButtons({ default_size: v as ButtonSize })}>
                <SelectTrigger className="w-[160px] h-9 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="sm">Small</SelectItem>
                  <SelectItem value="md">Medium</SelectItem>
                  <SelectItem value="lg">Large</SelectItem>
                </SelectContent>
              </Select>
            </Row>
            <Row label="Border radius (px)" hint="0 = ostre rogi, 999 = pigułka.">
              <Input type="number" min={0} max={999} className="w-[120px] h-9 text-xs"
                value={draft.buttons.radius}
                onChange={(e) => patchButtons({ radius: Number(e.target.value) || 0 })} />
            </Row>
            <Row label="Padding poziomy (px)">
              <Input type="number" min={0} max={64} className="w-[120px] h-9 text-xs"
                value={draft.buttons.padding_x}
                onChange={(e) => patchButtons({ padding_x: Number(e.target.value) || 0 })} />
            </Row>
            <Row label="Padding pionowy (px)">
              <Input type="number" min={0} max={48} className="w-[120px] h-9 text-xs"
                value={draft.buttons.padding_y}
                onChange={(e) => patchButtons({ padding_y: Number(e.target.value) || 0 })} />
            </Row>
            <Row label="Grubość fontu" hint="400=regular, 600=semibold, 700=bold.">
              <Select value={String(draft.buttons.font_weight)} onValueChange={(v) => patchButtons({ font_weight: Number(v) })}>
                <SelectTrigger className="w-[160px] h-9 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="400">400 — Regular</SelectItem>
                  <SelectItem value="500">500 — Medium</SelectItem>
                  <SelectItem value="600">600 — Semibold</SelectItem>
                  <SelectItem value="700">700 — Bold</SelectItem>
                </SelectContent>
              </Select>
            </Row>
            <Row label="WIELKIE LITERY" hint="Wymusza uppercase na tekście przycisków.">
              <Switch checked={draft.buttons.uppercase} onCheckedChange={(v) => patchButtons({ uppercase: v })} />
            </Row>
            <Row label="Letter spacing (px)">
              <Input type="number" min={-2} max={8} step={0.1} className="w-[120px] h-9 text-xs"
                value={draft.buttons.letter_spacing}
                onChange={(e) => patchButtons({ letter_spacing: Number(e.target.value) || 0 })} />
            </Row>
            <ButtonPreview opts={draft.buttons} />
          </div>
        )}

        {active === "text_fields" && (
          <div className="space-y-4">
            <div className="rounded-md border border-l-4 border-l-brand bg-brand/5 p-3 text-xs">
              Globalne ustawienia kształtu pól tekstowych. Kolory (tło, tekst, placeholder, hover, focus) konfiguruj w <strong>Global Colors → Inputs / Text Fields</strong>.
            </div>
            <Row label="Styl pola">
              <Select value={draft.text_fields.style} onValueChange={(v) => patchInputs({ style: v as InputStyle })}>
                <SelectTrigger className="w-[200px] h-9 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="filled">Filled (z tłem)</SelectItem>
                  <SelectItem value="outline">Outline (obramowane)</SelectItem>
                  <SelectItem value="underline">Underline (tylko dolna linia)</SelectItem>
                </SelectContent>
              </Select>
            </Row>
            <Row label="Border radius (px)">
              <Input type="number" min={0} max={32} className="w-[120px] h-9 text-xs"
                value={draft.text_fields.radius}
                onChange={(e) => patchInputs({ radius: Number(e.target.value) || 0 })} />
            </Row>
            <Row label="Wysokość pola (px)">
              <Input type="number" min={28} max={72} className="w-[120px] h-9 text-xs"
                value={draft.text_fields.height}
                onChange={(e) => patchInputs({ height: Number(e.target.value) || 40 })} />
            </Row>
            <Row label="Grubość obramowania (px)">
              <Input type="number" min={0} max={4} className="w-[120px] h-9 text-xs"
                value={draft.text_fields.border_width}
                onChange={(e) => patchInputs({ border_width: Number(e.target.value) || 0 })} />
            </Row>
            <Row label="Focus ring" hint="Styl podświetlenia po fokusie.">
              <Select value={draft.text_fields.focus_ring} onValueChange={(v) => patchInputs({ focus_ring: v as FocusRing })}>
                <SelectTrigger className="w-[200px] h-9 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Brak</SelectItem>
                  <SelectItem value="brand">Brand (highlight)</SelectItem>
                  <SelectItem value="border">Border (pogrubienie)</SelectItem>
                </SelectContent>
              </Select>
            </Row>
            <Row label="Grubość ringu (px)">
              <Input type="number" min={0} max={6} className="w-[120px] h-9 text-xs"
                value={draft.text_fields.focus_ring_width}
                onChange={(e) => patchInputs({ focus_ring_width: Number(e.target.value) || 0 })} />
            </Row>
            <Row label="Pokaż label nad polem" hint="Jeśli wyłączone — label tylko jako placeholder.">
              <Switch checked={draft.text_fields.show_label_above} onCheckedChange={(v) => patchInputs({ show_label_above: v })} />
            </Row>
            <InputPreview opts={draft.text_fields} />
          </div>
        )}
        </>
        )}
      </section>
    </ThemeOptionsBody>
  );
}

function ThemeOptionsBody({
  draft,
  active,
  setActive,
  save,
  children,
}: {
  draft: ThemeOptions;
  active: string;
  setActive: (id: string) => void;
  save: ReturnType<typeof useSettings>["save"];
  children: React.ReactNode;
}) {
  void draft; void save;
  return (
    <div className="flex gap-4 min-h-[600px]">
      <aside className="w-60 shrink-0 border border-border rounded-lg bg-card p-2 self-start">
        <div className="px-2 pb-2 pt-1 text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
          Opcje motywu
        </div>
        <nav className="space-y-0.5">
          {SECTIONS.map((s) => {
            const Icon = s.icon;
            const isActive = active === s.id;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => setActive(s.id)}
                className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm text-left border-l-2 transition ${
                  isActive
                    ? "border-brand bg-brand/10 text-brand font-medium"
                    : "border-transparent hover:bg-muted text-foreground"
                }`}
              >
                {Icon && <Icon className="w-4 h-4 shrink-0" />}
                <span className="flex-1 truncate">{s.label}</span>
                {isActive && <ChevronRight className="w-3 h-3" />}
              </button>
            );
          })}
        </nav>
      </aside>
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}


function LogoTabs({ value, onChange }: { value: string; onChange: (v: "default" | "mobile" | "transparent" | "organization" | "sidebar" | "bookmark") => void }) {
  const tabs: { id: "default" | "mobile" | "transparent" | "organization" | "sidebar" | "bookmark"; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
    { id: "default", label: "Default Logos", icon: ImageIcon },
    { id: "mobile", label: "Mobile Logos", icon: Smartphone },
    { id: "transparent", label: "Transparent", icon: Eye },
    { id: "organization", label: "Organization", icon: Star },
    { id: "sidebar", label: "Sidebar", icon: LayoutDashboard },
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
    <div className="rounded-md text-white text-xs font-semibold px-3 py-2" style={{ background: "#FA9346" }}>
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

type LogoState = ThemeOptions["logo"];

const LOGO_LOCATIONS: Record<string, { title: string; locations: string[] }> = {
  default: {
    title: "Main Logo",
    locations: [
      "Nagłówek strony (desktop) — lewy/centralny slot",
      "Strona logowania i rejestracji",
      "Stopka (jeśli nie ustawiono osobnego footer logo)",
      "Meta tagi Open Graph (fallback)",
    ],
  },
  mobile: {
    title: "Mobile Logo",
    locations: [
      "Nagłówek na urządzeniach mobilnych (< 1024px)",
      "Wymaga włączonej opcji „Użyj Mobile Logo” w sekcji Mobile Header",
    ],
  },
  transparent: {
    title: "Transparent Logo",
    locations: [
      "Nagłówki z przezroczystym tłem (np. hero pełnoekranowe)",
      "Sekcje z tłem dark accent / obrazem",
    ],
  },
  organization: {
    title: "Organization Logo",
    locations: [
      "Schema.org / JSON-LD (Organization)",
      "Podgląd linków w social media (gdy brak Open Graph image)",
      "Wyniki wyszukiwania Google",
    ],
  },
  bookmark: {
    title: "Bookmark / Touch Icons",
    locations: [
      "Ikona „Dodaj do ekranu głównego” w iOS",
      "Kafelek Windows Metro",
      "Favicon na pulpitach mobilnych",
    ],
  },
  sidebar: {
    title: "Sidebar Logo",
    locations: [
      "Panel boczny — wariant zwinięty (kwadratowa ikona)",
      "Panel boczny — wariant rozwinięty (podłużne logo)",
      "Automatyczna zmiana przy collapse / expand sidebaru",
    ],
  },
};

function LogoPreview({ logo, tab }: { logo: LogoState; tab: string }) {
  const meta = LOGO_LOCATIONS[tab] ?? LOGO_LOCATIONS.default;
  const pick = (light: string | undefined, dark: string | undefined): { l: string; d: string } => {
    const l = light || dark || "";
    const d = dark || light || "";
    return { l, d };
  };
  const sources = (() => {
    if (tab === "mobile") return pick(logo.mobile, logo.mobile_dark);
    if (tab === "transparent") return { l: logo.transparent || logo.main || "", d: logo.transparent_dark || logo.transparent || logo.main_dark || logo.main || "" };
    if (tab === "organization") return { l: logo.organization || logo.main || "", d: logo.organization_dark || logo.organization || logo.main_dark || logo.main || "" };
    if (tab === "sidebar") return { l: logo.sidebar_expanded || logo.main || "", d: logo.sidebar_expanded_dark || logo.sidebar_expanded || logo.main_dark || logo.main || "" };
    if (tab === "bookmark") return { l: logo.bookmark_ios || "", d: logo.bookmark_ios_dark || logo.bookmark_ios || "" };
    return pick(logo.main, logo.main_dark);
  })();

  const Panel = ({ mode, src }: { mode: "light" | "dark"; src: string }) => {
    const isDark = mode === "dark";
    const { theme, toggle } = useTheme();
    const active = (theme === "dark") === isDark;
    return (
      <div
        className="rounded-md border p-4 flex flex-col gap-2 min-h-[110px] transition-all"
        style={{
          background: isDark ? "#01112F" : "#F8F6F4",
          borderColor: active ? "#FA9346" : (isDark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.08)"),
          color: isDark ? "#e5e7eb" : "#1f2937",
          boxShadow: active ? "0 0 0 2px rgba(250,147,70,0.25)" : undefined,
        }}
      >
        <div className="flex items-center justify-between">
          <span className="text-[9px] uppercase tracking-widest" style={{ opacity: 0.6 }}>
            {isDark ? "Dark mode" : "Light mode"}{active ? " • aktywny" : ""}
          </span>
          <button
            type="button"
            onClick={() => { if (!active) toggle(); }}
            title={active ? "Aktywny motyw" : `Przełącz na ${isDark ? "dark" : "light"} mode`}
            aria-pressed={active}
            className="group relative w-9 h-9 rounded-full flex items-center justify-center transition-transform hover:scale-110 active:scale-95"
            style={{
              background: isDark
                ? "radial-gradient(circle at 30% 30%, #1e293b 0%, #0b1228 70%)"
                : "radial-gradient(circle at 30% 30%, #fff7e0 0%, #ffd27a 70%)",
              boxShadow: isDark
                ? "inset 0 0 8px rgba(255,255,255,0.08), 0 0 12px rgba(120,150,255,0.25)"
                : "inset 0 0 8px rgba(255,180,60,0.4), 0 0 14px rgba(250,180,70,0.5)",
              border: `1px solid ${isDark ? "rgba(255,255,255,0.15)" : "rgba(250,147,70,0.4)"}`,
            }}
          >
            {isDark ? (
              <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none">
                <path d="M20 14.5A8 8 0 0 1 9.5 4a1 1 0 0 0-1.3-1.2A9.5 9.5 0 1 0 21.2 15.8a1 1 0 0 0-1.2-1.3Z" fill="#e2e8f0" />
                <circle cx="16" cy="6" r="0.8" fill="#fff" />
                <circle cx="19" cy="9" r="0.5" fill="#fff" />
                <circle cx="14" cy="3.5" r="0.4" fill="#fff" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none">
                <circle cx="12" cy="12" r="4" fill="#FA9346" />
                <g stroke="#FA9346" strokeWidth="1.8" strokeLinecap="round">
                  <line x1="12" y1="2.5" x2="12" y2="5" />
                  <line x1="12" y1="19" x2="12" y2="21.5" />
                  <line x1="2.5" y1="12" x2="5" y2="12" />
                  <line x1="19" y1="12" x2="21.5" y2="12" />
                  <line x1="5.2" y1="5.2" x2="6.9" y2="6.9" />
                  <line x1="17.1" y1="17.1" x2="18.8" y2="18.8" />
                  <line x1="5.2" y1="18.8" x2="6.9" y2="17.1" />
                  <line x1="17.1" y1="6.9" x2="18.8" y2="5.2" />
                </g>
              </svg>
            )}
          </button>
        </div>
        <div className="flex-1 flex items-center justify-center">
          {src ? (
            <img
              src={src}
              alt={`${meta.title} ${mode}`}
              className="max-h-14 max-w-full object-contain"
              style={tab === "bookmark" ? { borderRadius: 8 } : undefined}
            />
          ) : (
            <span className="text-[11px]" style={{ opacity: 0.5 }}>brak grafiki</span>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="rounded-lg border border-border bg-card/40 overflow-hidden">
      <div className="rounded-t-lg text-white text-xs font-semibold px-3 py-2" style={{ background: "#FA9346" }}>
        Podgląd: {meta.title}
      </div>
      <div className="p-3 space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <Panel mode="light" src={sources.l} />
          <Panel mode="dark" src={sources.d} />
        </div>
        <div className="rounded-md bg-muted/50 p-2.5">
          <div className="text-[10px] uppercase tracking-wider font-bold text-muted-foreground mb-1.5">
            Gdzie wykorzystywane
          </div>
          <ul className="text-[11px] space-y-0.5 text-foreground/80">
            {meta.locations.map((l) => (
              <li key={l} className="flex gap-1.5">
                <span className="text-brand">•</span>
                <span>{l}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
