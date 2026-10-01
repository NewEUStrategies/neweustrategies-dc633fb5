import { useMemo } from "react";
import { normalizeBuilderRichHtml } from "@/lib/builder/normalizeRichHtml";
import { RichHtmlContent, type RichHtmlProps } from "./RichHtmlContent";

export function RichHtmlListView({ html, ...props }: RichHtmlProps) {
  const normalized = useMemo(() => normalizeBuilderRichHtml(html), [html]);
  return <RichHtmlContent {...props} html={normalized} />;
}
