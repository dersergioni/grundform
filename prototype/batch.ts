// Runs the test words on one or more models. For each model, <out>/<model>/ gets one JSON file per word
// and report.md with the rendered cards; <out>/summary.md compares the models. <out> is out/ by default.
// Usage: node prototype/batch.ts [--model a,b:low] [--words file] [--concurrency 4] [--out dir]

import fs from "node:fs/promises";
import path from "node:path";
import { requestCard, type CardResult } from "../src/ai.ts";
import { kOutDir, loadEnv, loadLanguages, loadSettings, modelName, parseOptions, postWithFetch } from "./env.ts";
import { costUsd } from "./prices.ts";
import { renderCard } from "./render.ts";

interface TestWord {
    query: string;
    hint?: string;
}

interface Outcome {
    word: TestWord;
    result?: CardResult;
    error?: string;
}

// One query per line, optionally followed by a language hint such as "@de"; "#" starts a comment line.
function parseWords(text: string): TestWord[] {
    return text
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith("#"))
        .map((line) => {
            const [, query, hint] = line.match(/^(.*?)\s+@(\w+)$/) ?? [];
            return query && hint ? { query, hint } : { query: line };
        });
}

async function mapLimit<T, R>(items: T[], limit: number, task: (item: T, index: number) => Promise<R>): Promise<R[]> {
    const results: R[] = new Array(items.length);
    let next = 0;
    const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (next < items.length) {
            const index = next++;
            results[index] = await task(items[index]!, index);
        }
    });
    await Promise.all(workers);
    return results;
}

function fileName(index: number, query: string): string {
    const slug = query
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, "-")
        .replace(/^-|-$/g, "");
    return `${String(index + 1).padStart(2, "0")}-${slug}.json`;
}

function median(values: number[]): number {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

function formatUsd(value: number | undefined): string {
    return value === undefined ? "n/a" : `$${value.toFixed(4)}`;
}

loadEnv();
const { options } = parseOptions(process.argv.slice(2));
const models = modelName(options.get("model"))
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
const wordsFile = options.get("words") ?? path.join(import.meta.dirname, "words.txt");
const concurrency = Number(options.get("concurrency") ?? 4);
const outDir = path.resolve(options.get("out") ?? kOutDir);
const languages = loadLanguages();
const words = parseWords(await fs.readFile(wordsFile, "utf8"));

const summary = [
    "| Model | OK | Failed | Median latency, s | Mean cost | Total cost |",
    "| --- | --- | --- | --- | --- | --- |",
];

for (const model of models) {
    const settings = loadSettings(model);
    const dir = path.join(outDir, model.replace(/[/:]/g, "-"));
    await fs.mkdir(dir, { recursive: true });

    const outcomes = await mapLimit(words, concurrency, async (word, index): Promise<Outcome> => {
        let outcome: Outcome;
        try {
            outcome = {
                word,
                result: await requestCard(settings, languages, word.query, word.hint, postWithFetch),
            };
        } catch (error) {
            outcome = { word, error: error instanceof Error ? error.message : String(error) };
        }
        await fs.writeFile(
            path.join(dir, fileName(index, word.query)),
            JSON.stringify({ model, ...word, ...outcome.result, error: outcome.error }, null, 2) + "\n",
        );
        const status = outcome.result ? `${(outcome.result.latencyMs / 1000).toFixed(1)} s` : "failed";
        console.log(`${model} ${index + 1}/${words.length} ${word.query}: ${status}`);
        return outcome;
    });

    const report = [`# ${model}`, ""];
    const costs: number[] = [];
    outcomes.forEach(({ word, result, error }, index) => {
        report.push(`## ${index + 1}. ${word.query}${word.hint ? ` @${word.hint}` : ""}`, "");
        if (!result) {
            report.push(`Error: ${error}`, "");
            return;
        }
        const cost = costUsd(settings.model, result.usage);
        if (cost !== undefined) {
            costs.push(cost);
        }
        report.push(renderCard(result.card, languages), "");
        report.push(
            `_${(result.latencyMs / 1000).toFixed(1)} s, ${result.usage.promptTokens} prompt, ` +
                `${result.usage.completionTokens} completion (${result.usage.reasoningTokens} reasoning) tokens, ` +
                `${formatUsd(cost)}_`,
            "",
        );
    });
    await fs.writeFile(path.join(dir, "report.md"), report.join("\n"));

    const done = outcomes.filter((outcome) => outcome.result);
    const total = costs.length > 0 ? costs.reduce((sum, cost) => sum + cost, 0) : undefined;
    const latency = median(done.map((outcome) => outcome.result!.latencyMs)) / 1000;
    summary.push(
        `| ${model} | ${done.length} | ${outcomes.length - done.length} | ${latency.toFixed(1)} | ` +
            `${formatUsd(total === undefined ? undefined : total / costs.length)} | ${formatUsd(total)} |`,
    );
}

await fs.writeFile(path.join(outDir, "summary.md"), summary.join("\n") + "\n");
console.log(`\n${summary.join("\n")}`);
