// Looks up one word and prints its card.
// Usage: node prototype/lookup.ts <word or phrase> [--lang de] [--model name] [--json] [--dry-run]

import { buildCardRequest, requestCard } from "../src/ai.ts";
import { loadEnv, loadLanguages, loadSettings, modelName, parseModel, parseOptions, postWithFetch } from "./env.ts";
import { costUsd } from "./prices.ts";
import { renderCard } from "./render.ts";

loadEnv();
const { options, positional } = parseOptions(process.argv.slice(2));
const query = positional.join(" ");
if (!query) {
    console.error("Usage: node prototype/lookup.ts <word or phrase> [--lang de] [--model name] [--json] [--dry-run]");
    process.exit(1);
}

const languages = loadLanguages();
const hint = options.get("lang");
const model = modelName(options.get("model"));

if (options.has("dry-run")) {
    console.log(JSON.stringify(buildCardRequest(parseModel(model), languages, query, hint), null, 2));
    process.exit(0);
}

const settings = loadSettings(model);
const result = await requestCard(settings, languages, query, hint, postWithFetch);
console.log(options.has("json") ? JSON.stringify(result.card, null, 2) : renderCard(result.card, languages));

const { promptTokens, completionTokens, reasoningTokens } = result.usage;
const cost = costUsd(settings.model, result.usage);
console.log(
    `\n${model}: ${result.latencyMs} ms, ${promptTokens} prompt tokens, ` +
        `${completionTokens} completion tokens (${reasoningTokens} reasoning)` +
        (cost === undefined ? "" : `, $${cost.toFixed(4)}`),
);
