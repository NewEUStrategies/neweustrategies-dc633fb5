import { useState, type ImgHTMLAttributes } from "react";
import { popupImageSource } from "@/lib/newsletter/popupImages";

type Props = Omit<ImgHTMLAttributes<HTMLImageElement>, "src" | "srcSet" | "onError"> & {
  src: string;
  sizes: string;
};

/** Visible modal media loads eagerly; a failed transform retries the original only once. */
export function PopupImage({
  src,
  sizes,
  alt = "",
  className,
  style,
  loading = "eager",
  ...props
}: Props) {
  const source = popupImageSource(src, sizes);
  const [failure, setFailure] = useState<{ src: string; stage: "original" | "failed" } | null>(
    null,
  );
  const stage = failure?.src === src ? failure.stage : null;
  if (!source.src || stage === "failed") {
    return (
      <span
        aria-hidden={alt ? undefined : true}
        role={alt ? "img" : undefined}
        aria-label={alt || undefined}
        className={`block ${className ?? ""}`}
        style={style}
      />
    );
  }
  return (
    <img
      {...props}
      {...source}
      srcSet={stage === "original" ? undefined : source.srcSet}
      alt={alt}
      loading={loading}
      decoding="async"
      className={className}
      style={style}
      onError={() => setFailure({ src, stage: source.srcSet && !stage ? "original" : "failed" })}
    />
  );
}
