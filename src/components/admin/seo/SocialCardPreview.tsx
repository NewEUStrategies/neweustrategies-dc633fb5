// Podgląd JEDNEJ karty udostępniania - tak, jak narysuje ją konkretna sieć.
//
// PO CO OSOBNY KOMPONENT. Zakładka /admin/seo/social pokazuje pięć podglądów
// obok siebie i cała jej wartość polega na tym, że RÓŻNIĄ SIĘ dokładnie tym,
// czym różnią się prawdziwe unfurle: kadrem miniatury, progiem przycięcia
// tytułu i opisu oraz miejscem, w którym stoi host. Gdyby te różnice siedziały
// w pętli wewnątrz ekranu, pierwsza zmiana layoutu zlałaby je z powrotem
// w jedną, wspólną kartę - czyli w to samo kłamstwo, które ten ekran usuwa.
//
// KOMPONENT JEST CZYSTO PREZENTACYJNY: bez pobierania danych, bez sięgania po
// ustawienia i BEZ ANI JEDNEGO `t()`. Wszystkie napisy (łącznie z etykietą
// pustego kadru) podaje rodzic, bo to on zna język podglądu - dzięki temu ten
// plik nie wciąga słownika i nadaje się do renderu w teście jako czysta
// funkcja propsów.
import { truncateForNetwork, type SocialNetworkSpec } from "@/lib/seo/socialNetworks";

export interface SocialCardPreviewProps {
  spec: SocialNetworkSpec;
  /** Gotowy adres obrazka; pusty = rysujemy neutralny placeholder. */
  imageUrl: string;
  title: string;
  description: string;
  /** Host bez protokołu - patrz `displayHost()`. */
  host: string;
  imageAlt: string;
  /** Przetłumaczony napis placeholdera - komponent sam nic nie tłumaczy. */
  emptyImageLabel: string;
}

export function SocialCardPreview({
  spec,
  imageUrl,
  title,
  description,
  host,
  imageAlt,
  emptyImageLabel,
}: SocialCardPreviewProps) {
  const cardTitle = truncateForNetwork(title, spec.titleLimit);
  // `descriptionLimit === 0` znaczy „ta sieć opisu NIE pokazuje" - wtedy nie
  // rysujemy pustego akapitu, tylko pomijamy całą linię, bo w prawdziwym
  // unfurlu jej po prostu nie ma.
  const cardDescription =
    spec.descriptionLimit > 0 ? truncateForNetwork(description, spec.descriptionLimit) : "";

  const hostLine = (
    <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{host}</p>
  );

  return (
    <figure className="overflow-hidden rounded-lg border border-border bg-card">
      {/* Kadr miniatury bierze proporcję Z DANYCH sieci - to on pokazuje, ile
          z obrazka faktycznie zostanie widoczne po przycięciu. */}
      <div className="w-full bg-muted" style={{ aspectRatio: spec.aspect }}>
        {imageUrl ? (
          <img
            src={imageUrl}
            alt={imageAlt}
            className="h-full w-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center p-3 text-center text-xs text-muted-foreground">
            {emptyImageLabel}
          </div>
        )}
      </div>

      <div className="space-y-1 p-3">
        {/* Facebook i LinkedIn stawiają domenę NAD tytułem, X pod nim. To
            jedyna widoczna różnica między tymi unfurlami poza przycięciem -
            i powód, dla którego `hostPosition` w ogóle istnieje. */}
        {spec.hostPosition === "above" ? hostLine : null}
        <p className="text-sm font-semibold leading-snug">{cardTitle}</p>
        {cardDescription ? (
          <p className="text-xs text-muted-foreground">{cardDescription}</p>
        ) : null}
        {spec.hostPosition === "below" ? hostLine : null}
      </div>

      {/* Nazwa sieci jest marką - ta sama w PL i EN, więc idzie z danych,
          nie ze słownika. */}
      <figcaption className="border-t border-border px-3 py-2 text-[11px] font-medium text-muted-foreground">
        {spec.label}
      </figcaption>
    </figure>
  );
}
