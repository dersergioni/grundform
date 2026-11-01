// Example sentences for a row of the dictionary in the study tab: one short sentence in each language of the row,
// translations of one another, each with the word of its language. One request gives the sentences of the whole row,
// and this device keeps them, so that the other languages of the row and a later visit show them at once.

import { type AiSettings, buildChatRequest, type PostJson, requestJson } from "./ai.ts";
import type { ExampleSentence } from "./card.ts";
import { currentEnglishVariant, languageVariantName } from "./languages.ts";

// The entry of each language of a row, in the order of the columns.
export type RowWords = readonly (readonly [language: string, entry: string])[];

// Part of every key: raise it when the prompt or the schema changes, so that the rows get new sentences.
const kVersion = 1;
// The local storage of the device, which iCloud does not sync.
const kStorageKey = "grundform-examples";
const kMaxRows = 1000;
const kTimeoutMs = 30_000;

interface StoredExamples {
    time: number;
    examples: ExampleSentence[];
}

function buildSystemPrompt(languages: readonly string[]): string {
    const names = languages.map(languageVariantName).join(", ");
    return `You write example sentences for a language learner who studies these languages side by side: ${names}.

The user sends one row of the learner's dictionary: the words of one sense, one per language, as the dictionary writes them. An entry may give several forms, such as "mon<br>ma<br>mes" or "der Abend, die Abende", and hints in brackets or parentheses about the sense or the construction.

Write one short everyday sentence at A2 to B1 level that uses the word in this sense, and give it in every language of the row, in the order of the row: the same sentence in each language, each with the word of its own language from the row, inflected as the sentence needs. Write each sentence as a native speaker would say it, without transcriptions, hints or quotation marks.`;
}

function buildSchema(languages: readonly string[]): Record<string, unknown> {
    const example = {
        type: "object",
        properties: { language: { type: "string", enum: [...languages] }, text: { type: "string" } },
        required: ["language", "text"],
        additionalProperties: false,
    };
    return {
        type: "object",
        properties: {
            examples: {
                type: "array",
                items: example,
                description: "The sentence in each language of the row, in the order of the row.",
            },
        },
        required: ["examples"],
        additionalProperties: false,
    };
}

export async function requestExamples(ai: AiSettings, words: RowWords, post: PostJson): Promise<ExampleSentence[]> {
    const languages = words.map(([language]) => language);
    const user = JSON.stringify({
        words: words.map(([language, entry]) => ({ language, entry: entry.replace(/\\\|/g, "|") })),
    });
    const body = buildChatRequest(ai, buildSystemPrompt(languages), user, "row_examples", buildSchema(languages));
    const { value } = await requestJson(ai, body, post, "The examples", kTimeoutMs);
    const items = (value as { examples?: unknown } | null)?.examples;
    const examples = (Array.isArray(items) ? (items as Partial<ExampleSentence>[]) : []).flatMap((item) =>
        typeof item.language === "string" && languages.includes(item.language) && typeof item.text === "string"
            ? [{ language: item.language, text: item.text.trim() }]
            : [],
    );
    if (!examples.some((item) => item.text)) {
        throw new Error("The model gave no example.");
    }
    return examples;
}

// American English sentences have keys of their own, while British ones keep the keys they had before English
// had a choice of variant.
function examplesKey(words: RowWords): string {
    const american = currentEnglishVariant() === "american" && words.some(([language]) => language === "en");
    return `${kVersion}${american ? "|en-US" : ""}|${words.map(([language, entry]) => `${language}=${entry}`).join("|")}`;
}

// The sentences of the rows, kept in the local storage of this device, up to 1000 rows; the oldest go first.
export class ExampleCache {
    private rows: Record<string, StoredExamples> | undefined;
    // The requests under way, so that a row is not asked for twice at once.
    private readonly pending = new Map<string, Promise<ExampleSentence[]>>();

    private read(): Record<string, StoredExamples> {
        if (!this.rows) {
            try {
                const parsed = JSON.parse(window.localStorage.getItem(kStorageKey) ?? "{}") as unknown;
                this.rows = parsed && typeof parsed === "object" ? (parsed as Record<string, StoredExamples>) : {};
            } catch {
                this.rows = {};
            }
        }
        return this.rows;
    }

    private write(key: string, examples: ExampleSentence[]): void {
        const rows = this.read();
        rows[key] = { time: Date.now(), examples };
        const keys = Object.keys(rows);
        if (keys.length > kMaxRows) {
            keys.sort((a, b) => rows[a]!.time - rows[b]!.time)
                .slice(0, keys.length - kMaxRows)
                .forEach((old) => delete rows[old]);
        }
        try {
            window.localStorage.setItem(kStorageKey, JSON.stringify(rows));
        } catch (error) {
            // The sentences stay until Obsidian closes.
            console.warn("grundform: the examples were not kept", error);
        }
    }

    // The sentences this device keeps for the row.
    stored(words: RowWords): ExampleSentence[] | undefined {
        return this.read()[examplesKey(words)]?.examples;
    }

    // The sentences of the row from this device, or else from the model.
    get(ai: AiSettings, words: RowWords, post: PostJson): Promise<ExampleSentence[]> {
        const key = examplesKey(words);
        const stored = this.read()[key];
        if (stored) {
            return Promise.resolve(stored.examples);
        }
        let request = this.pending.get(key);
        if (!request) {
            request = requestExamples(ai, words, post)
                .then((examples) => {
                    this.write(key, examples);
                    return examples;
                })
                .finally(() => this.pending.delete(key));
            this.pending.set(key, request);
        }
        return request;
    }
}
