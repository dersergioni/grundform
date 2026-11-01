// The languages a card can show: their names, flags and the conventions of their dictionary entries.
// The plugin settings offer only these languages; the prototype also takes other codes, which get a generic rule
// in the prompt. English comes as British or American English, as the settings choose, and Russian as the learner's
// own language or as a language to learn.

// An SVG shape of a flag in a 30 by 20 viewBox.
export type Shape = [tag: string, attributes: Record<string, string>];

export interface Language {
    code: string;
    name: string;
    // The language tag of the voice that speaks it, with the region of the variant the cards write, such as en-GB.
    voice: string;
    // The variant of the language, such as "British" for English, which prompts about whole sentences name.
    variant?: string;
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

// The flag of the United States without its stars, which are too small to see at the size of a flag on the card.
function americanFlag(): Shape[] {
    const stripes = horizontalStripes(Array.from({ length: 13 }, (_, index) => (index % 2 ? "#ffffff" : "#b22234")));
    return [...stripes, ["rect", { width: "12", height: ((20 * 7) / 13).toFixed(2), fill: "#3c3b6e" }]];
}

// The rules of an English entry that the British and the American variant share.
const kEnglishEntryRules = `- entry of a verb: with "to", e.g. "to tell"; of a noun: without article, e.g. "house", never "the house";
- add a short hint in parentheses only when the bare entry would be ambiguous, e.g. "to know (facts)", "please (formal)";`;

// The rules of a Russian entry that Russian as the learner's own language and Russian as a language to learn share.
const kRussianEntryRules = `- entry of a noun: the nominative singular, or the plural for a sense Russian names in the plural, e.g. "деньги"; no gender marks; a feminine noun for a person that Russian lacks is the masculine noun with "(о женщине)", e.g. "пилот (о женщине)";
- entry of a verb: the infinitive of one verb in the aspect that fits the sense, usually the imperfective, e.g. "рассказывать", the perfective for a single completed result;
- entry of an adjective: the masculine nominative singular;
- a short hint in parentheses only when the bare entry would be ambiguous, e.g. "знать (факт)";`;

function genericRules(name: string): string {
    return `${name}:
- entries as a learner's dictionary writes them: a noun with its article where the language has one, a verb in the infinitive, an adjective in its base form;
- ipa: the standard pronunciation of the entry with stress marks;
- forms: the forms of an irregular word a learner needs; empty otherwise.`;
}

// Russian as the learner's own language, which needs neither a transcription nor forms.
const kRussian: Language = {
    code: "ru",
    name: "Russian",
    voice: "ru-RU",
    transcription: false,
    flag: horizontalStripes(["#ffffff", "#0039a6", "#d52b1e"]),
    rules: `Russian:
${kRussianEntryRules}
- ipa: an empty string;
- forms: an empty string.`,
};

export const kLanguages: Language[] = [
    kRussian,
    {
        code: "fr",
        name: "French",
        voice: "fr-FR",
        transcription: true,
        flag: verticalStripes(["#0055a4", "#ffffff", "#ef4135"]),
        rules: `French:
- entry of a noun: the full definite article without elision and the noun, e.g. "le hôtel", never "l'hôtel"; an irregular plural after a comma, e.g. "le œil, les yeux", a regular plural left out; a noun used only in the plural gets its gender in brackets, e.g. "les vacances [f]";
- entry of an adjective: masculine/feminine when they are spelled differently, e.g. "petit/petite", otherwise one form;
- entry of an article, a possessive or a demonstrative: every form separated by "<br>", e.g. "mon<br>ma<br>mes", "ce<br>cet<br>cette<br>ces";
- entry of a verb: the infinitive, a reflexive verb with "se", e.g. "se laver";
- ipa: the singular without article, a reflexive verb with its pronoun, e.g. "[sə lave]"; no stress marks and no syllable dots; [a] rather than [ɑ]; a liaison marked with ‿, e.g. "[ʒə vuz‿ɑ̃ pʁi]"; an adjective pronounced differently in the feminine as "[pəti/pətit]", one transcription when both forms sound the same, e.g. "[dezɔle]" for "désolé/désolée"; the forms of an article, possessive or demonstrative each in brackets, separated by "<br>", e.g. "[mɔ̃]<br>[ma]<br>[me]"; an apostrophe at the start marks h aspiré, e.g. "['aʃ]", and appears nowhere else;
- forms of a verb: the 3rd person singular present and the passé composé, e.g. "il retire, il a retiré"; add other irregular forms a learner needs; empty for regular words of other parts of speech.`,
    },
    {
        code: "de",
        name: "German",
        voice: "de-DE",
        transcription: true,
        flag: horizontalStripes(["#000000", "#dd0000", "#ffce00"]),
        rules: `German:
- entry of a noun: article and singular, then article and plural, e.g. "der Apfel, die Äpfel", also when German is not the query language; "[sg]" after a noun without plural, e.g. "der Senf [sg]"; "[pl]" after a plural-only noun, e.g. "die Ferien [pl]";
- entry of a verb: the infinitive, a reflexive verb with "sich", e.g. "sich waschen";
- entry of an article, a possessive or a demonstrative: every distinct form separated by "<br>", e.g. "mein<br>meine", "dieser<br>diese<br>dieses";
- entry of an adjective or another word: the base form, lowercase unless it is a noun;
- ipa: the singular without article, a reflexive verb with "sich", e.g. "[zɪç ˈvaʃn̩]"; a stress mark on words of two or more syllables and none on one-syllable words, e.g. "[baʊ̯m]"; a secondary stress in compounds; the glottal stop ʔ before a vowel that starts a stem inside the word, never at the start of the word; no syllable dots; tied affricates (t͡s, t͡ʃ, p͡f) except across a morpheme boundary; r as ʁ after a short vowel, e.g. "[ˈkaʁtə]", vocalic r as ɐ̯ after a long vowel and in the prefixes er-, ver-, zer-, e.g. "[fɛɐ̯ˈkaʊ̯fn̩]"; syllabic n̩ and l̩ after a consonant, but [çən] in diminutives in -chen, e.g. "[ˈmɛːtçən]"; diphthongs aɪ̯, aʊ̯, ɔʏ̯; the forms of an article, possessive or demonstrative each in brackets, separated by "<br>", e.g. "[maɪ̯n]<br>[ˈmaɪ̯nə]"; e.g. "[ˈanˌʁuːfn̩]";
- forms of a verb: the 3rd person singular present, the preterite and the perfect, e.g. "ruft an, rief an, hat angerufen"; forms of an adjective with irregular comparison, e.g. "besser, am besten"; empty otherwise.`,
    },
    {
        code: "en",
        name: "English",
        voice: "en-GB",
        transcription: true,
        variant: "British",
        // The flag of the variant, as the words and the transcriptions follow it.
        flag: [
            ["rect", { width: "30", height: "20", fill: "#012169" }],
            ["path", { d: kUnionDiagonals, stroke: "#ffffff", "stroke-width": "4" }],
            ["path", { d: kUnionDiagonals, stroke: "#c8102e", "stroke-width": "1.5" }],
            ["path", { d: kUnionCross, stroke: "#ffffff", "stroke-width": "6" }],
            ["path", { d: kUnionCross, stroke: "#c8102e", "stroke-width": "3.5" }],
        ],
        rules: `English:
- British English words and spellings, e.g. "lift", "flat", "pavement", "colour", "centre"; -ize spellings such as "organize" stay;
${kEnglishEntryRules}
- ipa: British pronunciation in the symbols of British learner's dictionaries (r, e, eə, no syllable dots), without the "to" of a verb and without hints; a stress mark on words of two or more syllables and none on one-syllable words, e.g. "[ɡəʊ]", "[ˈwɔːtə]"; a phrase word by word with a stress mark on every content word and weak forms of unstressed function words, e.g. "[baɪ ðə ˈweɪ]"; a function word on its own in its strong form, e.g. "[ðiː]"; synonyms after a comma in one pair of brackets, e.g. "[kɑːm, ˈkwaɪət]" for "calm, quiet";
- forms: an irregular verb's base form, past tense and past participle, e.g. "write, wrote, written", or an irregular plural, e.g. "children"; empty otherwise.`,
    },
    {
        code: "es",
        name: "Spanish",
        voice: "es-ES",
        transcription: true,
        flag: horizontalStripes(["#aa151b", "#f1bf00", "#aa151b"], [1, 2, 1]),
        rules: `Spanish:
- entry of a noun: the definite article and the singular, e.g. "el libro", "la mesa"; a feminine noun that takes "el" before a stressed a gets its gender in brackets, e.g. "el agua [f]"; a noun of both genders has both articles, e.g. "el/la estudiante"; an irregular plural after a comma, e.g. "el carácter, los caracteres", a regular plural left out;
- entry of an adjective: masculine/feminine when they are spelled differently, e.g. "rápido/rápida", otherwise one form, e.g. "feliz";
- entry of an article, a possessive or a demonstrative: every distinct form separated by "<br>", e.g. "mi<br>mis", "este<br>esta<br>estos<br>estas";
- entry of a verb: the infinitive, a reflexive verb with "-se", e.g. "lavarse";
- ipa: the singular without article in the phonemic transcription of the Spanish of Spain, as Wiktionary gives it: θ for c before e and i and for z, x for j, ʝ for ll and for y before a vowel, ɾ for the tap and r for the trill, as in "[ˈpeɾo]" for "pero" and "[ˈpero]" for "perro", b, d and ɡ without approximant marks; a stress mark on words of two or more syllables and none on one-syllable words, e.g. "[ˈθjelo]", "[ˈxoben]", "[muˈxeɾ]"; no syllable dots;
- forms of a verb: for an irregular verb or a verb with a stem change, the 1st person singular of the present and of the preterite and the past participle, e.g. "tengo, tuve, tenido", "pienso, pensé, pensado"; forms of an adjective with irregular comparison, e.g. "mejor"; empty otherwise.`,
    },
    {
        code: "it",
        name: "Italian",
        voice: "it-IT",
        transcription: true,
        flag: verticalStripes(["#009246", "#ffffff", "#ce2b37"]),
        rules: `Italian:
- entry of a noun: the definite article and the singular, e.g. "il libro", "lo studente", "la casa"; before a vowel the elided article with the gender in brackets, e.g. "l'albero [m]", "l'amica [f]"; a noun of both genders has both articles, e.g. "il/la cantante", "l'artista [m/f]"; an irregular plural with its article after a comma, e.g. "l'uomo [m], gli uomini", "il braccio, le braccia", "la mano, le mani", a regular plural left out;
- entry of an adjective: masculine/feminine when they are spelled differently, e.g. "rapido/rapida", otherwise one form, e.g. "felice";
- entry of an article, a possessive or a demonstrative: every distinct form separated by "<br>", a possessive with its article, e.g. "il mio<br>la mia<br>i miei<br>le mie", "questo<br>questa<br>questi<br>queste";
- entry of a verb: the infinitive, a reflexive verb with "-si", e.g. "lavarsi";
- ipa: the singular without article in the phonemic transcription of standard Italian, as Wiktionary gives it: open ɛ and ɔ apart from closed e and o, a double consonant written twice, tied affricates t͡ʃ, d͡ʒ, t͡s and d͡z, a double affricate with its first consonant doubled, e.g. "[ˈbratt͡ʃo]", "[ˈɔdd͡ʒi]"; a stress mark on words of two or more syllables and none on one-syllable words, e.g. "[ˈt͡ʃɛlo]", "[ˈalbero]", "[ˈd͡zio]"; no syllable dots;
- forms of a verb: the 1st person singular of the present and the passato prossimo with its auxiliary, e.g. "vado, sono andato", "capisco, ho capito"; forms of an adjective with irregular comparison, e.g. "migliore, ottimo"; empty otherwise.`,
    },
    {
        code: "nl",
        name: "Dutch",
        voice: "nl-NL",
        transcription: true,
        flag: horizontalStripes(["#ae1c28", "#ffffff", "#21468b"]),
        rules: genericRules("Dutch"),
    },
    {
        code: "pl",
        name: "Polish",
        voice: "pl-PL",
        transcription: true,
        flag: horizontalStripes(["#ffffff", "#dc143c"]),
        rules: genericRules("Polish"),
    },
    {
        code: "uk",
        name: "Ukrainian",
        voice: "uk-UA",
        transcription: true,
        flag: horizontalStripes(["#0057b7", "#ffd700"]),
        rules: genericRules("Ukrainian"),
    },
];

const kAmericanEnglish: Language = {
    code: "en",
    name: "English",
    voice: "en-US",
    transcription: true,
    variant: "American",
    flag: americanFlag(),
    rules: `English:
- American English words and spellings, e.g. "elevator", "apartment", "sidewalk", "color", "center";
${kEnglishEntryRules}
- ipa: General American pronunciation in the symbols of American learner's dictionaries (r after a vowel, oʊ, ɑː, ɝː and ɚ, no flap mark, no syllable dots), without the "to" of a verb and without hints; a stress mark on words of two or more syllables and none on one-syllable words, e.g. "[ɡoʊ]", "[ˈwɑːtɚ]"; a phrase word by word with a stress mark on every content word and weak forms of unstressed function words, e.g. "[baɪ ðə ˈweɪ]"; a function word on its own in its strong form, e.g. "[ðiː]"; synonyms after a comma in one pair of brackets, e.g. "[kɑːm, ˈkwaɪət]" for "calm, quiet";
- forms: an irregular verb's base form, past tense and past participle, e.g. "write, wrote, written", or an irregular plural, e.g. "children"; empty otherwise.`,
};

// Russian as a language to learn: a transcription that shows the stress and the reduced vowels, and the forms whose
// stress or stem a learner cannot guess.
const kLearnedRussian: Language = {
    ...kRussian,
    transcription: true,
    rules: `Russian:
${kRussianEntryRules}
- ipa: the pronunciation of the entry as Wiktionary gives it: a stress mark on words of two or more syllables and none on one-syllable words, reduced unstressed vowels, palatalized consonants with ʲ and the hard l as ɫ, e.g. "[məɫɐˈko]", "[pʲɪˈsatʲ]", "[dom]"; no syllable dots; a phrase word by word with a stress mark on every content word;
- forms of a verb: the 1st and 2nd person singular of the present, or of the future for a perfective verb, then the verb of the other aspect after "pf." or "ipf." when it has one, e.g. "пишу́, пи́шешь; pf. написа́ть"; forms of a noun: the genitive singular and the nominative plural when the stem or the stress changes, e.g. "отца́, отцы́", "дру́га, друзья́"; an acute accent on the stressed vowel of every form of two or more syllables, none on ё; empty otherwise.`,
};

export type EnglishVariant = "british" | "american";

export const kEnglishVariants: readonly EnglishVariant[] = ["british", "american"];

// The language of what the model explains: the notes against mistakes, the form of an inflected query and the glosses
// of words spelled alike. "native" writes them in the learner's own language, "english" in English.
export type Explanations = "english" | "native";

export const kExplanationChoices: readonly Explanations[] = ["english", "native"];

// The settings of the learner that change how the cards write their languages. The plugin sets them here once for
// every module, as the language of the system would be; the prototype takes them from .env.
export interface Learner {
    // The variant of English that the cards write, show and speak.
    english: EnglishVariant;
    // The code of the learner's own language, which the cards write as for a native speaker: Russian without a
    // transcription and forms.
    native: string;
    explanations: Explanations;
}

let learner: Learner = { english: "british", native: "", explanations: "english" };

export function setLearner(settings: Learner): void {
    learner = { ...settings };
}

export function currentEnglishVariant(): EnglishVariant {
    return learner.english;
}

// The name of the language the model explains in, such as "Russian": English unless the learner chose their own.
export function explanationLanguage(): string {
    return learner.explanations === "native" && learner.native ? languageName(learner.native) : "English";
}

export function findLanguage(code: string): Language | undefined {
    if (code === "en" && learner.english === "american") {
        return kAmericanEnglish;
    }
    if (code === "ru" && learner.native !== "ru") {
        return kLearnedRussian;
    }
    return kLanguages.find((language) => language.code === code);
}

// The name of a language with its variant, such as "British English", for prompts about whole sentences.
export function languageVariantName(code: string): string {
    const language = findLanguage(code);
    return language?.variant ? `${language.variant} ${language.name}` : languageName(code);
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
