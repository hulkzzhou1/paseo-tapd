import { readFile, rm, cp, mkdir } from "node:fs/promises";
import { resolve } from "node:path";

// The published 0.13.2 SDK predates agent tools; use a trusted local Paseo main checkout.
const root = process.argv[2];
if (!root) throw new Error("Usage: npm run sdk:main -- /path/to/paseo-main");
const source = resolve(root, "packages/plugin");
const manifest = JSON.parse(await readFile(resolve(source, "package.json"), "utf8"));
const declarations = await readFile(resolve(source, "dist/server/index.d.ts"), "utf8");
if (manifest.name !== "@getpaseo/plugin" || !declarations.includes("defineAgentTool")) {
  throw new Error("Build the Paseo main plugin SDK with agent-tool support first.");
}
const target = new URL("../node_modules/@getpaseo/plugin", import.meta.url);
await rm(target, { recursive: true, force: true });
await mkdir(target, { recursive: true });
await cp(resolve(source, "package.json"), new URL("package.json", `${target.href}/`));
await cp(resolve(source, "dist"), new URL("dist", `${target.href}/`), { recursive: true });
console.log(`Using the Paseo main plugin SDK (${manifest.version}).`);
