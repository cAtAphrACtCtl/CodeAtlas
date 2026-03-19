import { ConfigurationService } from "./configuration/configuration-service.js";
import { loadConfig, type CodeAtlasConfig } from "./configuration/config.js";
import { RepositoryDiscoveryService } from "./discovery/repository-discovery.js";
import { IndexCoordinator } from "./indexer/index-coordinator.js";
import { FileMetadataStore } from "./metadata/file-metadata-store.js";
import { FileSystemSourceReader } from "./reader/filesystem-source-reader.js";
import { FileRepositoryRegistry } from "./registry/file-repository-registry.js";
import { RipgrepLexicalSearchBackend } from "./search/ripgrep-lexical-search-backend.js";
import { SearchService } from "./search/search-service.js";

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
  lexicalBackend: RipgrepLexicalSearchBackend;
  indexCoordinator: IndexCoordinator;
  sourceReader: FileSystemSourceReader;
  searchService: SearchService;
}

export async function createCodeAtlasServices(
  options: CreateCodeAtlasServicesOptions = {},
): Promise<CodeAtlasServices> {
  const baseDir = options.baseDir ?? process.cwd();
  const config = await loadConfig(options.configFilePath, baseDir);
  const configurationService = new ConfigurationService(baseDir);
  const discoveryService = new RepositoryDiscoveryService();
  const registry = new FileRepositoryRegistry(config.registryPath);
  const metadataStore = new FileMetadataStore(config.metadataPath);
  const lexicalBackend = new RipgrepLexicalSearchBackend(config.lexicalBackend, config.search.maxBytesPerFile);
  const indexCoordinator = new IndexCoordinator(registry, metadataStore, lexicalBackend);
  const sourceReader = new FileSystemSourceReader();
  const searchService = new SearchService(registry, indexCoordinator, lexicalBackend, config.search);

  return {
    config,
    configurationService,
    discoveryService,
    registry,
    metadataStore,
    lexicalBackend,
    indexCoordinator,
    sourceReader,
    searchService,
  };
}