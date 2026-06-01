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
import { Sun, Moon, Save, Image as ImageIcon, Smartphone, Eye, Star, Globe, Menu, Search, ChevronRight, Megaphone, LayoutDashboard, Users, LogIn, Layers } from "@/lib/lucide-shim";
import { GlobalColorsEditor } from "@/components/admin/GlobalColorsEditor";


// ---------- Defaults ----------
type HoverEffect = "color-border" | "underline" | "background" | "scale" | "none";
type SearchMode = "standalone" | "dropdown" | "fullscreen";
type AlertStyle = "info" | "warning" | "success" | "brand";
type HeaderLayout = "layout-1" | "layout-2" | "layout-3" | "layout-4" | "layout-5";
type SocialPlacement = "topbar" | "navbar" | "both" | "hidden";
type ButtonVariant = "solid" | "outline" | "ghost" | "pill";

interface ThemeOptions extends Record<string, unknown> {
  logo: {
    main: string; main_dark: string;
    mobile: string; mobile_dark: string;
    transparent: string; organization: string;
    bookmark_ios: string; bookmark_windows: string;
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
}

const DEFAULTS: ThemeOptions = {
  logo: { main: "", main_dark: "", mobile: "", mobile_dark: "", transparent: "", organization: "", bookmark_ios: "", bookmark_windows: "", add_to_home_screen: true },
  header: {
    layout: "layout-1",
    main_menu: { hover_effect: "color-border", sticky: true, smart_sticky: false, glass_effect: false, item_spacing: 12, icon_spacing: 5, submenu_bg_from: "", submenu_bg_to: "" },
    search: { enabled: true, heading: "Search", mode: "standalone", live_results: true, live_limit: 5, more_menu_search: true },
    alert_bar: { enabled: false, message_pl: "", message_en: "", link_url: "", style: "brand", dismissible: true },
    mobile: { breakpoint: 1024, use_mobile_logo: true, sticky: true, show_search: true },
    socials: { placement: "topbar", facebook: "", twitter: "", instagram: "", linkedin: "", youtube: "", email: "", size: 16 },
    signin: { enabled: true, signin_label_pl: "Zaloguj", signin_label_en: "Sign in", signup_label_pl: "Zarejestruj", signup_label_en: "Sign up", variant: "ghost", show_signup: true },
  },
};

const SECTIONS = [
  { id: "logo", label: "Logo", icon: ImageIcon },
  { id: "header.layout", label: "Header Layout", icon: Layers },
  { id: "header.main_menu", label: "Main Menu", icon: Menu },
  { id: "header.search", label: "Header Search", icon: Search },
  { id: "header.alert_bar", label: "Alert Bar", icon: Megaphone },
  { id: "header.socials", label: "Social Icons", icon: Users },
  { id: "header.signin", label: "Sign In Buttons", icon: LogIn },
  { id: "header.mobile", label: "Mobile Header", icon: LayoutDashboard },
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
  const [logoTab, setLogoTab] = useState<"default" | "mobile" | "transparent" | "organization" | "bookmark">("default");

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

  return (
    <ThemeOptionsBody
      draft={draft}
      active={active}
      setActive={(id) => setActive(id as typeof active)}
      save={save}
    >
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
