// ATOM: pojedynczy węzeł ścieżki kontaktu („Ty", most, osoba docelowa).
//
// Trzy warianty niosą trzy różne stany wiedzy, a nie trzy style:
//   you    - punkt startu (Ty),
//   person - osoba, którą WOLNO nazwać (mój kontakt z opt-inem discoverable
//            albo osoba, której profil i tak właśnie oglądam),
//   hidden - węzeł istniejący, ale nieujawniany (środek ścieżki 3. stopnia).
// Ostatni wariant jest sednem prywatności tej funkcji: pokazujemy, że droga
// istnieje, nie czyjąś listę znajomych.
import { Link } from "@tanstack/react-router";
import { MoreHorizontal, User } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

export type PathNodeVariant = "you" | "person" | "hidden";

export interface PathNodeProps {
  variant: PathNodeVariant;
  /** Widoczna etykieta; dla `hidden` służy tylko czytnikowi ekranu. */
  label: string;
  avatarUrl?: string | null;
  /** Slug profilu - węzeł staje się linkiem tylko wtedy, gdy jest dokąd iść. */
  slug?: string | null;
  /** Ścieżka z awatarami (`full`) albo sama typografia (`compact`). */
  density?: "full" | "compact";
  className?: string;
}

function NodeMark({
  variant,
  label,
  avatarUrl,
}: Pick<PathNodeProps, "variant" | "label" | "avatarUrl">) {
  if (variant === "hidden") {
    return (
      <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-[6px] border border-dashed border-border bg-muted/40 text-muted-foreground">
        <MoreHorizontal className="h-3 w-3" aria-hidden />
      </span>
    );
  }
  if (variant === "you") {
    return (
      <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-[6px] bg-[var(--brand)]/15 text-[var(--brand)]">
        <User className="h-3 w-3" aria-hidden />
      </span>
    );
  }
  const initial = (label || "?").trim().slice(0, 1).toUpperCase();
  return (
    <Avatar className="h-5 w-5 shrink-0 rounded-[6px] text-[9px]">
      {avatarUrl ? (
        <AvatarImage src={avatarUrl} alt="" className="rounded-[6px] object-cover" />
      ) : null}
      <AvatarFallback className="rounded-[6px] font-medium">{initial}</AvatarFallback>
    </Avatar>
  );
}

export function PathNode({
  variant,
  label,
  avatarUrl,
  slug,
  density = "compact",
  className,
}: PathNodeProps) {
  const body = (
    <>
      {density === "full" && <NodeMark variant={variant} label={label} avatarUrl={avatarUrl} />}
      {variant === "hidden" ? (
        <>
          {/* W gęstej wersji rolę znacznika gra sama typografia - kropki. */}
          {density === "compact" && <span aria-hidden="true">…</span>}
          <span className="sr-only">{label}</span>
        </>
      ) : (
        <span className="truncate">{label}</span>
      )}
    </>
  );

  const base = cn(
    "inline-flex min-w-0 max-w-[12rem] items-center gap-1",
    variant === "hidden" && "text-muted-foreground/70",
    variant === "you" && "font-medium text-foreground",
    className,
  );

  if (variant === "person" && slug) {
    return (
      <Link
        to="/author/$slug"
        params={{ slug }}
        className={cn(
          base,
          "rounded-[4px] font-medium text-foreground underline-offset-2 transition-colors hover:text-[var(--brand)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        )}
      >
        {body}
      </Link>
    );
  }

  return <span className={base}>{body}</span>;
}
