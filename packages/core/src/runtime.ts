import { debugLog, initializeDebug } from "./common/debug.js";
import { type CodeAtlasConfig, loadConfig } from "./configuration/config.js";
import { ConfigurationService } from "./configuration/configuration-service.js";
import { RepositoryDiscoveryService } from "./discovery/repository-discovery.js";
import { IndexCoordinator } from "./indexer/index-coordinator.js";
import { FileMetadataStore } from "./metadata/file-metadata-store.js";
import { FileSystemSourceReader } from "./reader/filesystem-source-reader.js";
import { FileRepositoryRegistry } from "./registry/file-repository-registry.js";
import { createLexicalSearchBackend } from "./search/create-lexical-search-backend.js";
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
	const config = await loadConfig(options.configFilePath, baseDir);
	initializeDebug(config.debug);
	debugLog("runtime", "loaded configuration", {
		baseDir,
		configFilePath: options.configFilePath ?? process.env.CODEATLAS_CONFIG,
		lexicalBackend: config.lexicalBackend.kind,
		registryPath: config.registryPath,
		metadataPath: config.metadataPath,
		indexRoot: config.indexRoot,
	});
	const configurationService = new ConfigurationService(baseDir);
	const discoveryService = new RepositoryDiscoveryService();
	const registry = new FileRepositoryRegistry(config.registryPath);
	const metadataStore = new FileMetadataStore(config.metadataPath);
	const lexicalBackend = createLexicalSearchBackend(
		config.lexicalBackend,
		config.search.maxBytesPerFile,
	);
	const symbolExtractor = new TypeScriptSymbolExtractor();
	const symbolIndexStore = new FileSymbolIndexStore(config.indexRoot);
	const symbolSearchBackend = new SymbolSearchBackend(symbolIndexStore);
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

	debugLog("runtime", "initialized runtime services", {
		lexicalBackend: lexicalBackend.kind,
		symbolIndexRoot: config.indexRoot,
		maxBytesPerFile: config.search.maxBytesPerFile,
	});

	return {
		config,
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
