import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { createCodeAtlasServices } from "../../core/src/runtime.js";
import { createHandlers } from "./mcp/handlers.js";
import { createCodeAtlasMcpServer } from "./mcp/server.js";

async function main(): Promise<void> {
  const services = await createCodeAtlasServices();
  const handlers = createHandlers({
    registry: services.registry,
    metadataStore: services.metadataStore,
    indexCoordinator: services.indexCoordinator,
    searchService: services.searchService,
    sourceReader: services.sourceReader,
  });

  const server = createCodeAtlasMcpServer(services.config, handlers);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("CodeAtlas MCP server ready.");
}

main().catch((error) => {
  console.error("CodeAtlas MCP server failed to start.");
  console.error(error);
  process.exit(1);
});