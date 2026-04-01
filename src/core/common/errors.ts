export class CodeAtlasError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "CodeAtlasError";
	}
}

export function invariant(
	condition: unknown,
	message: string,
): asserts condition {
	if (!condition) {
		throw new CodeAtlasError(message);
	}
}
