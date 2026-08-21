import type { SitePlugin } from "./types";

/** Internal plugin registry entry. */
interface RegistryEntry {
  plugin: SitePlugin;
  hostnames: Set<string>;
}

const registry: RegistryEntry[] = [];

/**
 * Register a SitePlugin with the crawler engine.
 *
 * If the plugin declares `hostnames`, it will be routed pages whose hostname
 * matches one of those entries. A plugin with no `hostnames` acts as a
 * catch-all fallback.
 *
 * Call this before `runCrawl`.
 */
export function registerPlugin(plugin: SitePlugin): void {
  if (!plugin || typeof plugin.parsePage !== "function") {
    throw new Error(
      `registerPlugin: plugin "${plugin?.name ?? "(unknown)"}" must implement parsePage.`
    );
  }

  registry.push({
    plugin,
    hostnames: new Set((plugin.hostnames ?? []).map((h) => h.toLowerCase())),
  });
}

/**
 * Clear all registered plugins (useful for testing).
 */
export function clearPlugins(): void {
  registry.length = 0;
}

/**
 * Return all registered plugins.
 */
export function getPlugins(): SitePlugin[] {
  return registry.map((e) => e.plugin);
}

/**
 * Find the best plugin for a given URL.
 *
 * Matching priority:
 * 1. Plugin whose declared hostname exactly matches the page hostname.
 * 2. First catch-all plugin (no hostnames declared).
 * 3. undefined if nothing matches.
 */
export function findPlugin(url: string): SitePlugin | undefined {
  let hostname = "";
  try {
    hostname = new URL(url).hostname.toLowerCase();
  } catch {
    // invalid URL — fall through to catch-all
  }

  // Exact hostname match.
  for (const entry of registry) {
    if (entry.hostnames.size > 0 && entry.hostnames.has(hostname)) {
      return entry.plugin;
    }
  }

  // Catch-all.
  for (const entry of registry) {
    if (entry.hostnames.size === 0) {
      return entry.plugin;
    }
  }

  return undefined;
}
