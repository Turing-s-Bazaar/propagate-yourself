import { cpSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

const appRoot = resolve(import.meta.dirname, "..");
const websitePublicDir = resolve(appRoot, "website", "public");

mkdirSync(websitePublicDir, { recursive: true });
cpSync(resolve(appRoot, "scripts", "install", "install.sh"), resolve(websitePublicDir, "install"));
cpSync(resolve(appRoot, "scripts", "install", "install.ps1"), resolve(websitePublicDir, "install.ps1"));
cpSync(resolve(appRoot, "scripts", "install", "install-skills.sh"), resolve(websitePublicDir, "install-skills"));
cpSync(resolve(appRoot, "scripts", "install", "install-skills.ps1"), resolve(websitePublicDir, "install-skills.ps1"));

console.log("[feynman] synced website installers");
