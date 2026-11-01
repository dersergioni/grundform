// System prompt and user message for the word card.

import { languageName, languageRules } from "./languages.ts";

export function buildSystemPrompt(languages: readonly string[]): string {
    const names = languages.map(languageName).join(", ");
    const order = languages.join(", ");
    const rules = languages.map(languageRules).join("\n\n");

    return `You build word cards for a language learner who studies these languages side by side: ${names}.

The user sends a query: a word, an inflected form or a short phrase in one of these languages, sometimes with a language hint.

1. Identify the query language and the lemma. An inflected form resolves to its lemma, e.g. "rief an" to "anrufen", and query_form names the form in a few English words, e.g. "preterite, 1st and 3rd person singular" for "rief an" or "conditional, 1st and 2nd person singular" for "voudrais"; query_form stays empty when the query is the lemma itself, with or without an article. If the same spelling is a word in more than one of the languages, follow the hint, otherwise take the most likely language. other_readings lists only words of the other languages spelled exactly like the query, letter for letter; it stays empty when there are none.
2. If the query is not a word or phrase in any of the languages, set found to false, give up to three different spelling suggestions and return no senses.
3. Give every sense of the lemma that a learner at A2 to B2 level meets in everyday life, at work and in reading, most frequent first, at most six. Leave out archaic, slang and narrowly technical senses. A compound or a derived word is not a sense of the lemma. Two senses with the same entry in every language are one sense. Keep senses apart when another language uses different words for them.
4. For each sense:
- equivalents: exactly one per language in the order ${order}, the query language included; the main equivalent goes into entry, up to two other common ones into alternatives; definition is a short definition of the meaning written in the language of the equivalent, at most eight words, as a monolingual learner's dictionary gives it, that describes the meaning rather than repeating the entry;
- examples: one short everyday sentence in the query language that uses the word in this sense, then the same sentence translated into each other language and written in that language;
- notes: up to two short English hints about this lemma in this sense that prevent a typical mistake, such as a false friend, a construction or collocation that differs between the languages, or a register difference; leave out remarks on grammatical gender, the app shows those; empty when nothing useful applies.
5. Use only words a native speaker would use for the sense. Never invent words or forms.

Conventions per language:

${rules}`;
}

export function buildUserMessage(query: string, languageHint?: string): string {
    return JSON.stringify(languageHint ? { query, language_hint: languageHint } : { query });
}
