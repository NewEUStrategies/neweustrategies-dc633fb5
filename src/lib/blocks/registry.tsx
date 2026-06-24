// Rejestr bloków block editora. MVP: 5 bloków core.
// Pozostałe 10 wpisuje się analogicznie w kolejnych etapach.

import type { Block, BlockType } from "./types";
import { newBlockId } from "./types";
import {
  Type,
  Heading1 as HeadingIcon,
  Image as ImageIcon,
  List as ListIcon,
  Quote as QuoteIcon,
  Code2 as CodeIcon,
  Video as VideoIcon,
  Minus,
  AlertTriangle as AlertCircle,
  Table2 as TableIcon,
  MousePointerClick as MousePointer2,
  Columns2 as ColumnsIcon,
  FileCode2 as FileCode,
  PlaySquare,
  Images,
  Radio as RadioIcon,
  type LucideIcon,
} from "lucide-react";

export interface BlockSpec {
  type: BlockType;
  label: string;
  description: string;
  icon: LucideIcon;
  category: "text" | "media" | "layout" | "advanced";
  /** Tworzy domyślną instancję bloku. */
  create: () => Block;
}

export const BLOCK_SPECS: Record<BlockType, BlockSpec> = {
  paragraph: {
    type: "paragraph",
    label: "Akapit",
    description: "Tekst z formatowaniem inline.",
    icon: Type,
    category: "text",
    create: () => ({ id: newBlockId(), type: "paragraph", data: { html: "" } }),
  },
  heading: {
    type: "heading",
    label: "Nagłówek",
    description: "H2, H3 lub H4 z opcjonalnym anchorem.",
    icon: HeadingIcon,
    category: "text",
    create: () => ({ id: newBlockId(), type: "heading", data: { level: 2, text: "", anchor: "" } }),
  },
  image: {
    type: "image",
    label: "Obraz",
    description: "Pojedynczy obraz z podpisem.",
    icon: ImageIcon,
    category: "media",
    create: () => ({ id: newBlockId(), type: "image", data: { url: "", alt: "", caption: "", href: "" } }),
  },
  list: {
    type: "list",
    label: "Lista",
    description: "Lista numerowana lub punktowana.",
    icon: ListIcon,
    category: "text",
    create: () => ({ id: newBlockId(), type: "list", data: { ordered: false, items: [""] } }),
  },
  quote: {
    type: "quote",
    label: "Cytat",
    description: "Wyróżniony cytat z opcjonalnym autorem.",
    icon: QuoteIcon,
    category: "text",
    create: () => ({ id: newBlockId(), type: "quote", data: { text: "", cite: "" } }),
  },
  // Stuby — pełne implementacje w kolejnym etapie. Tworzenie blokuje fallback.
  code: {
    type: "code",
    label: "Kod",
    description: "Blok kodu z podświetlaniem.",
    icon: CodeIcon,
    category: "advanced",
    create: () => ({ id: newBlockId(), type: "code", data: { lang: "ts", code: "" } }),
  },
  embed: {
    type: "embed",
    label: "Embed",
    description: "YouTube, Vimeo, X — z URL.",
    icon: PlaySquare,
    category: "media",
    create: () => ({ id: newBlockId(), type: "embed", data: { url: "" } }),
  },
  video: {
    type: "video",
    label: "Wideo",
    description: "Plik wideo lub URL.",
    icon: VideoIcon,
    category: "media",
    create: () => ({ id: newBlockId(), type: "video", data: { url: "", poster: "" } }),
  },
  gallery: {
    type: "gallery",
    label: "Galeria",
    description: "Siatka obrazów.",
    icon: Images,
    category: "media",
    create: () => ({ id: newBlockId(), type: "gallery", data: { images: [] } }),
  },
  separator: {
    type: "separator",
    label: "Separator",
    description: "Linia rozdzielająca.",
    icon: Minus,
    category: "layout",
    create: () => ({ id: newBlockId(), type: "separator", data: { variant: "line" } }),
  },
  callout: {
    type: "callout",
    label: "Callout",
    description: "Info / warning / success / danger.",
    icon: AlertCircle,
    category: "text",
    create: () => ({ id: newBlockId(), type: "callout", data: { variant: "info", text: "" } }),
  },
  table: {
    type: "table",
    label: "Tabela",
    description: "Wiersze i kolumny.",
    icon: TableIcon,
    category: "advanced",
    create: () => ({ id: newBlockId(), type: "table", data: { rows: [[""]], header: false } }),
  },
  button: {
    type: "button",
    label: "Przycisk",
    description: "Etykieta + link.",
    icon: MousePointer2,
    category: "layout",
    create: () => ({ id: newBlockId(), type: "button", data: { label: "Kliknij", href: "#", variant: "default" } }),
  },
  columns: {
    type: "columns",
    label: "Kolumny",
    description: "Dwie kolumny z blokami.",
    icon: ColumnsIcon,
    category: "layout",
    create: () => ({ id: newBlockId(), type: "columns", data: { left: [], right: [] } }),
  },
  html: {
    type: "html",
    label: "HTML",
    description: "Surowy HTML (sanitizowany).",
    icon: FileCode,
    category: "advanced",
    create: () => ({ id: newBlockId(), type: "html", data: { html: "" } }),
  },
};

export const BLOCK_LIST: BlockSpec[] = Object.values(BLOCK_SPECS);

/** Bloki, które mają już dedykowany edytor i renderer. */
export const IMPLEMENTED_BLOCKS: BlockType[] = [
  "paragraph",
  "heading",
  "image",
  "list",
  "quote",
  "code",
  "embed",
  "video",
  "gallery",
  "separator",
  "callout",
  "table",
  "button",
  "columns",
  "html",
];
