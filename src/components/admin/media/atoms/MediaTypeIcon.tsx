import { Film, Mic, FileText, BookOpen, Image } from "@/lib/lucide-shim";
import { cn } from "@/lib/utils";
import type { MediaCategory } from "../lib/mediaKind";

interface MediaTypeIconProps {
  category: MediaCategory;
  className?: string;
}

/**
 * Atom: the glyph representing a non-image asset's type. Images fall through to
 * the {@link Image} icon; unknown types render a neutral document emoji so the
 * grid never shows a blank tile.
 */
export function MediaTypeIcon({ category, className }: MediaTypeIconProps) {
  const cls = cn("w-10 h-10", className);
  switch (category) {
    case "video":
      return <Film className={cls} aria-hidden />;
    case "audio":
      return <Mic className={cls} aria-hidden />;
    case "pdf":
    case "document":
      return <FileText className={cls} aria-hidden />;
    case "ebook":
      return <BookOpen className={cls} aria-hidden />;
    case "image":
      return <Image className={cls} aria-hidden />;
    default:
      return (
        <span className="text-2xl" aria-hidden>
          📄
        </span>
      );
  }
}
