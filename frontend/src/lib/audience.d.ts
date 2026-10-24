export function rowLabel(type: string, dims: string[]): { text: string; prefix?: string; detail?: string; countryCode?: string };
export function countryName(code: string): string;
export function topologyPaths(topology: unknown): { countryCode: string; path: string }[];
