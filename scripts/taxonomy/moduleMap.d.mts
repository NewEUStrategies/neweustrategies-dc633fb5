export interface ModuleDefinition {
  id: number;
  name: string;
  patterns: RegExp[];
}
export const MODULES: ModuleDefinition[];
export const CARVE_OUTS: Array<{ module: number; pattern: RegExp }>;
export const CROSS_CUTTING: Array<{ key: string; name: string; patterns: RegExp[] }>;
export const MODULE_NAMES: Map<number, string>;
export function classifyPath(path: string): { module: number | null; crossCutting: string | null };
export function moduleForPath(path: string): number | null;
