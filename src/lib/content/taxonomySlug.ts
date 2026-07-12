// Pure slug generator for inline taxonomy (category / tag) creation in the post
// editor. Lowercases, decomposes to NFD and strips the resulting combining
// diacritic marks (via the `\p{Diacritic}` Unicode property), collapses any run
// of non-alphanumerics to a single dash, trims leading / trailing dashes and
// caps the result at 80 chars. Framework-free and side-effect-free so it can be
// unit tested in isolation. Behaviour matches the previous inline `slugify` in
// admin.posts.$slug.tsx for all Latin/Polish inputs (NFD + combining-mark
// removal); `\p{Diacritic}` is used instead of a raw ̀-ͯ class so the
// character class is not flagged as misleading by lint.
export function slugifyTaxonomy(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}
