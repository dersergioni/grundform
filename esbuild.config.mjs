// Bundles the plugin into dist/main.js. Obsidian provides the modules marked external at run time.

import fs from "node:fs/promises";
import { builtinModules } from "node:module";
import esbuild from "esbuild";

// ts-fsrs adds four helper methods to Date.prototype that it never calls itself. The plugin shares its window with
// Obsidian and other plugins, so the build turns them into unused functions, which minification drops.
const kDatePatch = /^Date\.prototype\.(\w+) = function/gm;
const withoutDatePatches = {
    name: "ts-fsrs-without-date-patches",
    setup(build) {
        build.onLoad({ filter: /[\\/]ts-fsrs[\\/]dist[\\/]index\.mjs$/ }, async (args) => {
            const source = await fs.readFile(args.path, "utf8");
            const count = source.match(kDatePatch)?.length ?? 0;
            if (count !== 4) {
                throw new Error(`ts-fsrs: expected 4 Date.prototype methods, found ${count}; check the new version`);
            }
            return { contents: source.replace(kDatePatch, "const unusedDate_$1 = function"), loader: "js" };
        });
    },
};

await esbuild.build({
    entryPoints: ["src/main.ts"],
    bundle: true,
    external: [
        "obsidian",
        "electron",
        "@codemirror/autocomplete",
        "@codemirror/collab",
        "@codemirror/commands",
        "@codemirror/language",
        "@codemirror/lint",
        "@codemirror/search",
        "@codemirror/state",
        "@codemirror/view",
        "@lezer/common",
        "@lezer/highlight",
        "@lezer/lr",
        ...builtinModules,
    ],
    format: "cjs",
    target: "es2021",
    logLevel: "info",
    treeShaking: true,
    outfile: "dist/main.js",
    minify: true,
    plugins: [withoutDatePatches],
});
