/**
 * Bootstrap script example — shows how to wire everything together.
 *
 * Usage (after building the package):
 *   npx ts-node src/examples/bootstrap.ts
 *
 * In a consumer project:
 *   import { registerPlugin, runCrawl } from "@strongmove/crawler-core";
 */

import { registerPlugin, runCrawl } from "../index";
import { ExamplePlugin } from "./ExamplePlugin";
import { LoggingPersistenceAdapter } from "./LoggingPersistenceAdapter";

async function main() {
  // 1. Register site plugins before starting the crawl.
  registerPlugin(ExamplePlugin);

  // 2. Create your persistence adapter (or use NoopPersistenceAdapter for dev).
  const persistence = new LoggingPersistenceAdapter();

  // 3. Run the crawl.
  const summary = await runCrawl(
    ["https://example.com/"],
    {
      persistence,
      globalConcurrency: 2,
      maxDepth: 2,
      perHostDelayMs: 1000,
      maxPagesPerRun: 50,
      logger: (event) => {
        // Wire to your logging library (pino, winston, etc.)
        if (event.level !== "debug") {
          console.log(`[${event.level.toUpperCase()}] ${event.event}: ${event.message}`, event.meta ?? "");
        }
      },
    }
  );

  console.log("Crawl finished:", summary);
}

main().catch(console.error);
