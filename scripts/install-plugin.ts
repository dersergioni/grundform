// Copies the built plugin into the plugin folder of the vault given by OBSIDIAN_VAULT in .env.
// Usage: npm run install-plugin

import fs from "node:fs/promises";
import path from "node:path";

const kRoot = path.resolve(import.meta.dirname, "..");
const kFiles: [from: string, to: string][] = [
    ["dist/main.js", "main.js"],
    ["manifest.json", "manifest.json"],
    ["styles.css", "styles.css"],
];

try {
    process.loadEnvFile(path.join(kRoot, ".env"));
} catch {
    // No .env: the variable may come from the shell.
}

const vault = process.env.OBSIDIAN_VAULT ?? "";
if (!vault) {
    console.error("OBSIDIAN_VAULT is empty: put the vault path into .env");
    process.exit(1);
}
try {
    await fs.access(path.join(vault, ".obsidian"));
} catch {
    console.error(`${vault} has no .obsidian folder: check OBSIDIAN_VAULT`);
    process.exit(1);
}

const pluginDir = path.join(vault, ".obsidian", "plugins", "grundform");
await fs.mkdir(pluginDir, { recursive: true });
for (const [from, to] of kFiles) {
    await fs.copyFile(path.join(kRoot, from), path.join(pluginDir, to));
}
console.log(`Installed into ${pluginDir}`);
