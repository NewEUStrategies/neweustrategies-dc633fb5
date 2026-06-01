// Injects brand design tokens AND global colors as CSS variables on :root / .dark
// so values like `var(--brand-primary)` and overrides of semantic shadcn tokens
// (--primary, --background, …) take effect on every page. Mount once near the app root.
import { useDesignTokens, tokensToCss } from "@/lib/builder/designTokens";
import { useGlobalColors, globalColorsToCss } from "@/hooks/useGlobalColors";

export function DesignTokensStyle() {
  const { data: tokens } = useDesignTokens();
  const { data: globals } = useGlobalColors();
  const css =
    (tokens ? tokensToCss(tokens) : "") +
    (globals ? globalColorsToCss(globals) : "");
  if (!css) return null;
  // eslint-disable-next-line react/no-danger
  return <style data-brand-tokens dangerouslySetInnerHTML={{ __html: css }} />;
}
