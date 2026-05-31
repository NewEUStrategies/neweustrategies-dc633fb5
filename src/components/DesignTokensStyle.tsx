// Injects brand design tokens as :root CSS variables so authored values like
// `var(--brand-primary)` resolve everywhere — builder canvas, admin UI, and
// the live published page. Mount once near the app root.
import { useDesignTokens, tokensToCss } from "@/lib/builder/designTokens";

export function DesignTokensStyle() {
  const { data } = useDesignTokens();
  if (!data) return null;
  const css = tokensToCss(data);
  if (!css) return null;
  // eslint-disable-next-line react/no-danger
  return <style data-brand-tokens dangerouslySetInnerHTML={{ __html: css }} />;
}
