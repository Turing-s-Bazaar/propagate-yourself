import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const appRoot = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
	base: "/app-shell/",
	root: resolve(appRoot, "workbench-web"),
	plugins: [react()],
	build: {
		emptyOutDir: true,
		outDir: resolve(appRoot, "dist", "workbench-web"),
	},
	server: {
		host: "127.0.0.1",
	},
});
