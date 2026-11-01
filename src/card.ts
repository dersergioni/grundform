// The word card returned by the AI: TypeScript types and the matching JSON schema.

export const kPartsOfSpeech = [
    "noun",
    "verb",
    "adjective",
    "adverb",
    "pronoun",
    "preposition",
    "conjunction",
    "particle",
    "interjection",
    "numeral",
    "determiner",
    "phrase",
    "other",
] as const;

export const kGenders = ["m", "f", "n", "mf", "none"] as const;

export type PartOfSpeech = (typeof kPartsOfSpeech)[number];
export type Gender = (typeof kGenders)[number];

export interface Equivalent {
    language: string;
    entry: string;
    lemma: string;
    gender: Gender;
    ipa: string;
    forms: string;
    alternatives: string[];
    // A short definition of the sense in the language of the equivalent.
    definition: string;
}

export interface ExampleSentence {
    language: string;
    text: string;
}

export interface Sense {
    part_of_speech: PartOfSpeech;
    equivalents: Equivalent[];
    examples: ExampleSentence[];
    notes: string[];
}

export interface OtherReading {
    language: string;
    lemma: string;
    gloss: string;
}

export interface WordCard {
    found: boolean;
    suggestions: string[];
    query_language: string;
    lemma: string;
    // The grammatical form of an inflected query, such as "conditional, 1st and 2nd person singular"; empty when the
    // query is the lemma.
    query_form: string;
    senses: Sense[];
    other_readings: OtherReading[];
}

type Schema = Record<string, unknown>;

// Every property is required and no others are allowed, as strict structured outputs expect.
function objectSchema(properties: Record<string, Schema>): Schema {
    return {
        type: "object",
        properties,
        required: Object.keys(properties),
        additionalProperties: false,
    };
}

function described(schema: Schema, description: string): Schema {
    return { ...schema, description };
}

export function buildCardSchema(languages: readonly string[]): Schema {
    const language: Schema = { type: "string", enum: [...languages] };
    const text: Schema = { type: "string" };
    const textList: Schema = { type: "array", items: text };

    const equivalent = objectSchema({
        language,
        entry: described(text, "The equivalent written as a dictionary entry, following the rules of its language."),
        lemma: described(text, "The bare dictionary form without article or hints."),
        gender: described({ type: "string", enum: [...kGenders] }, "Grammatical gender of a noun; none otherwise."),
        ipa: described(text, "Transcription of the lemma in square brackets."),
        forms: described(text, "Key forms a learner needs, or an empty string."),
        alternatives: described(textList, "Up to two other common equivalents for this sense."),
        definition: described(text, "A short definition of the sense in the language of this equivalent."),
    });

    const sense = objectSchema({
        part_of_speech: { type: "string", enum: [...kPartsOfSpeech] },
        equivalents: described(
            { type: "array", items: equivalent },
            "Exactly one equivalent per language, in the order of the language list.",
        ),
        examples: described(
            { type: "array", items: objectSchema({ language, text }) },
            "One sentence in the query language, then its translation into each other language.",
        ),
        notes: described(textList, "Up to two short English hints against typical mistakes."),
    });

    return objectSchema({
        found: described({ type: "boolean" }, "False if the query is not a word or phrase of any listed language."),
        suggestions: described(textList, "Up to three spelling suggestions when found is false."),
        query_language: language,
        lemma: described(text, "Dictionary form of the query in the query language."),
        query_form: described(
            text,
            "The grammatical form of an inflected query in a few English words; an empty string when the query is the lemma.",
        ),
        senses: { type: "array", items: sense },
        other_readings: described(
            { type: "array", items: objectSchema({ language, lemma: text, gloss: text }) },
            "The same spelling as a word of another listed language, with a short English gloss.",
        ),
    });
}

export interface GenderMismatch {
    sense: number;
    genders: { language: string; gender: Gender }[];
}

// Senses whose noun equivalents have different genders in different languages. A noun of both genders, such as
// French "élève", agrees with either.
export function findGenderMismatches(card: WordCard): GenderMismatch[] {
    const mismatches: GenderMismatch[] = [];
    card.senses.forEach((sense, index) => {
        const genders = sense.equivalents
            .filter((equivalent) => equivalent.gender !== "none")
            .map((equivalent) => ({ language: equivalent.language, gender: equivalent.gender }));
        if (new Set(genders.map((item) => item.gender).filter((gender) => gender !== "mf")).size > 1) {
            mismatches.push({ sense: index, genders });
        }
    });
    return mismatches;
}
