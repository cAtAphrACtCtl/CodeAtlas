import { toErrorDetails } from "../../core/common/debug.js";
import type { CodeAtlasConfig } from "../../core/configuration/config.js";
import type {
	ReadSourceRequest,
	SearchRequest,
	SymbolSearchRequest,
} from "../../core/contracts/search.js";
import { attachIndexStatusDiagnostics } from "../../core/diagnostics/index-status-diagnostics.js";
import type { IndexCoordinator } from "../../core/indexer/index-coordinator.js";
import { runWithRequestContext } from "../../core/logging/context.js";
import type { Logger } from "../../core/logging/logger.js";
import type { MetadataStore } from "../../core/metadata/metadata-store.js";
import type { SourceReader } from "../../core/reader/source-reader.js";
import type { RepositoryRegistry } from "../../core/registry/repository-registry.js";
import { getRepositoryWarningsForRepo } from "../../core/registry/repository-warnings.js";
import type { SearchService } from "../../core/search/search-service.js";

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

	const submitRefresh = (repo: string) =>
		dependencies.indexCoordinator.submitRefresh(repo);

	const withDiagnosticsList = (
		statuses: Awaited<ReturnType<IndexCoordinator["getStatus"]>>,
	) =>
		statuses.map((status) =>
			attachIndexStatusDiagnostics(status, dependencies.config.lexicalBackend),
		);

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
				const result = await action();
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
				const repositories = await dependencies.registry.listRepositories();
				const statuses = await dependencies.indexCoordinator.getStatus();
				const diagnosedStatuses = withDiagnosticsList(statuses);

				return toToolResult({
					repositories,
					repository_warnings: repositories.flatMap((repository) =>
						getRepositoryWarningsForRepo(repositories, repository.name),
					),
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
					const repository = await dependencies.registry.registerRepository({
						name: request.name,
						rootPath: request.root_path,
						branch: request.branch,
					});

					const status = await submitRefresh(
						repository.name,
					);
					const diagnosedStatus = withDiagnostics(status);
					const repositories = await dependencies.registry.listRepositories();

					return toToolResult({
						repository,
						repository_warnings: getRepositoryWarningsForRepo(
							repositories,
							repository.name,
						),
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
					const response =
						await dependencies.searchService.searchLexical(request);
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
					const response =
						await dependencies.searchService.findSymbols(request);
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
					const response =
						await dependencies.searchService.searchSemantic(request);
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
					const response =
						await dependencies.searchService.searchHybrid(request);
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
					const statuses = await dependencies.indexCoordinator.getStatus(
						request.repo,
					);
					const diagnosedStatuses = withDiagnosticsList(statuses);
					const repositories = await dependencies.registry.listRepositories();

					return toToolResult({
						repository_warnings: request.repo
							? getRepositoryWarningsForRepo(repositories, request.repo)
							: repositories.flatMap((repository) =>
								getRepositoryWarningsForRepo(repositories, repository.name),
							),
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
					const status = await submitRefresh(
						request.repo,
					);
					const diagnosedStatus = withDiagnostics(status);

					return toToolResult({
						index_status: diagnosedStatus,
					});
				},
			),

			unregisterRepo: async (request: {
				repo: string;
				purge_index?: boolean;
				purge_metadata?: boolean;
			}) =>
				withRequestContext(
					"unregister_repo",
					{
						repo: request.repo,
						purgeIndex: request.purge_index,
						purgeMetadata: request.purge_metadata,
					},
					async () => {
						const result = await dependencies.indexCoordinator.unregisterRepository(
							request.repo,
							{
								purgeIndex: request.purge_index,
								purgeMetadata: request.purge_metadata,
							},
						);

						return toToolResult({
							repository: request.repo,
							result,
						});
					},
				),

			deleteIndex: async (request: {
				repo: string;
				target?: "lexical" | "symbol" | "all";
			}) =>
				withRequestContext(
					"delete_index",
					{
						repo: request.repo,
						target: request.target,
					},
					async () => {
						const result = await dependencies.indexCoordinator.deleteRepositoryIndex(
							request.repo,
							request.target,
						);
						const statuses = await dependencies.indexCoordinator.getStatus(
							request.repo,
						);
						const diagnosedStatuses = withDiagnosticsList(statuses);

						return toToolResult({
							result,
							index_status: diagnosedStatuses,
						});
					},
				),
	};
}
