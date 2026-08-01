// Molecule: publiczny widok bloku "Podgląd linku".

import type { Json } from "@/lib/blocks/types";
import {
  normalizeLinkPreviewData,
  pickIntro,
  pickLabel,
  previewImageUrl,
  type LinkPreviewLang,
} from "@/lib/blocks/linkPreview";
import { LinkPreview } from "@/components/ui/link-preview";

interface Props {
  data: Record<string, Json>;
  lang: LinkPreviewLang;
}

export function LinkPreviewBlockView({ data, lang }: Props) {
  const model = normalizeLinkPreviewData(data);
  if (model.items.length === 0) return null;
  const intro = pickIntro(model, lang);

  const links = model.items.map((item, index) => (
    <LinkPreview
      key={`${item.url}-${index}`}
      url={item.url}
      imageSrc={previewImageUrl(item, model)}
      alt={pickLabel(item, lang)}
      width={model.width}
      height={model.height}
      enabled={model.preview}
    >
      {pickLabel(item, lang)}
    </LinkPreview>
  ));

  if (model.layout === "list") {
    return (
      <div className="not-prose my-6 space-y-2">
        {intro ? <p className="text-base text-foreground">{intro}</p> : null}
        <ul className="list-disc space-y-1 pl-5 text-base text-foreground">
          {links.map((link, index) => (
            <li key={`li-${index}`}>{link}</li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <p className="not-prose my-6 text-base leading-relaxed text-foreground">
      {intro ? <span>{intro} </span> : null}
      {links.map((link, index) => (
        <span key={`in-${index}`}>
          {index > 0 ? <span>, </span> : null}
          {link}
        </span>
      ))}
    </p>
  );
}
