/** Shared route/query configuration kept outside the split route module. */
export const SUPPORT_SEGMENTS: string[] = ["support"];

/** Missing optional CMS content must never delay the built-in support page. */
export const SUPPORT_DOC_BUDGET_MS = 2_500;
