import { Clock, User } from "@/lib/lucide-shim";
import { CategoryTag } from "./CategoryTag";

type Props = {
  image?: string;
  category?: { label: string; color?: "military" | "finance" | "diplomacy" | "cyber" | "brand" | "neutral" };
  title: string;
  excerpt?: string;
  author?: string;
  readTime?: string;
  size?: "sm" | "md" | "lg";
  rating?: number;
  horizontal?: boolean;
};

export function ArticleCard({
  image,
  category,
  title,
  excerpt,
  author,
  readTime,
  size = "md",
  rating,
  horizontal = false,
}: Props) {
  const titleClass =
    size === "lg" ? "text-2xl md:text-3xl" : size === "sm" ? "text-base" : "text-xl";

  return (
    <article className={`group ${horizontal ? "flex gap-4" : ""}`}>
      {image && (
        <div className={`relative overflow-hidden ${horizontal ? "w-32 h-24 shrink-0" : "aspect-[16/10] mb-4"}`}>
          <img
            src={image}
            alt={title}
            loading="lazy"
            className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
          />
          {category && !horizontal && (
            <div className="absolute bottom-0 left-0">
              <CategoryTag label={category.label} color={category.color} />
            </div>
          )}
        </div>
      )}
      <div className={horizontal ? "flex-1" : ""}>
        {category && horizontal && (
          <div className="mb-2"><CategoryTag label={category.label} color={category.color} /></div>
        )}
        <h3 className={`${titleClass} font-bold leading-tight group-hover:text-brand transition-colors`}>
          {title}
        </h3>
        {excerpt && (
          <p className="text-sm text-muted-foreground mt-3 leading-relaxed line-clamp-3">{excerpt}</p>
        )}
        {rating !== undefined && (
          <div className="mt-3 flex items-center gap-2">
            <div className="flex h-2 w-32 overflow-hidden rounded-full">
              {[0,1,2,3,4].map((i) => (
                <div key={i} className="flex-1" style={{
                  backgroundColor: ["#ef4444","#f97316","#facc15","#a3e635","#22c55e"][i]
                }} />
              ))}
            </div>
            <span className="text-xs font-semibold">{rating} <span className="text-muted-foreground">/ 10</span></span>
          </div>
        )}
        {(author || readTime) && (
          <div className="mt-3 flex items-center gap-4 text-xs text-muted-foreground">
            {author && <span className="flex items-center gap-1.5"><User className="w-3 h-3" /> {author}</span>}
            {readTime && <span className="flex items-center gap-1.5"><Clock className="w-3 h-3" /> {readTime}</span>}
          </div>
        )}
      </div>
    </article>
  );
}
