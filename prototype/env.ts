// Settings of the prototype scripts, read from .env in the repository root.

import path from "node:path";
import type { AiSettings, PostJson } from "../src/ai.ts";
import { kDefaultLanguages } from "../src/languages.ts";

const kRoot = path.resolve(import.meta.dirname, "..");

export const kOutDir = path.join(kRoot, "out");

// OpenAI-compatible providers and the .env variables that hold their keys.
const kProviders: Record<string, { baseUrl: string; keyVariable: string }> = {
    xai: { baseUrl: "https://api.x.ai/v1", keyVariable: "XAI_API_KEY" },
    openai: { baseUrl: "https://api.openai.com/v1", keyVariable: "OPENAI_API_KEY" },
};
const kDefaultProvider = "xai";

export function loadEnv(): void {
    try {
        process.loadEnvFile(path.join(kRoot, ".env"));
    } catch {
        // No .env: the variables may come from the shell.
    }
}

export function loadLanguages(): string[] {
    const codes = (process.env.LANGUAGES ?? kDefaultLanguages.join(","))
        .split(",")
        .map((code) => code.trim().toLowerCase())
        .filter(Boolean);
    return [...new Set(codes)];
}

export function modelName(override?: string): string {
    return override ?? process.env.AI_MODEL ?? "openai/gpt-6.1-terra:none";
}

// A model is given as "[provider/]name[:effort]", e.g. "grok-4.3" or "openai/gpt-6.1-terra:low";
// the provider defaults to xai.
export function parseModel(spec: string): { provider: string; model: string; reasoningEffort?: string } {
    const [name = "", reasoningEffort] = spec.split(":");
    const slash = name.indexOf("/");
    const provider = slash < 0 ? kDefaultProvider : name.slice(0, slash);
    const model = name.slice(slash + 1);
    return reasoningEffort ? { provider, model, reasoningEffort } : { provider, model };
}

export function loadProvider(name: string): Pick<AiSettings, "baseUrl" | "apiKey"> {
    const provider = kProviders[name];
    if (!provider) {
        console.error(`Unknown provider "${name}": use ${Object.keys(kProviders).join(" or ")}`);
        process.exit(1);
    }
    const apiKey = process.env[provider.keyVariable] ?? "";
    if (!apiKey) {
        console.error(`${provider.keyVariable} is empty: put the key into .env`);
        process.exit(1);
    }
    return { baseUrl: provider.baseUrl, apiKey };
}

export function loadSettings(spec?: string): AiSettings {
    const { provider, ...model } = parseModel(modelName(spec));
    return { ...loadProvider(provider), ...model };
}

// Values of --name options; a flag without a value is "true".
export function parseOptions(argv: string[]): { options: Map<string, string>; positional: string[] } {
    const options = new Map<string, string>();
    const positional: string[] = [];
    for (let i = 0; i < argv.length; ++i) {
        const arg = argv[i]!;
        if (!arg.startsWith("--")) {
            positional.push(arg);
            continue;
        }
        const next = argv[i + 1];
        if (next !== undefined && !next.startsWith("--")) {
            options.set(arg.slice(2), next);
            ++i;
        } else {
            options.set(arg.slice(2), "true");
        }
    }
    return { options, positional };
}

// The plugin sends requests through Obsidian; the prototype uses the fetch of Node.js.
export const postWithFetch: PostJson = async (url, headers, body, timeoutMs) => {
    const response = await fetch(url, { method: "POST", headers, body, signal: AbortSignal.timeout(timeoutMs) });
    return { status: response.status, text: await response.text() };
};
