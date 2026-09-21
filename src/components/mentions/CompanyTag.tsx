// Firma jako tag z dymkiem - przy nazwisku autora i w wizytówce osoby.
//
// FIRMA JEST OPCJONALNA I NIE ZOSTAWIA PUSTEGO MIEJSCA. Komponent renderuje się
// tylko wtedy, gdy nazwa firmy w ogóle jest; wywołujący nie musi pamiętać o
// separatorze, bo separator należy do tego komponentu i znika razem z nim.
//
// Dymek dociąga markę leniwie (`useCompanyBrand`), a gdy kartoteka nie zna tej
// nazwy - pokazuje samą nazwę. Nazwa firmy z profilu jest snapshotem tekstowym,
// więc „nie znaleziono marki" to normalny stan, nie awaria.
import { useState } from "react";
import { Building2, ExternalLink } from "lucide-react";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { Skeleton } from "@/components/ui/skeleton";
import { useCompanyBrand } from "@/lib/mentions/useCompanyBrand";
import { cn } from "@/lib/utils";

export interface CompanyTagLabels {
  /** Etykieta odnośnika do strony firmy. */
  website: string;
}

export function CompanyTag({
  name,
  labels,
  className,
  testId = "company-preview",
}: {
  name: string | null | undefined;
  labels: CompanyTagLabels;
  className?: string;
  testId?: string;
}) {
  const [open, setOpen] = useState(false);
  const brand = useCompanyBrand(name ?? null, open);
  if (typeof name !== "string" || name.trim() === "") return null;
  const data = brand.data ?? null;

  return (
    <HoverCard openDelay={200} closeDelay={120} open={open} onOpenChange={setOpen}>
      <HoverCardTrigger asChild>
        <button
          type="button"
          data-company={name}
          className={cn(
            "inline-flex max-w-full items-center gap-1 truncate text-xs text-muted-foreground",
            "transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            className,
          )}
        >
          <Building2 className="h-3 w-3 shrink-0" aria-hidden="true" />
          <span className="truncate">{name}</span>
        </button>
      </HoverCardTrigger>
      <HoverCardContent className="w-64" data-testid={testId}>
        {brand.isPending ? (
          <div className="flex gap-3">
            <Skeleton className="h-10 w-10 rounded-lg" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-3 w-1/2" />
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="flex items-start gap-3">
              {data?.logoUrl ? (
                <img
                  src={data.logoUrl}
                  alt=""
                  aria-hidden="true"
                  loading="lazy"
                  className="h-10 w-10 shrink-0 rounded-lg object-contain ring-1 ring-border/60"
                />
              ) : (
                <span
                  aria-hidden="true"
                  className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary ring-1 ring-border/60"
                >
                  <Building2 className="h-5 w-5" />
                </span>
              )}
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-foreground">
                  {data?.name ?? name}
                </p>
                {data?.branch ? (
                  <p className="truncate text-xs text-muted-foreground">{data.branch}</p>
                ) : null}
              </div>
            </div>
            {data?.website ? (
              <a
                href={data.website}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
              >
                <ExternalLink className="h-3 w-3" aria-hidden="true" />
                {labels.website}
              </a>
            ) : null}
          </div>
        )}
      </HoverCardContent>
    </HoverCard>
  );
}
