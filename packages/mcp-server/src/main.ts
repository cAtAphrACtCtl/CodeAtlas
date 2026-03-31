import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { debugLog, toErrorDetails } from "../../core/src/common/debug.js";
import { getLogger } from "../../core/src/logging/logger.js";
import { createCodeAtlasServices } from "../../core/src/runtime.js";
import { createHandlers } from "./mcp/handlers.js";
import { createCodeAtlasMcpServer } from "./mcp/server.js";

async function main(): Promise<void> {
	const services = await createCodeAtlasServices();
	const logger = services.logger;

	debugLog("runtime", "created CodeAtlas services", {
		serverName: services.config.mcp.serverName,
		serverVersion: services.config.mcp.serverVersion,
		lexicalBackend: services.config.lexicalBackend.kind,
		registryPath: services.config.registryPath,
		metadataPath: services.config.metadataPath,
		indexRoot: services.config.indexRoot,
	});

	const handlers = createHandlers({
		config: services.config,
		registry: services.registry,
		metadataStore: services.metadataStore,
		indexCoordinator: services.indexCoordinator,
		searchService: services.searchService,
		sourceReader: services.sourceReader,
		logger: services.logger,
	});

	const server = createCodeAtlasMcpServer(services.config, handlers);
	const transport = new StdioServerTransport();
	await server.connect(transport);

	logger.info("runtime", "MCP server connected", {
		event: "mcp.server.ready",
		details: { transport: "stdio" },
	});
	debugLog("runtime", "MCP server connected", {
		transport: "stdio",
	});
	console.error("CodeAtlas MCP server ready.");
}

main().catch((error) => {
	const logger = getLogger();
	logger?.error("runtime", "MCP server failed to start", {
		event: "mcp.server.error",
		error: error instanceof Error ? { name: error.name, message: error.message } : { message: String(error) },
	});
	debugLog("runtime", "MCP server failed to start", toErrorDetails(error));
	console.error("CodeAtlas MCP server failed to start.");
	console.error(error);
	process.exit(1);
});
