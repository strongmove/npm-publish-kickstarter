export interface LibraryConfig {
  name: string;
  version?: string;
}

export function greet(name = "friend"): string {
  return `Hello, ${name}!`;
}

export function createLibrarySummary(config: LibraryConfig): string {
  return `${config.name} v${config.version ?? "0.1.0"}`;
}

export default {
  greet,
  createLibrarySummary,
};
