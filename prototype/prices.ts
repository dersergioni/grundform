// Cost of a request. xAI reports it in the response; for OpenAI it comes from the price list
// in US dollars per million tokens for prompts under 272k tokens, from
// https://developers.openai.com/api/docs/pricing on 2026-10-30.

import type { Usage } from "../src/ai.ts";

const kOpenAiPrices: Record<string, { input: number; cachedInput: number; output: number }> = {
    "gpt-6-astra": { input: 10.0, cachedInput: 1.0, output: 50.0 },
    "gpt-6.1-sol": { input: 2.0, cachedInput: 0.1, output: 10.0 },
    "gpt-6.1-terra": { input: 1.0, cachedInput: 0.05, output: 5.0 },
    "gpt-6-luna": { input: 0.1, cachedInput: 0.01, output: 0.5 },
};

// Undefined when the response has no cost and the model has no price. OpenAI's completion
// tokens already include the reasoning tokens.
export function costUsd(model: string, usage: Usage): number | undefined {
    if (usage.costUsd !== undefined) {
        return usage.costUsd;
    }
    const price = kOpenAiPrices[model];
    if (!price) {
        return undefined;
    }
    const uncached = usage.promptTokens - usage.cachedPromptTokens;
    return (
        (uncached * price.input +
            usage.cachedPromptTokens * price.cachedInput +
            usage.completionTokens * price.output) /
        1_000_000
    );
}
