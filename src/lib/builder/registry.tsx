// Widget registry - defaults + renderer. Used both inside the canvas and on
// the public site.
import type { WidgetNode, WidgetType } from "./types";
import { newId } from "./types";
import {
  Heading1, Type as TypeIcon, Image as ImageIcon, MousePointerClick,
  Minus, MoveVertical, Video, GalleryHorizontal, Star, MapPin,
  Newspaper, Rows, FolderTree, Tags, Mail, Send, Megaphone,
  List, PanelLeft, Quote, Check, Link as LinkIcon,
  Globe, Sun, Search, User, Facebook,
  Flame, Bookmark, Megaphone as AdIcon,
  LayoutGrid,
} from "@/lib/lucide-shim";
import type { LucideIcon } from "@/lib/lucide-shim";

export interface WidgetDef {
  type: WidgetType;
  label: string;
  category: "basic" | "media" | "dynamic" | "form" | "navigation" | "blocks";
  icon: LucideIcon;
  defaults: () => WidgetNode["content"];
}

export const WIDGETS: WidgetDef[] = [
  // Basic
  { type: "heading", label: "Nagłówek", category: "basic", icon: Heading1,
    defaults: () => ({ text_pl: "Nowy nagłówek", text_en: "New heading", tag: "h2" }) },
  { type: "animated-heading", label: "Animowany nagłówek", category: "basic", icon: Heading1,
    defaults: () => ({
      mode: "highlight",
      shape: "underline",
      tag: "h2",
      align: "left",
      textBefore_pl: "Dołącz",     textBefore_en: "Join",
      highlight_pl: "do nas",      highlight_en: "us",
      textAfter_pl: "",            textAfter_en: "",
      rotateWords_pl: ["szybko", "łatwo", "skutecznie"],
      rotateWords_en: ["fast", "easy", "effective"],
      color: "",
      accentColor: "#f97316",
      durationMs: 1600,
      delayMs: 200,
      loop: true,
    }) },
  { type: "text", label: "Tekst", category: "basic", icon: TypeIcon,
    defaults: () => ({ html_pl: "<p>Wpisz treść...</p>", html_en: "<p>Type content...</p>" }) },
  { type: "image", label: "Obrazek", category: "basic", icon: ImageIcon,
    defaults: () => ({ src: "", alt_pl: "", alt_en: "" }) },
  { type: "button", label: "Przycisk", category: "basic", icon: MousePointerClick,
    defaults: () => ({ label_pl: "Przycisk", label_en: "Button", href: "#", variant: "primary" }) },
  { type: "divider", label: "Rozdzielacz", category: "basic", icon: Minus, defaults: () => ({}) },
  { type: "spacer", label: "Odstępnik", category: "basic", icon: MoveVertical,
    defaults: () => ({ height: 32 }) },
  // Media
  { type: "video", label: "Wideo", category: "media", icon: Video,
    defaults: () => ({ url: "" }) },
  { type: "gallery", label: "Galeria", category: "media", icon: GalleryHorizontal,
    defaults: () => ({ images: [] as string[], columns: 3 }) },
  { type: "icon", label: "Ikonka", category: "media", icon: Star,
    defaults: () => ({ name: "Star", size: 32 }) },
  { type: "map", label: "Mapa Google", category: "media", icon: MapPin,
    defaults: () => ({ query: "Warszawa" }) },
  { type: "tts", label: "Odsłuchaj (TTS)", category: "media", icon: Megaphone,
    defaults: () => ({
      source: "post",
      text_pl: "",
      text_en: "",
      voiceId: "JBFqnCBsd6RMkjVDRZzb",
      model: "eleven_multilingual_v2",
      label_pl: "Odsłuchaj artykuł",
      label_en: "Listen to article",
    }) },
  // Dynamic
  { type: "post-list", label: "Lista wpisów", category: "dynamic", icon: Newspaper,
    defaults: () => ({ limit: 6, columns: 3, category: null as string | null }) },
  { type: "carousel", label: "Karuzela wpisów", category: "dynamic", icon: Rows,
    defaults: () => ({ limit: 8, category: null as string | null }) },
  { type: "categories", label: "Kategorie", category: "dynamic", icon: FolderTree, defaults: () => ({}) },
  { type: "tags", label: "Tagi", category: "dynamic", icon: Tags, defaults: () => ({}) },
  // Forms
  { type: "newsletter", label: "Newsletter", category: "form", icon: Mail,
    defaults: () => ({ title_pl: "Zapisz się", title_en: "Subscribe" }) },
  { type: "contact", label: "Formularz kontaktowy", category: "form", icon: Send,
    defaults: () => ({ to: "" }) },
  { type: "cta", label: "Wezwanie do akcji", category: "form", icon: Megaphone,
    defaults: () => ({ title_pl: "Działajmy razem", title_en: "Let's act together", href: "#", cta_pl: "Skontaktuj się", cta_en: "Contact us" }) },
  // Navigation
  { type: "nav-link", label: "Link menu", category: "navigation", icon: LinkIcon,
    defaults: () => ({
      label_pl: "Nowy link", label_en: "New link",
      href: "/", target: "self",
      variant: "text",
    }) },
  { type: "mega-menu", label: "Mega menu", category: "navigation", icon: LayoutGrid,
    defaults: () => ({
      trigger_pl: "Produkty", trigger_en: "Products",
      href: "",
      triggerOn: "hover",
      width: "container",
      widthPx: 1140,
      columns: [
        {
          title_pl: "Kategorie", title_en: "Categories",
          links: [
            { label_pl: "Analizy", label_en: "Analyses", href: "#" },
            { label_pl: "Wywiady", label_en: "Interviews", href: "#" },
          ],
          featured: null,
        },
        {
          title_pl: "Zasoby", title_en: "Resources",
          links: [
            { label_pl: "Raporty", label_en: "Reports", href: "#" },
            { label_pl: "Newsletter", label_en: "Newsletter", href: "#" },
          ],
          featured: null,
        },
        {
          title_pl: "Wyróżnione", title_en: "Featured",
          links: [],
          featured: {
            image: "",
            title_pl: "Najnowszy raport",
            title_en: "Latest report",
            excerpt_pl: "Krótki opis wyróżnionej treści.",
            excerpt_en: "Short summary of featured content.",
            href: "#",
            cta_pl: "Czytaj", cta_en: "Read",
          },
        },
      ],
    }) },
  // Site chrome (header / footer / menu)
  { type: "social-icons", label: "Ikony social", category: "navigation", icon: Facebook,
    defaults: () => ({
      facebook: "", twitter: "", youtube: "", instagram: "", linkedin: "", email: "",
      size: 16,
    }) },
  { type: "lang-switcher", label: "Język (PL/EN)", category: "navigation", icon: Globe,
    defaults: () => ({ showLabel: true, label_pl: "Zmień język", label_en: "Switch language" }) },
  { type: "theme-toggle", label: "Tryb jasny/ciemny", category: "navigation", icon: Sun,
    defaults: () => ({}) },
  { type: "account-link", label: "Konto / Logowanie", category: "navigation", icon: User,
    defaults: () => ({
      signin_pl: "Zaloguj", signin_en: "Sign in",
      signup_pl: "Zarejestruj", signup_en: "Sign up",
      panel_pl: "Panel", panel_en: "Dashboard",
    }) },
  { type: "search-button", label: "Wyszukiwarka", category: "navigation", icon: Search,
    defaults: () => ({ label_pl: "Szukaj", label_en: "Search" }) },
  { type: "copyright", label: "Copyright", category: "navigation", icon: TypeIcon,
    defaults: () => ({
      text_pl: "Wszelkie prawa zastrzeżone",
      text_en: "All rights reserved",
      showYear: true,
      brand: "New European Strategies",
    }) },
  // Rich blocks
  { type: "accordion", label: "Accordion", category: "blocks", icon: List,
    defaults: () => ({
      items: [
        { q_pl: "Pytanie 1", q_en: "Question 1", a_pl: "Odpowiedź…", a_en: "Answer…" },
        { q_pl: "Pytanie 2", q_en: "Question 2", a_pl: "Odpowiedź…", a_en: "Answer…" },
      ],
    }) },
  { type: "tabs", label: "Zakładki", category: "blocks", icon: PanelLeft,
    defaults: () => ({
      tabs: [
        { label_pl: "Tab 1", label_en: "Tab 1", html_pl: "<p>Treść 1</p>", html_en: "<p>Content 1</p>" },
        { label_pl: "Tab 2", label_en: "Tab 2", html_pl: "<p>Treść 2</p>", html_en: "<p>Content 2</p>" },
      ],
    }) },
  { type: "testimonial", label: "Opinia / Cytat", category: "blocks", icon: Quote,
    defaults: () => ({
      quote_pl: "To rozwiązanie zmieniło sposób, w jaki pracujemy.",
      quote_en: "This product changed the way we work.",
      author: "Anna Kowalska",
      role_pl: "CEO, ACME",
      role_en: "CEO, ACME",
      avatar: "",
    }) },
  { type: "pricing", label: "Cennik", category: "blocks", icon: Check,
    defaults: () => ({
      plans: [
        {
          name_pl: "Start", name_en: "Starter", price: "0", currency: "PLN", period_pl: "/mies.", period_en: "/mo",
          features_pl: ["1 użytkownik", "Podstawowe funkcje"], features_en: ["1 user", "Core features"],
          cta_pl: "Wybierz", cta_en: "Choose", href: "#", featured: false,
        },
        {
          name_pl: "Pro", name_en: "Pro", price: "49", currency: "PLN", period_pl: "/mies.", period_en: "/mo",
          features_pl: ["Wszystko ze Start", "Wsparcie 24/7"], features_en: ["Everything in Starter", "24/7 support"],
          cta_pl: "Wybierz", cta_en: "Choose", href: "#", featured: true,
        },
      ],
    }) },
  // Home-page building blocks
  { type: "section-label", label: "Etykieta sekcji", category: "basic", icon: Bookmark,
    defaults: () => ({
      label_pl: "Najnowsze", label_en: "Latest",
      color: "brand",
      action_pl: "więcej", action_en: "more",
      href: "",
    }) },
  { type: "hot-topic-bar", label: "Pasek hot topic", category: "blocks", icon: Flame,
    defaults: () => ({
      badge_pl: "Hot topic", badge_en: "Hot topic",
      title_pl: "Najważniejszy temat dnia", title_en: "Today's top story",
      href: "",
      iconName: "Flame",
    }) },
  { type: "rated-list", label: "Lista z oceną", category: "blocks", icon: Star,
    defaults: () => ({
      items: [
        { title_pl: "Pierwszy temat", title_en: "First topic", excerpt_pl: "", excerpt_en: "", author: "", rating: 8.3 },
        { title_pl: "Drugi temat",   title_en: "Second topic", excerpt_pl: "", excerpt_en: "", author: "", rating: 0 },
        { title_pl: "Trzeci temat",  title_en: "Third topic",  excerpt_pl: "", excerpt_en: "", author: "", rating: 0 },
      ],
    }) },
  { type: "dark-featured-card", label: "Karta wyróżniona (dark)", category: "blocks", icon: Newspaper,
    defaults: () => ({
      badge_pl: "WYRÓŻNIONE", badge_en: "FEATURED",
      title_pl: "Tytuł wyróżnionego artykułu", title_en: "Featured article title",
      excerpt_pl: "", excerpt_en: "",
      image: "",
      href: "",
    }) },
  { type: "slider", label: "Slider", category: "media", icon: GalleryHorizontal,
    defaults: () => ({
      variant: "classic",
      ratio: "16/9",
      autoplay: true,
      intervalMs: 4500,
      rounded: "md",
      overlayOpacity: 0.45,
      items: [
        { image: "", title_pl: "Pierwszy slajd", title_en: "First slide", subtitle_pl: "", subtitle_en: "", href: "", cta_pl: "", cta_en: "" },
        { image: "", title_pl: "Drugi slajd",   title_en: "Second slide", subtitle_pl: "", subtitle_en: "", href: "", cta_pl: "", cta_en: "" },
      ],
    }) },
  // Advertising
  { type: "ad-slot", label: "Slot reklamowy", category: "blocks", icon: AdIcon,
    defaults: () => ({ slotId: "" }) },
  // News ticker (horizontal scrolling latest posts)
  { type: "news-ticker", label: "News ticker", category: "dynamic", icon: Flame,
    defaults: () => ({
      badge_pl: "Najnowsze", badge_en: "Latest",
      limit: 10,
      speedSeconds: 40,
      pauseOnHover: true,
      separator: "•",
      categoriesCsv: "",
      uniqueOnPage: false,
    }) },
];

export const WIDGET_MAP: Record<WidgetType, WidgetDef> = WIDGETS.reduce(
  (acc, w) => { acc[w.type] = w; return acc; },
  {} as Record<WidgetType, WidgetDef>,
);

export const makeWidget = (type: WidgetType): WidgetNode => ({
  id: newId(),
  kind: "widget",
  type,
  content: WIDGET_MAP[type].defaults(),
});
