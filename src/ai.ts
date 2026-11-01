// Requests a word card from an OpenAI-compatible chat completions API.

import { buildCardSchema, type WordCard } from "./card.ts";
import { buildSystemPrompt, buildUserMessage } from "./prompt.ts";

export interface AiSettings {
    baseUrl: string;
    apiKey: string;
    model: string;
    // The reasoning_effort value, such as "none" or "low"; undefined leaves the parameter out.
    reasoningEffort?: string;
}

export interface Usage {
    promptTokens: number;
    cachedPromptTokens: number;
    // OpenAI includes reasoning tokens in completion tokens; xAI counts them apart and bills both.
    completionTokens: number;
    reasoningTokens: number;
    // Exact cost from xAI's usage.cost_in_usd_ticks, undefined for other providers.
    costUsd: number | undefined;
}

export interface CardResult {
    card: WordCard;
    usage: Usage;
    rawUsage: unknown;
    latencyMs: number;
}

// Sends a JSON POST request and returns the status and the body; fails after timeoutMs.
export type PostJson = (
    url: string,
    headers: Record<string, string>,
    body: string,
    timeoutMs: number,
) => Promise<{ status: number; text: string }>;

// The parts of a chat completions response that the plugin reads; a provider may leave any of them out.
interface ChatResponse {
    choices?: { message?: { content?: unknown; refusal?: unknown }; finish_reason?: unknown }[];
    usage?: {
        prompt_tokens?: number;
        prompt_tokens_details?: { cached_tokens?: number };
        completion_tokens?: number;
        completion_tokens_details?: { reasoning_tokens?: number };
        cost_in_usd_ticks?: unknown;
    };
}

const kTimeoutMs = 120_000;
const kTicksPerUsd = 10_000_000_000;

// The message of an API error body such as {"error": {"message": "..."}}, or else the start of the body.
function errorMessage(text: string): string {
    try {
        const message = (JSON.parse(text) as { error?: { message?: unknown } } | null)?.error?.message;
        if (typeof message === "string") {
            return message;
        }
    } catch {
        // The body is not JSON.
    }
    return text.slice(0, 300);
}

function parseJson(text: string, what: string): unknown {
    try {
        return JSON.parse(text);
    } catch {
        throw new Error(`${what} is not valid JSON: ${text.slice(0, 200)}`);
    }
}

export function buildCardRequest(
    settings: Pick<AiSettings, "model" | "reasoningEffort">,
    languages: readonly string[],
    query: string,
    languageHint?: string,
) {
    return {
        model: settings.model,
        ...(settings.reasoningEffort ? { reasoning_effort: settings.reasoningEffort } : {}),
        messages: [
            { role: "system", content: buildSystemPrompt(languages) },
            { role: "user", content: buildUserMessage(query, languageHint) },
        ],
        response_format: {
            type: "json_schema",
            json_schema: { name: "word_card", strict: true, schema: buildCardSchema(languages) },
        },
    };
}

export async function requestCard(
    settings: AiSettings,
    languages: readonly string[],
    query: string,
    languageHint: string | undefined,
    post: PostJson,
): Promise<CardResult> {
    const body = buildCardRequest(settings, languages, query, languageHint);
    const started = performance.now();
    const { status, text } = await post(
        `${settings.baseUrl}/chat/completions`,
        { "Content-Type": "application/json", Authorization: `Bearer ${settings.apiKey}` },
        JSON.stringify(body),
        kTimeoutMs,
    );
    const latencyMs = Math.round(performance.now() - started);
    if (status < 200 || status >= 300) {
        throw new Error(`HTTP ${status}: ${errorMessage(text)}`);
    }

    const data = (parseJson(text, "The API response") ?? {}) as ChatResponse;
    const choice = data.choices?.[0];
    if (typeof choice?.message?.refusal === "string" && choice.message.refusal) {
        throw new Error(`The model refused: ${choice.message.refusal}`);
    }
    if (choice?.finish_reason === "length") {
        throw new Error("The answer was cut off at the token limit.");
    }
    const content = choice?.message?.content;
    if (typeof content !== "string") {
        throw new Error(`No message content in the response: ${text.slice(0, 300)}`);
    }

    return {
        card: parseJson(content, "The card") as WordCard,
        usage: {
            promptTokens: data.usage?.prompt_tokens ?? 0,
            cachedPromptTokens: data.usage?.prompt_tokens_details?.cached_tokens ?? 0,
            completionTokens: data.usage?.completion_tokens ?? 0,
            reasoningTokens: data.usage?.completion_tokens_details?.reasoning_tokens ?? 0,
            costUsd:
                typeof data.usage?.cost_in_usd_ticks === "number"
                    ? data.usage.cost_in_usd_ticks / kTicksPerUsd
                    : undefined,
        },
        rawUsage: data.usage ?? null,
        latencyMs,
    };
}
