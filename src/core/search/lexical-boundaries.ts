export const skippedDirectories = [
	".git",
	"bin",
	"obj",
	"publish",
	"node_modules",
	"dist",
	"data",
	".next",
] as const;

export const skippedDirectorySet = new Set<string>(skippedDirectories);