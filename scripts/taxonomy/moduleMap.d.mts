// Typy dla `moduleMap.mjs` - testy TypeScript (src/lib/ci/__tests__) importują
// mapę wprost, bez kopii reguł.

export interface TaxonomyModule {
  readonly id: number;
  /** Etykieta warstwy platformy z audytu (np. „20C", „20R"). */
  readonly key?: string;
  readonly name: string;
  readonly patterns: readonly RegExp[];
}

export interface CrossCuttingBucket {
  readonly key: string;
  readonly name: string;
  readonly patterns: readonly RegExp[];
}

export interface PathClass {
  readonly module: number | null;
  readonly crossCutting: string | null;
}

export declare const CARVE_OUTS: readonly { readonly module: number; readonly pattern: RegExp }[];
export declare const PLATFORM_CORE: readonly RegExp[];
export declare const PLATFORM_CORE_MIN_IMPORTING_AREAS: number;
export declare const PLATFORM_LAYERS: { readonly core: number; readonly composition: number };
export declare const MODULES: readonly TaxonomyModule[];
export declare const CROSS_CUTTING: readonly CrossCuttingBucket[];
export declare const MODULE_NAMES: ReadonlyMap<number, string>;
export declare function classifyPath(path: string): PathClass;
export declare function moduleForPath(path: string): number | null;
