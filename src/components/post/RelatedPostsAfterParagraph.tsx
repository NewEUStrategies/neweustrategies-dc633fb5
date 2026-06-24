// Inserts <RelatedPosts /> after the Nth <p> inside an article container, via
// React Portal so the element lives in our React tree but in the article DOM.
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { RelatedPosts, type RelatedPostsProps } from "./RelatedPosts";

interface Props extends RelatedPostsProps {
  containerRef: React.RefObject<HTMLDivElement | null>;
  afterParagraph: number;
  scanKey: string;
}

export function RelatedPostsAfterParagraph({
  containerRef,
  afterParagraph,
  scanKey,
  ...props
}: Props) {
  const [mountEl, setMountEl] = useState<HTMLDivElement | null>(null);

  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;
    // Find the Nth paragraph (1-indexed). Only consider direct prose paragraphs.
    const paragraphs = Array.from(root.querySelectorAll("p"));
    if (paragraphs.length === 0) return;
    const targetIdx = Math.min(Math.max(1, afterParagraph), paragraphs.length) - 1;
    const target = paragraphs[targetIdx];
    if (!target) return;

    // Clean up any stale mount from previous render.
    const prev = root.querySelector('[data-related-mount="inline"]') as HTMLDivElement | null;
    if (prev) prev.remove();

    const wrap = document.createElement("div");
    wrap.dataset.relatedMount = "inline";
    wrap.className = "my-8";
    target.insertAdjacentElement("afterend", wrap);
    setMountEl(wrap);

    return () => {
      wrap.remove();
      setMountEl(null);
    };
  }, [containerRef, afterParagraph, scanKey]);

  if (!mountEl) return null;
  return createPortal(<RelatedPosts {...props} />, mountEl);
}
