import { dirname, resolve } from "node:path";

import { ModelRegistry, ModelRuntime } from "@earendil-works/pi-coding-agent";

export function getModelsJsonPath(authPath: string): string {
	return resolve(dirname(authPath), "models.json");
}

export async function createModelRuntime(authPath: string): Promise<ModelRuntime> {
	return ModelRuntime.create({
		authPath,
		modelsPath: getModelsJsonPath(authPath),
		allowModelNetwork: false,
	});
}

export async function createModelRegistry(authPath: string): Promise<ModelRegistry> {
	return new ModelRegistry(await createModelRuntime(authPath));
}
