/** Audio metadata may carry the canonical absolute URL; playback navigation
 * must stay in the current app rather than reload the published origin. */
export function audioContentPath(href: string): string {
  if (href.startsWith("/") && !href.startsWith("//")) return href;
  try {
    const url = new URL(href);
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return "/";
  }
}
