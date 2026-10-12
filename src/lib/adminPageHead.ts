/** Metadata for private administration screens. */
export function adminPageHead(section: string, description: string) {
  const title = `${section} | New European Strategies`;
  return { meta: [
    { title }, { name: "description", content: description },
    { property: "og:title", content: title }, { property: "og:description", content: description },
    { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" },
    { name: "robots", content: "noindex, nofollow" },
  ] };
}
