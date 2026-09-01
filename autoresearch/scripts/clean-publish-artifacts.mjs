import { rmSync } from "node:fs";
import { resolve } from "node:path";

const appRoot = resolve(import.meta.dirname, "..");
const distDir = resolve(appRoot, "dist");

rmSync(distDir, { recursive: true, force: true });
console.log("[feynman] removed dist before npm pack/publish");
