// Widget registry - defaults + renderer. Used both inside the canvas and on
// the public site.
import type { WidgetNode, WidgetType } from "./types";
import { newId } from "./types";
import {
  Heading1, Type as TypeIcon, Image as ImageIcon, MousePointerClick,
  Minus, MoveVertical, Video, GalleryHorizontal, Star, MapPin,
  Newspaper, Rows, FolderTree, Tags, Mail, Send, Megaphone,
  List, PanelLeft, Quote, Check, Link as LinkIcon,
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
