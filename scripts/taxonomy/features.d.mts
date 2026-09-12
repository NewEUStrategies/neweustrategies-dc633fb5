export interface FeatureDefinition {
  key: string;
  name: string;
  patterns: RegExp[];
}
export const FEATURES_3: FeatureDefinition[];
export const FEATURES_16: FeatureDefinition[];
export const FEATURES_21: FeatureDefinition[];
export const FEATURES: Map<number, FeatureDefinition[]>;
export const FEATURE_NAMES: Map<string, string>;
export function featureForPath(path: string): string | null;
export { MODULE_NAMES } from "./moduleMap.mjs";
