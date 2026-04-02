# Repo/Index Lifecycle Task List

Status legend: [ ] todo, [~] in progress, [x] done

## 0. Scope and guardrails

- [x] Keep existing stable MCP tools backward compatible
- [x] Additive-only changes for new lifecycle operations
- [x] Preserve duplicate-root registration support (warning-oriented policy)
- [x] CLI and MCP implemented in same delivery slice

## 1. Contracts and command surface

- [x] Add MCP tool: `unregister_repo`
- [x] Add MCP tool: `delete_index`
- [x] Add zod schemas in MCP contracts
- [x] Register tools in MCP server with clear descriptions
- [x] Add CLI command: `unregister <repo> [--purge-index] [--keep-metadata]`
- [x] Add CLI command: `delete-index <repo> [--target lexical|symbol|all]`
- [x] Update CLI help and interactive usage text

## 2. Core interfaces and persistence

- [x] Extend repository registry interface with unregister capability
- [x] Implement unregister persistence in file-backed registry
- [x] Extend metadata store interface with delete status capability
- [x] Implement metadata delete persistence
- [x] Keep writes atomic and style-consistent with existing JSON storage

## 3. Index artifact lifecycle

- [x] Add lexical index artifact deletion path (repo-key aware)
- [x] Add symbol index artifact deletion path
- [x] Implement coordinator entrypoint to delete index by target
- [x] Implement coordinator entrypoint for unregister lifecycle orchestration
- [x] Preserve explicit partial-failure reporting

## 4. Safety and race handling

- [x] Guard unregister/delete-index when refresh is in-flight for same repo
- [x] Return actionable error message instead of partial unsafe cleanup
- [x] Ensure no cross-repo artifact deletion when roots are duplicated

## 5. Diagnostics and UX

- [x] Add duplicate-root warning diagnostics in register/list/status surface
- [x] Include peer repo names sharing same root in warning details
- [x] Keep current table layout readable in CLI output

## 6. Tests

- [x] Unit: registry unregister behaviors (exists/not-found/idempotency policy)
- [x] Unit: metadata delete behavior
- [x] Unit: coordinator delete-index target coverage
- [x] Unit: in-flight refresh guard for unregister/delete-index
- [x] Integration: MCP unregister_repo lifecycle
- [x] Integration: MCP delete_index lifecycle
- [x] Integration: duplicate-root warning behavior

## 7. Documentation

- [x] Update README stable tools section with new lifecycle tools
- [x] Add README usage examples for safe unregister and purge modes
- [x] Update architecture doc for lifecycle boundaries
- [x] Update roadmap status to reflect delivered lifecycle capabilities

## 8. Verification checklist

- [x] `npm run build`
- [x] `npm test`
- [x] Manual CLI flow over duplicated-root repos
- [x] Manual MCP flow for register/list/status/unregister/delete-index
