// Atomic Design - post editor lib (pure, framework-free helpers) barrel.
export {
  readLayoutOverrides,
  nextLayoutOverrides,
  resolvePostFormat,
  layoutSetFor,
  overridePatch,
} from "./layoutOverrides";
export {
  buildPostUpdateFields,
  applyPersistedImages,
  replaceFormImageUrls,
  nextOptimisticBase,
  type PostUpdateFieldName,
} from "./savePayload";
export {
  resolveCanonicalSlug,
  type CanonicalSlugInput,
  type CanonicalSlugDecision,
} from "./slugNavigation";
export { classifySaveError, type SaveErrorClassification } from "./saveErrors";
export {
  seoSaveDecision,
  missingRequiredKeys,
  isScheduledInPast,
  type SeoSaveDecision,
} from "./editorGates";
export { historyShortcut, type HistoryAction, type HistoryKeyEvent } from "./historyShortcut";
