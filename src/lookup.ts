// A lookup: the card from the model, then its check against Wiktionary.

import { type AiSettings, type CardResult, type PostJson, requestCard } from "./ai.ts";
import { type Equivalent, withoutRegularPlural } from "./card.ts";
import { checkCard, type GetText, uncheckedEquivalents } from "./wiktionary.ts";

// A card from the model after the check against Wiktionary.
export interface CardLookup extends CardResult {
    // German and French equivalents whose transcription Wiktionary does not confirm.
    unchecked: ReadonlySet<Equivalent>;
    // "none" for a card without German or French words, which the check skips.
    wiktionary: "checked" | "unavailable" | "none";
    // Set when the card comes from the cache of earlier lookups.
    cached?: boolean;
}

// A French regular plural that the model adds is dropped, as the dictionary writes only irregular ones. A failed check
// leaves the card as the model gave it, with every German and French transcription unconfirmed.
export async function lookUpCard(
    ai: AiSettings,
    languages: readonly string[],
    query: string,
    languageHint: string | undefined,
    post: PostJson,
    get: GetText,
): Promise<CardLookup> {
    const result = await requestCard(ai, languages, query, languageHint, post);
    for (const equivalent of result.card.senses.flatMap((sense) => sense.equivalents)) {
        if (equivalent.language === "fr") {
            equivalent.entry = withoutRegularPlural(equivalent.entry);
        }
    }
    if (uncheckedEquivalents(result.card).size === 0) {
        return { ...result, unchecked: new Set(), wiktionary: "none" };
    }
    try {
        const check = await checkCard(result.card, get);
        return { ...result, unchecked: check.unchecked, wiktionary: "checked" };
    } catch (error) {
        console.warn("grundform: the Wiktionary check failed", error);
        return { ...result, unchecked: uncheckedEquivalents(result.card), wiktionary: "unavailable" };
    }
}
