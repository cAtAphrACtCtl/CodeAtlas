import { initializeDebug } from "./common/debug.js";
import { type CodeAtlasConfig, loadConfig } from "./configuration/config.js";
import { ConfigurationService } from "./configuration/configuration-service.js";
import { RepositoryDiscoveryService } from "./discovery/repository-discovery.js";
import { IndexCoordinator } from "./indexer/index-coordinator.js";
import { Logger, setGlobalLogger } from "./logging/logger.js";
import { PinoFileSink } from "./logging/pino-file-sink.js";
import { FileMetadataStore } from "./metadata/file-metadata-store.js";
import { FileSystemSourceReader } from "./reader/filesystem-source-reader.js";
import { FileRepositoryRegistry } from "./registry/file-repository-registry.js";
import { createLexicalSearchBackend } from "./search/create-lexical-search-backend.js";
import { BootstrapRipgrepLexicalSearchBackend } from "./search/ripgrep-lexical-search-backend.js";
import type { LexicalSearchBackend } from "./search/lexical-search-backend.js";
import { SearchService } from "./search/search-service.js";
import { TypeScriptSymbolExtractor } from "./search/symbol-extractor.js";
import { FileSymbolIndexStore } from "./search/symbol-index-store.js";
import { SymbolSearchBackend } from "./search/symbol-search-backend.js";

export interface CreateCodeAtlasServicesOptions {
	baseDir?: string;
	configFilePath?: string;
}

export interface CodeAtlasServices {
	config: CodeAtlasConfig;
	logger: Logger;
	configurationService: ConfigurationService;
	discoveryService: RepositoryDiscoveryService;
	registry: FileRepositoryRegistry;
	metadataStore: FileMetadataStore;
	lexicalBackend: LexicalSearchBackend;
	symbolExtractor: TypeScriptSymbolExtractor;
	symbolIndexStore: FileSymbolIndexStore;
	symbolSearchBackend: SymbolSearchBackend;
	indexCoordinator: IndexCoordinator;
	sourceReader: FileSystemSourceReader;
	searchService: SearchService;
}

export async function createCodeAtlasServices(
	options: CreateCodeAtlasServicesOptions = {},
): Promise<CodeAtlasServices> {
	const baseDir = options.baseDir ?? process.cwd();
	const configurationService = new ConfigurationService(baseDir);
	const resolvedConfigFilePath =
		options.configFilePath ??
		process.env.CODEATLAS_CONFIG ??
		configurationService.getDefaultConfigPath();
	const config = await loadConfig(resolvedConfigFilePath, baseDir);
	initializeDebug(config.debug);

	// Initialize structured logger
	const logger = new Logger({
		level: config.logging.level,
		enabled: config.logging.enabled,
	});
	if (config.logging.file.enabled) {
		logger.addSink(new PinoFileSink(config.logging.file.path, "debug"));
	}
	setGlobalLogger(logger);

	logger.info("runtime", "loaded configuration", {
		details: {
			baseDir,
			configFilePath: resolvedConfigFilePath,
			lexicalBackend: config.lexicalBackend.kind,
			registryPath: config.registryPath,
			metadataPath: config.metadataPath,
			indexRoot: config.indexRoot,
			loggingLevel: config.logging.level,
			loggingFilePath: config.logging.file.path,
		},
	});
	const discoveryService = new RepositoryDiscoveryService();
	const registry = new FileRepositoryRegistry(config.registryPath, {
		lexicalIndexRoot:
			config.lexicalBackend.kind === "zoekt"
				? config.lexicalBackend.indexRoot
				: undefined,
		symbolIndexRoot: config.indexRoot,
	});
	const metadataStore = new FileMetadataStore(config.metadataPath);
	const lexicalBackend = createLexicalSearchBackend(
		config.lexicalBackend,
		config.search.maxBytesPerFile,
		config.indexing,
	);
	const directSymbolFallbackBackend =
		config.lexicalBackend.kind === "zoekt"
			? new BootstrapRipgrepLexicalSearchBackend(
					config.lexicalBackend.bootstrapFallback,
					config.search.maxBytesPerFile,
				)
			: undefined;
	const symbolExtractor = new TypeScriptSymbolExtractor({
		concurrency: config.indexing.symbolConcurrency,
	});
	const symbolIndexStore = new FileSymbolIndexStore(config.indexRoot);
	const symbolSearchBackend = new SymbolSearchBackend(
		lexicalBackend,
		directSymbolFallbackBackend,
	);
	const indexCoordinator = new IndexCoordinator(
		registry,
		metadataStore,
		lexicalBackend,
		symbolExtractor,
		symbolIndexStore,
	);
	const sourceReader = new FileSystemSourceReader();
	const searchService = new SearchService(
		registry,
		indexCoordinator,
		lexicalBackend,
		symbolSearchBackend,
		config.search,
	);

	logger.info("runtime", "initialized runtime services", {
		backend: lexicalBackend.kind,
		details: {
			symbolIndexRoot: config.indexRoot,
			maxBytesPerFile: config.search.maxBytesPerFile,
		},
	});

	return {
		config,
		logger,
		configurationService,
		discoveryService,
		registry,
		metadataStore,
		lexicalBackend,
		symbolExtractor,
		symbolIndexStore,
		symbolSearchBackend,
		indexCoordinator,
		sourceReader,
		searchService,
	};
}
