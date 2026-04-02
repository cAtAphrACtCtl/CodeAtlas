export interface RepositoryRegistration {
	name: string;
	rootPath: string;
	branch?: string;
	includeGlobs?: string[];
	excludeGlobs?: string[];
}

export interface RepositoryRecord extends RepositoryRegistration {
	registeredAt: string;
}

export interface RepositoryRegistry {
	listRepositories(): Promise<RepositoryRecord[]>;
	getRepository(name: string): Promise<RepositoryRecord | null>;
	registerRepository(input: RepositoryRegistration): Promise<RepositoryRecord>;
	unregisterRepository?(name: string): Promise<RepositoryRecord | null>;
}
