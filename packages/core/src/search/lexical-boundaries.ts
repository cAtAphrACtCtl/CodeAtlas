export const skippedDirectories = [
	".git",
	"node_modules",
	"dist",
	"data",
	".next",
] as const;

export const skippedDirectorySet = new Set<string>(skippedDirectories);