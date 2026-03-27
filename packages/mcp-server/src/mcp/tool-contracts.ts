import { z } from "zod";

export const searchRequestSchema = {
	query: z.string().min(1),
	repos: z.array(z.string().min(1)).optional(),
	limit: z.number().int().positive().optional(),
};

export const findSymbolSchema = {
	query: z.string().min(1),
	repos: z.array(z.string().min(1)).optional(),
	kinds: z
		.array(
			z.enum([
				"class",
				"enum",
				"function",
				"interface",
				"method",
				"property",
				"type_alias",
				"variable",
			]),
		)
		.optional(),
	limit: z.number().int().positive().optional(),
	exact: z.boolean().optional(),
};

export const registerRepoSchema = {
	name: z.string().min(1),
	root_path: z.string().min(1),
	branch: z.string().min(1).optional(),
};

export const readSourceSchema = {
	repo: z.string().min(1),
	path: z.string().min(1),
	start_line: z.number().int().positive(),
	end_line: z.number().int().positive(),
};

export const getIndexStatusSchema = {
	repo: z.string().min(1).optional(),
};

export const refreshRepoSchema = {
	repo: z.string().min(1),
};
