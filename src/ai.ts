// Requests a word card, or other structured answers, from an OpenAI-compatible chat completions API.

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

// A chat completions request whose answer follows the JSON schema.
export function buildChatRequest(
    settings: Pick<AiSettings, "model" | "reasoningEffort">,
    system: string,
    user: string,
    name: string,
    schema: Record<string, unknown>,
) {
    return {
        model: settings.model,
        ...(settings.reasoningEffort ? { reasoning_effort: settings.reasoningEffort } : {}),
        messages: [
            { role: "system", content: system },
            { role: "user", content: user },
        ],
        response_format: { type: "json_schema", json_schema: { name, strict: true, schema } },
    };
}

export function buildCardRequest(
    settings: Pick<AiSettings, "model" | "reasoningEffort">,
    languages: readonly string[],
    query: string,
    languageHint?: string,
) {
    return buildChatRequest(
        settings,
        buildSystemPrompt(languages),
        buildUserMessage(query, languageHint),
        "word_card",
        buildCardSchema(languages),
    );
}

// Sends a request that buildChatRequest made and returns its answer as parsed JSON; what names the answer in errors.
export async function requestJson(
    settings: AiSettings,
    body: unknown,
    post: PostJson,
    what: string,
    timeoutMs = kTimeoutMs,
): Promise<{ value: unknown; usage: Usage; rawUsage: unknown; latencyMs: number }> {
    const started = performance.now();
    // A local server such as Ollama or LM Studio needs no key, and the request then goes without one.
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (settings.apiKey) {
        headers["Authorization"] = `Bearer ${settings.apiKey}`;
    }
    const { status, text } = await post(
        `${settings.baseUrl}/chat/completions`,
        headers,
        JSON.stringify(body),
        timeoutMs,
    );
    const latencyMs = Math.round(performance.now() - started);
    if ((status === 401 || status === 403) && !settings.apiKey) {
        throw new Error("The provider asks for an API key: put it into the grundform settings.");
    }
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
        value: parseJson(content, what),
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

export async function requestCard(
    settings: AiSettings,
    languages: readonly string[],
    query: string,
    languageHint: string | undefined,
    post: PostJson,
): Promise<CardResult> {
    const body = buildCardRequest(settings, languages, query, languageHint);
    const { value, ...result } = await requestJson(settings, body, post, "The card");
    return { card: value as WordCard, ...result };
}
