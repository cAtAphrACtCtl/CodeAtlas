import { debugLog, toErrorDetails } from "../../../core/src/common/debug.js";
import type { CodeAtlasConfig } from "../../../core/src/configuration/config.js";
import type {
	ReadSourceRequest,
	SearchRequest,
	SymbolSearchRequest,
} from "../../../core/src/contracts/search.js";
import { attachIndexStatusDiagnostics } from "../../../core/src/diagnostics/index-status-diagnostics.js";
import type { IndexCoordinator } from "../../../core/src/indexer/index-coordinator.js";
import { runWithRequestContext } from "../../../core/src/logging/context.js";
import type { Logger } from "../../../core/src/logging/logger.js";
import type { MetadataStore } from "../../../core/src/metadata/metadata-store.js";
import type { SourceReader } from "../../../core/src/reader/source-reader.js";
import type { RepositoryRegistry } from "../../../core/src/registry/repository-registry.js";
import type { SearchService } from "../../../core/src/search/search-service.js";

export interface HandlerDependencies {
	config: CodeAtlasConfig;
	registry: RepositoryRegistry;
	metadataStore: MetadataStore;
	indexCoordinator: IndexCoordinator;
	searchService: SearchService;
	sourceReader: SourceReader;
	logger: Logger;
}

function toToolResult<T extends object>(payload: T) {
	return {
		content: [
			{
				type: "text" as const,
				text: JSON.stringify(payload, null, 2),
			},
		],
		structuredContent: payload as Record<string, unknown>,
	};
}

export function createHandlers(dependencies: HandlerDependencies) {
	const { logger } = dependencies;

	const withDiagnostics = (
		status: Awaited<ReturnType<IndexCoordinator["refreshRepository"]>>,
	) => attachIndexStatusDiagnostics(status, dependencies.config.lexicalBackend);

	const withDiagnosticsList = (
		statuses: Awaited<ReturnType<IndexCoordinator["getStatus"]>>,
	) =>
		statuses.map((status) =>
			attachIndexStatusDiagnostics(status, dependencies.config.lexicalBackend),
		);

	async function withFailureLogging<T>(
		tool: string,
		context: Record<string, unknown>,
		action: () => Promise<T>,
	): Promise<T> {
		try {
			return await action();
		} catch (error) {
			debugLog("mcp", `${tool} failed`, {
				...context,
				...toErrorDetails(error),
			});
			throw error;
		}
	}

	/**
	 * Wraps a handler with request context, structured logging, and duration tracking.
	 * All handlers get a unique requestId, start/complete/error events, and timing.
	 */
	async function withRequestContext<T>(
		toolName: string,
		context: Record<string, unknown>,
		action: () => Promise<T>,
	): Promise<T> {
		return runWithRequestContext({ toolName }, async () => {
			const startTime = performance.now();
			logger.info("mcp", `handling ${toolName}`, {
				event: "mcp.request.start",
				toolName,
				details: context,
			});

			try {
				const result = await withFailureLogging(toolName, context, action);
				const durationMs = Math.round(performance.now() - startTime);
				logger.info("mcp", `completed ${toolName}`, {
					event: "mcp.request.complete",
					toolName,
					durationMs,
				});
				return result;
			} catch (error) {
				const durationMs = Math.round(performance.now() - startTime);
				logger.error("mcp", `${toolName} failed`, {
					event: "mcp.request.error",
					toolName,
					durationMs,
					error: toErrorDetails(error),
				});
				throw error;
			}
		});
	}

	return {
		listRepos: async () =>
			withRequestContext("list_repos", {}, async () => {
				debugLog("mcp", "handling list_repos");
				const repositories = await dependencies.registry.listRepositories();
				const statuses = await dependencies.indexCoordinator.getStatus();
				const diagnosedStatuses = withDiagnosticsList(statuses);

				debugLog("mcp", "completed list_repos", {
					repositoryCount: repositories.length,
					statusCount: diagnosedStatuses.length,
				});

				return toToolResult({
					repositories,
					index_status: diagnosedStatuses,
				});
			}),

		registerRepo: async (request: {
			name: string;
			root_path: string;
			branch?: string;
		}) =>
			withRequestContext(
				"register_repo",
				{
					name: request.name,
					rootPath: request.root_path,
					branch: request.branch,
				},
				async () => {
					debugLog("mcp", "handling register_repo", {
						name: request.name,
						rootPath: request.root_path,
						branch: request.branch,
					});
					const repository = await dependencies.registry.registerRepository({
						name: request.name,
						rootPath: request.root_path,
						branch: request.branch,
					});

					const status = await dependencies.indexCoordinator.refreshRepository(
						repository.name,
					);
					const diagnosedStatus = withDiagnostics(status);

					debugLog("mcp", "completed register_repo", {
						name: repository.name,
						backend: diagnosedStatus.backend,
						configuredBackend: diagnosedStatus.configuredBackend,
						state: diagnosedStatus.state,
						symbolState: diagnosedStatus.symbolState,
					});

					return toToolResult({
						repository,
						index_status: diagnosedStatus,
					});
				},
			),

		codeSearch: async (request: SearchRequest) =>
			withRequestContext(
				"code_search",
				{
					query: request.query,
					repos: request.repos,
					limit: request.limit,
				},
				async () => {
					debugLog("mcp", "handling code_search", {
						query: request.query,
						repos: request.repos,
						limit: request.limit,
					});
					const response =
						await dependencies.searchService.searchLexical(request);
					debugLog("mcp", "completed code_search", {
						query: request.query,
						resultCount: response.results.length,
					});
					return toToolResult(response);
				},
			),

		findSymbol: async (request: SymbolSearchRequest) =>
			withRequestContext(
				"find_symbol",
				{
					query: request.query,
					repos: request.repos,
					kinds: request.kinds,
					exact: request.exact,
					limit: request.limit,
				},
				async () => {
					debugLog("mcp", "handling find_symbol", {
						query: request.query,
						repos: request.repos,
						kinds: request.kinds,
						exact: request.exact,
						limit: request.limit,
					});
					const response =
						await dependencies.searchService.findSymbols(request);
					debugLog("mcp", "completed find_symbol", {
						query: request.query,
						resultCount: response.results.length,
					});
					return toToolResult(response);
				},
			),

		semanticSearch: async (request: SearchRequest) =>
			withRequestContext(
				"semantic_search",
				{
					query: request.query,
					repos: request.repos,
					limit: request.limit,
				},
				async () => {
					debugLog("mcp", "handling semantic_search", {
						query: request.query,
						repos: request.repos,
						limit: request.limit,
					});
					const response =
						await dependencies.searchService.searchSemantic(request);
					debugLog("mcp", "completed semantic_search", {
						query: request.query,
						notImplemented: response.not_implemented,
					});
					return toToolResult(response);
				},
			),

		hybridSearch: async (request: SearchRequest) =>
			withRequestContext(
				"hybrid_search",
				{
					query: request.query,
					repos: request.repos,
					limit: request.limit,
				},
				async () => {
					debugLog("mcp", "handling hybrid_search", {
						query: request.query,
						repos: request.repos,
						limit: request.limit,
					});
					const response =
						await dependencies.searchService.searchHybrid(request);
					debugLog("mcp", "completed hybrid_search", {
						query: request.query,
						notImplemented: response.not_implemented,
					});
					return toToolResult(response);
				},
			),

		readSource: async (request: ReadSourceRequest) =>
			withRequestContext(
				"read_source",
				{
					repo: request.repo,
					path: request.path,
					startLine: request.start_line,
					endLine: request.end_line,
				},
				async () => {
					debugLog("mcp", "handling read_source", {
						repo: request.repo,
						path: request.path,
						startLine: request.start_line,
						endLine: request.end_line,
					});
					const repository = await dependencies.registry.getRepository(
						request.repo,
					);
					if (!repository) {
						throw new Error(`Unknown repository: ${request.repo}`);
					}

					const response = await dependencies.sourceReader.readRange(
						repository,
						request.path,
						request.start_line,
						request.end_line,
					);

					debugLog("mcp", "completed read_source", {
						repo: request.repo,
						path: request.path,
						startLine: response.start_line,
						endLine: response.end_line,
					});

					return toToolResult(response);
				},
			),

		getIndexStatus: async (request: { repo?: string }) =>
			withRequestContext(
				"get_index_status",
				{
					repo: request.repo,
				},
				async () => {
					debugLog("mcp", "handling get_index_status", {
						repo: request.repo,
					});
					const statuses = await dependencies.indexCoordinator.getStatus(
						request.repo,
					);
					const diagnosedStatuses = withDiagnosticsList(statuses);

					debugLog("mcp", "completed get_index_status", {
						repo: request.repo,
						statusCount: diagnosedStatuses.length,
					});

					return toToolResult({
						index_status: diagnosedStatuses,
					});
				},
			),

		refreshRepo: async (request: { repo: string }) =>
			withRequestContext(
				"refresh_repo",
				{
					repo: request.repo,
				},
				async () => {
					debugLog("mcp", "handling refresh_repo", {
						repo: request.repo,
					});
					const status = await dependencies.indexCoordinator.refreshRepository(
						request.repo,
					);
					const diagnosedStatus = withDiagnostics(status);

					debugLog("mcp", "completed refresh_repo", {
						repo: request.repo,
						backend: diagnosedStatus.backend,
						configuredBackend: diagnosedStatus.configuredBackend,
						state: diagnosedStatus.state,
						symbolState: diagnosedStatus.symbolState,
					});

					return toToolResult({
						index_status: diagnosedStatus,
					});
				},
			),
	};
}
