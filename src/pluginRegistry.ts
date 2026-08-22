import type { PageType, PluginMatcher, SitePlugin } from "./types";

/** Internal plugin registry entry. */
interface RegistryEntry {
  plugin: SitePlugin;
}

const registry: RegistryEntry[] = [];

const PAGE_TYPE_PRIORITY: Record<PageType, number> = {
  listing: 3,
  detail: 4,
  other: 1,
};

function normalizeUrl(value: string): string {
  return value.trim().toLowerCase();
}

function matcherSpecificity(matcher: PluginMatcher): number {
  switch (matcher.type) {
    case "exact":
      return 4;
    case "path":
      return 3;
    case "regex":
      return 2;
    default:
      return 1;
  }
}

function pluginSpecificity(plugin: SitePlugin, url: string): number {
  const matchers = plugin.matchers ?? [];

  if (matchers.length === 0) {
    return plugin.pageType === "other" ? PAGE_TYPE_PRIORITY[plugin.pageType] : 0;
  }

  const matchedScore = matchers.reduce((score, matcher) => {
    return matchesMatcher(url, matcher)
      ? Math.max(score, matcherSpecificity(matcher))
      : score;
  }, 0);

  return matchedScore + (PAGE_TYPE_PRIORITY[plugin.pageType] ?? 0);
}

function matchesMatcher(url: string, matcher: PluginMatcher): boolean {
  switch (matcher.type) {
    case "exact": {
      return normalizeUrl(url) === normalizeUrl(String(matcher.value));
    }
    case "path": {
      try {
        return (
          normalizeUrl(new URL(url).pathname) ===
          normalizeUrl(String(matcher.value))
        );
      } catch {
        return false;
      }
    }
    case "regex": {
      const regex =
        matcher.value instanceof RegExp ? matcher.value : new RegExp(matcher.value);
      return regex.test(url);
    }
    default:
      return false;
  }
}

function matchesPlugin(plugin: SitePlugin, url: string): boolean {
  const matchers = plugin.matchers ?? [];

  if (matchers.length === 0) {
    return plugin.pageType === "other";
  }

  return matchers.some((matcher) => matchesMatcher(url, matcher));
}

/**
 * Register a SitePlugin with the crawler engine.
 *
 * Plugins are selected by URL matchers rather than hostname. A plugin with no
 * matchers acts as a catch-all only when its pageType is "other".
 *
 * Call this before `runCrawl`.
 */
export function registerPlugin(plugin: SitePlugin): void {
  if (!plugin || typeof plugin.parsePage !== "function") {
    throw new Error(
      `registerPlugin: plugin "${plugin?.name ?? "(unknown)"}" must implement parsePage.`
    );
  }

  if (!plugin.pageType) {
    throw new Error(
      `registerPlugin: plugin "${plugin.name}" must declare a pageType.`
    );
  }

  if (!plugin.matchers || plugin.matchers.length === 0) {
    if (plugin.pageType !== "other") {
      throw new Error(
        `registerPlugin: plugin "${plugin.name}" must declare at least one matcher unless it is pageType="other".`
      );
    }
  }

  const normalizedPlugin: SitePlugin = {
    ...plugin,
    matchers: (plugin.matchers ?? []).map((matcher) => {
      if (!matcher || !["exact", "path", "regex"].includes(matcher.type)) {
        throw new Error(
          `registerPlugin: plugin "${plugin.name}" has an invalid matcher definition.`
        );
      }

      if (matcher.type === "regex" && typeof matcher.value === "string") {
        return { ...matcher, value: new RegExp(matcher.value) };
      }

      return matcher;
    }),
  };

  registry.push({ plugin: normalizedPlugin });
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
  return registry.map((entry) => entry.plugin);
}

/**
 * Find the best plugin for a given URL.
 *
 * Matching priority is based on matcher specificity and page type, with the most
 * specific URL rule winning. If no plugin matches, returns undefined.
 */
export function findPlugin(url: string): SitePlugin | undefined {
  const matches = registry
    .map((entry) => entry.plugin)
    .filter((plugin) => matchesPlugin(plugin, url))
    .sort(
      (left, right) =>
        pluginSpecificity(right, url) - pluginSpecificity(left, url)
    );

  return matches[0];
}
