// The languages a card can show: their names, flags and the conventions of their dictionary entries.
// The plugin settings offer only these languages; the prototype also takes other codes, which get a generic rule
// in the prompt.

// An SVG shape of a flag in a 30 by 20 viewBox.
export type Shape = [tag: string, attributes: Record<string, string>];

export interface Language {
    code: string;
    name: string;
    flag: Shape[];
    // Whether a new dictionary gets a transcription column for the language.
    transcription: boolean;
    // Entry, transcription and forms conventions for the prompt.
    rules: string;
}

function horizontalStripes(colors: string[], weights: number[] = colors.map(() => 1)): Shape[] {
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    let y = 0;
    return colors.map((fill, index) => {
        const height = (20 * weights[index]!) / total;
        const shape: Shape = ["rect", { y: y.toFixed(2), width: "30", height: height.toFixed(2), fill }];
        y += height;
        return shape;
    });
}

function verticalStripes(colors: string[]): Shape[] {
    return colors.map((fill, index) => ["rect", { x: String(index * 10), width: "10", height: "20", fill }]);
}

const kUnionDiagonals = "M0,0 L30,20 M30,0 L0,20";
const kUnionCross = "M15,0 V20 M0,10 H30";

function genericRules(name: string): string {
    return `${name}:
- entries as a learner's dictionary writes them: a noun with its article where the language has one, a verb in the infinitive, an adjective in its base form;
- ipa: the standard pronunciation of the entry with stress marks;
- forms: the forms of an irregular word a learner needs; empty otherwise.`;
}

export const kLanguages: Language[] = [
    {
        code: "ru",
        name: "Russian",
        transcription: false,
        flag: horizontalStripes(["#ffffff", "#0039a6", "#d52b1e"]),
        rules: `Russian:
- entry of a noun: the nominative singular, or the plural for a sense Russian names in the plural, e.g. "деньги"; no gender marks; a feminine noun for a person that Russian lacks is the masculine noun with "(о женщине)", e.g. "пилот (о женщине)";
- entry of a verb: the infinitive of one verb in the aspect that fits the sense, usually the imperfective, e.g. "рассказывать", the perfective for a single completed result;
- entry of an adjective: the masculine nominative singular;
- a short hint in parentheses only when the bare entry would be ambiguous, e.g. "знать (факт)";
- ipa: an empty string;
- forms: an empty string.`,
    },
    {
        code: "fr",
        name: "French",
        transcription: true,
        flag: verticalStripes(["#0055a4", "#ffffff", "#ef4135"]),
        rules: `French:
- entry of a noun: the full definite article without elision and the noun, e.g. "le hôtel", never "l'hôtel"; an irregular plural after a comma, e.g. "le œil, les yeux", a regular plural left out; a noun used only in the plural gets its gender in brackets, e.g. "les vacances [f]";
- entry of an adjective: masculine/feminine when they differ, e.g. "petit/petite", otherwise one form;
- entry of a verb: the infinitive, a reflexive verb with "se", e.g. "se laver";
- ipa: the singular without article, a reflexive verb with its pronoun, e.g. "[sə lave]"; no stress marks and no syllable dots; [a] rather than [ɑ]; an adjective pronounced differently in the feminine as "[pəti/pətit]"; an apostrophe at the start marks h aspiré, e.g. "['aʃ]", and appears nowhere else;
- forms of a verb: the 3rd person singular present and the passé composé, e.g. "il retire, il a retiré"; add other irregular forms a learner needs; empty for regular words of other parts of speech.`,
    },
    {
        code: "de",
        name: "German",
        transcription: true,
        flag: horizontalStripes(["#000000", "#dd0000", "#ffce00"]),
        rules: `German:
- entry of a noun: article and singular, then article and plural, e.g. "der Apfel, die Äpfel", also when German is not the query language; "[sg]" after a noun without plural, e.g. "der Senf [sg]"; "[pl]" after a plural-only noun, e.g. "die Ferien [pl]";
- entry of a verb: the infinitive, a reflexive verb with "sich", e.g. "sich waschen";
- entry of an adjective or another word: the base form, lowercase unless it is a noun;
- ipa: the singular without article, a reflexive verb with "sich", e.g. "[zɪç ˈvaʃn̩]"; a stress mark on words of two or more syllables and none on one-syllable words, e.g. "[baʊ̯m]"; a secondary stress in compounds; the glottal stop ʔ before a vowel that starts a stem inside the word, never at the start of the word; no syllable dots; tied affricates (t͡s, t͡ʃ, p͡f) except across a morpheme boundary; r as ʁ after a short vowel, e.g. "[ˈkaʁtə]", vocalic r as ɐ̯ after a long vowel and in the prefixes er-, ver-, zer-, e.g. "[fɛɐ̯ˈkaʊ̯fn̩]"; syllabic n̩ and l̩; diphthongs aɪ̯, aʊ̯, ɔʏ̯; e.g. "[ˈanˌʁuːfn̩]";
- forms of a verb: the 3rd person singular present, the preterite and the perfect, e.g. "ruft an, rief an, hat angerufen"; forms of an adjective with irregular comparison, e.g. "besser, am besten"; empty otherwise.`,
    },
    {
        code: "en",
        name: "English",
        transcription: true,
        // The British flag, as the transcriptions are British.
        flag: [
            ["rect", { width: "30", height: "20", fill: "#012169" }],
            ["path", { d: kUnionDiagonals, stroke: "#ffffff", "stroke-width": "4" }],
            ["path", { d: kUnionDiagonals, stroke: "#c8102e", "stroke-width": "1.5" }],
            ["path", { d: kUnionCross, stroke: "#ffffff", "stroke-width": "6" }],
            ["path", { d: kUnionCross, stroke: "#c8102e", "stroke-width": "3.5" }],
        ],
        rules: `English:
- entry of a verb: with "to", e.g. "to tell"; of a noun: without article, e.g. "house", never "the house";
- add a short hint in parentheses only when the bare entry would be ambiguous, e.g. "to know (facts)", "please (formal)";
- ipa: British pronunciation in the symbols of British learner's dictionaries (r, e, eə, no syllable dots), without the "to" of a verb and without hints; a stress mark on words of two or more syllables and none on one-syllable words, e.g. "[ɡəʊ]", "[ˈwɔːtə]"; a phrase word by word with a stress mark on every content word and weak forms of unstressed function words, e.g. "[baɪ ðə ˈweɪ]";
- forms: an irregular verb's base form, past tense and past participle, e.g. "write, wrote, written", or an irregular plural, e.g. "children"; empty otherwise.`,
    },
    {
        code: "es",
        name: "Spanish",
        transcription: true,
        flag: horizontalStripes(["#aa151b", "#f1bf00", "#aa151b"], [1, 2, 1]),
        rules: genericRules("Spanish"),
    },
    {
        code: "it",
        name: "Italian",
        transcription: true,
        flag: verticalStripes(["#009246", "#ffffff", "#ce2b37"]),
        rules: genericRules("Italian"),
    },
    {
        code: "nl",
        name: "Dutch",
        transcription: true,
        flag: horizontalStripes(["#ae1c28", "#ffffff", "#21468b"]),
        rules: genericRules("Dutch"),
    },
    {
        code: "pl",
        name: "Polish",
        transcription: true,
        flag: horizontalStripes(["#ffffff", "#dc143c"]),
        rules: genericRules("Polish"),
    },
    {
        code: "uk",
        name: "Ukrainian",
        transcription: true,
        flag: horizontalStripes(["#0057b7", "#ffd700"]),
        rules: genericRules("Ukrainian"),
    },
];

export function findLanguage(code: string): Language | undefined {
    return kLanguages.find((language) => language.code === code);
}

export function languageName(code: string): string {
    return findLanguage(code)?.name ?? code;
}

export function languageRules(code: string): string {
    return findLanguage(code)?.rules ?? genericRules(languageName(code));
}

export const kDefaultLanguages = ["fr", "de", "en"];

// A card compares a word across languages, so it needs at least two.
export const kMinLanguages = 2;

// The card languages from saved settings. Unknown and repeated codes are dropped; fewer than two languages fall
// back to the defaults.
export function parseLanguages(value: unknown): string[] {
    const codes: unknown[] = Array.isArray(value) ? value : [];
    const known = codes
        .map((code) => String(code).trim().toLowerCase())
        .filter((code, index, all) => findLanguage(code) !== undefined && all.indexOf(code) === index);
    return known.length >= kMinLanguages ? known : [...kDefaultLanguages];
}
