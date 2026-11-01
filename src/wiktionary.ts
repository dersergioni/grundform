// Checks the German and French equivalents of a card against de.wiktionary.org and fr.wiktionary.org.
// A transcription that is not among the accepted ones there is replaced with the preferred one, and so are
// a wrong gender or plural of a German noun and a wrong gender of a French noun. A transcription that
// Wiktionary lacks, or pronounces differently for homographs, stays and is reported as unchecked.

import type { Equivalent, PartOfSpeech, WordCard } from "./card.ts";

// Sends a GET request and returns the status and the body; fails after timeoutMs.
export type GetText = (
    url: string,
    headers: Record<string, string>,
    timeoutMs: number,
) => Promise<{ status: number; text: string }>;

export interface CardCheck {
    // Equivalents of a checked language whose transcription Wiktionary does not give.
    unchecked: Set<Equivalent>;
}

// One entry of a word on a Wiktionary page, such as the masculine noun "der Leiter".
interface Lexeme {
    partOfSpeech: PartOfSpeech | "unknown";
    genders: string[];
    // Accepted transcriptions, the preferred first, in the format of the dictionary without brackets.
    ipas: string[];
    // German nouns: the accepted entries, the preferred first, such as "die Pizza, die Pizzas" and "die Pizza, die
    // Pizzen", "der Senf [sg]" or "die Leute [pl]", and the singular "der Mond".
    nounEntries: string[];
    nounSingular?: string;
    hAspire: boolean;
}

const kTimeoutMs = 10_000;
// Wikimedia asks clients to name themselves with a way to reach the author.
const kHeaders = { "Api-User-Agent": "grundform (https://github.com/dersergioni/grundform)" };
const kHosts: Record<string, string> = { de: "de.wiktionary.org", fr: "fr.wiktionary.org" };
const kGermanArticles: Record<string, string> = { m: "der", f: "die", n: "das" };

const kCheckedLanguages = Object.keys(kHosts);

// Raised whenever the check gives other results, so that the card cache asks again.
export const kCheckVersion = 2;

// A transcription that a page has not filled in yet, such as {{Lautschrift|…}}.
function isTranscription(ipa: string): boolean {
    return ipa !== "" && !/^[.…?\s]+$/.test(ipa);
}

// The equivalents of the checked languages, all unconfirmed, as when Wiktionary does not answer.
export function uncheckedEquivalents(card: WordCard): Set<Equivalent> {
    return new Set(
        card.senses.flatMap((sense) =>
            sense.equivalents.filter((equivalent) => kCheckedLanguages.includes(equivalent.language)),
        ),
    );
}

function germanPartOfSpeech(wortart: string): Lexeme["partOfSpeech"] {
    const name = wortart.toLowerCase();
    const parts: [string, PartOfSpeech][] = [
        ["substantiv", "noun"],
        // Before "verb", which "Adverb" also contains.
        ["adverb", "adverb"],
        ["verb", "verb"],
        ["adjektiv", "adjective"],
        ["pronomen", "pronoun"],
        ["präposition", "preposition"],
        ["konjunktion", "conjunction"],
        ["partikel", "particle"],
        ["interjektion", "interjection"],
        ["numerale", "numeral"],
        ["artikel", "determiner"],
        ["wortverbindung", "phrase"],
        ["redewendung", "phrase"],
    ];
    return parts.find(([key]) => name.includes(key))?.[1] ?? "unknown";
}

function frenchPartOfSpeech(section: string): Lexeme["partOfSpeech"] {
    if (section.startsWith("locution")) {
        return "phrase";
    }
    const parts: [string, PartOfSpeech][] = [
        ["nom", "noun"],
        ["verbe", "verb"],
        ["adjectif numéral", "numeral"],
        ["adjectif", "adjective"],
        ["adverbe", "adverb"],
        ["pronom", "pronoun"],
        ["préposition", "preposition"],
        ["conjonction", "conjunction"],
        ["particule", "particle"],
        ["interjection", "interjection"],
        ["article", "determiner"],
    ];
    return parts.find(([key]) => section.startsWith(key))?.[1] ?? "unknown";
}

// Each section that starts with a heading matching start and runs up to the next heading of the same level,
// such as "==" for a language or "===" for a part of speech.
function sections(text: string, start: RegExp, level: string): string[] {
    const blocks: string[][] = [];
    let current: string[] | undefined;
    for (const line of text.split("\n")) {
        if (start.test(line)) {
            current = [line];
            blocks.push(current);
        } else if (line.startsWith(`${level} `)) {
            current = undefined;
        } else {
            current?.push(line);
        }
    }
    return blocks.map((block) => block.join("\n"));
}

function parseGerman(text: string): Lexeme[] {
    const lexemes: Lexeme[] = [];
    for (const language of sections(text, /^== .*\{\{Sprache\|Deutsch\}\}/, "==")) {
        for (const block of sections(language, /^=== \{\{Wortart\|[^|}]+\|Deutsch\}\}/, "===")) {
            const wortart = block.match(/^=== \{\{Wortart\|([^|}]+)\|Deutsch\}\}/)?.[1] ?? "";
            if (/Deklinierte Form|Konjugierte Form|Partizip|Komparativ|Superlativ/.test(wortart)) {
                continue;
            }
            const genera = [...block.matchAll(/^\|Genus(?: \d)?=([mfn0])\s*$/gm)].map((match) => match[1]!);
            const genders = genera.filter((genus) => genus !== "0");
            const singular = block.match(/^\|Nominativ Singular(?: 1)?=(.*)$/m)?.[1]?.trim();
            // A noun can have several plurals, as "Pizzas" and "Pizzen" for "die Pizza".
            const plurals = [...block.matchAll(/^\|Nominativ Plural(?: \d|\*)?=(.*)$/gm)]
                .map((match) => match[1]!.trim())
                .filter((plural) => plural !== "" && plural !== "—");
            const ipaLine = block.match(/^:\{\{IPA\}\}(.*)$/m)?.[1] ?? "";
            const ipas = [...ipaLine.matchAll(/\{\{Lautschrift\|([^}|]+)\}\}/g)]
                .map((match) => match[1]!.trim().replace(/ɔɪ̯/g, "ɔʏ̯"))
                .filter(isTranscription);
            const pluralOnly = genera.includes("0") && genders.length === 0;

            let nounEntries: string[] = [];
            let nounSingular: string | undefined;
            const article = genders.length === 1 ? kGermanArticles[genders[0]!] : undefined;
            if (pluralOnly) {
                nounEntries = plurals.map((plural) => `die ${plural} [pl]`);
            } else if (article && singular && singular !== "—") {
                const single = `${article} ${singular}`;
                nounSingular = single;
                nounEntries =
                    plurals.length > 0 ? plurals.map((plural) => `${single}, die ${plural}`) : [`${single} [sg]`];
            }
            lexemes.push({
                partOfSpeech: germanPartOfSpeech(wortart),
                genders,
                ipas,
                nounEntries,
                ...(nounSingular ? { nounSingular } : {}),
                hAspire: false,
            });
        }
    }
    return lexemes;
}

// The transcriptions in the {{pron}} templates of a headword line, such as "pa.se" and "pɑ.se" in
// {{pron|pa.se|pɑ.se|fr}}, as the dictionary writes them: without syllable dots and with [a] for the oral [ɑ];
// the nasal [ɑ̃] stays.
function frenchPronunciations(headword: string): string[] {
    const ipas: string[] = [];
    for (const match of headword.matchAll(/\{\{pron\|([^}]*)\}\}/g)) {
        const parts = match[1]!.split("|").map((part) => part.trim());
        if (parts.includes("fr") || parts.includes("lang=fr")) {
            const variants = parts.filter((part) => part && part !== "fr" && !part.includes("="));
            ipas.push(
                ...variants.map((ipa) =>
                    ipa
                        .replace(/\./g, "")
                        .replace(/ɑ(?!\u0303)/g, "a")
                        .replace(/\s+/g, " "),
                ),
            );
        }
    }
    return ipas;
}

function parseFrench(text: string): Lexeme[] {
    const lexemes: Lexeme[] = [];
    for (const language of sections(text, /^== \{\{langue\|fr\}\} ==/, "==")) {
        for (const block of sections(language, /^=== \{\{S\|[^|}]+\|fr/, "===")) {
            const heading = block.match(/^=== \{\{S\|([^|}]+)\|fr([^}]*)\}\}/);
            if (!heading || heading[2]!.includes("flexion")) {
                continue;
            }
            const headword = block.split("\n").find((line) => line.startsWith("'''")) ?? "";
            lexemes.push({
                partOfSpeech: frenchPartOfSpeech(heading[1]!),
                genders: [...headword.matchAll(/\{\{(m|f|mf)\}\}/g)].map((match) => match[1]!),
                ipas: frenchPronunciations(headword).filter(isTranscription),
                nounEntries: [],
                hAspire: headword.includes("{{h aspiré"),
            });
        }
    }
    return lexemes;
}

// The Wiktionary page title of an equivalent: its lemma without article, reflexive pronoun or hint.
function pageTitle(language: string, equivalent: Equivalent): string {
    const lemma = equivalent.lemma.replace(/\s*\([^)]*\)/g, "").trim();
    return language === "de"
        ? lemma.replace(/^(der|die|das|sich)\s+/, "")
        : lemma.replace(/^(le|la|les|se)\s+/, "").replace(/^[ls]['’]/, "");
}

// The parts of a MediaWiki query answer that the check reads.
interface QueryResponse {
    error?: { info?: string; code?: string };
    query?: {
        normalized?: { from: string; to: string }[];
        redirects?: { from: string; to: string }[];
        pages?: { title: string; revisions?: { slots?: { main?: { content?: string } } }[] }[];
    };
}

async function fetchPages(language: string, titles: string[], get: GetText): Promise<Map<string, Lexeme[]>> {
    const params = new URLSearchParams({
        action: "query",
        prop: "revisions",
        rvprop: "content",
        rvslots: "main",
        format: "json",
        formatversion: "2",
        redirects: "1",
        titles: titles.join("|"),
    });
    const { status, text } = await get(`https://${kHosts[language]}/w/api.php?${params}`, kHeaders, kTimeoutMs);
    if (status !== 200) {
        throw new Error(`Wiktionary answered HTTP ${status}`);
    }
    const data = JSON.parse(text) as QueryResponse;
    // The API reports errors such as a rate limit in the body of an HTTP 200 answer.
    if (data.error) {
        throw new Error(`Wiktionary: ${data.error.info ?? data.error.code}`);
    }
    const query = data.query ?? {};
    // A requested title can reach its page through normalization and then a redirect.
    const origin = new Map<string, string>();
    for (const item of [...(query.normalized ?? []), ...(query.redirects ?? [])]) {
        origin.set(item.to, origin.get(item.from) ?? item.from);
    }
    const pages = new Map<string, Lexeme[]>();
    for (const page of query.pages ?? []) {
        const content = page.revisions?.[0]?.slots?.main?.content ?? "";
        const lexemes = language === "de" ? parseGerman(content) : parseFrench(content);
        pages.set(origin.get(page.title) ?? page.title, lexemes);
    }
    return pages;
}

// The lexemes of a page that an equivalent can mean: the noun with the same entry; else the nouns of its
// gender, or else all nouns; for other words the lexemes of its part of speech, or else all.
function candidateLexemes(lexemes: Lexeme[], equivalent: Equivalent, partOfSpeech: PartOfSpeech): Lexeme[] {
    const nouns = lexemes.filter((lexeme) => lexeme.partOfSpeech === "noun");
    const sameEntry = nouns.filter((lexeme) => lexeme.nounEntries.includes(equivalent.entry));
    if (sameEntry.length > 0) {
        return sameEntry;
    }
    if (equivalent.gender !== "none" && nouns.length > 0) {
        const sameGender = nouns.filter((lexeme) => lexeme.genders.includes(equivalent.gender));
        return sameGender.length > 0 ? sameGender : nouns;
    }
    const samePart = lexemes.filter((lexeme) => lexeme.partOfSpeech === partOfSpeech);
    return samePart.length > 0 ? samePart : lexemes;
}

function formatIpa(language: string, equivalent: Equivalent, lexeme: Lexeme, ipa: string): string {
    const lemma = equivalent.lemma.trim();
    let result = ipa;
    if (language === "fr") {
        if (lexeme.hAspire) {
            result = `'${result}`;
        }
        if (/^se\s/.test(lemma) || /^se\s/.test(equivalent.entry)) {
            result = `sə ${result}`;
        } else if (/^s['’]/.test(lemma) || /^s['’]/.test(equivalent.entry)) {
            result = `s${result}`;
        }
        // An adjective written "[pəti/pətit]" keeps the model's feminine form.
        const feminine = equivalent.ipa.match(/^\[[^/\]]+\/([^\]]+)\]$/)?.[1];
        if (feminine) {
            result = `${result}/${feminine}`;
        }
    } else if (/^sich\s/.test(lemma) || /^sich\s/.test(equivalent.entry)) {
        result = `zɪç ${result}`;
    }
    return `[${result}]`;
}

// Keeps the model's transcription when Wiktionary accepts it and otherwise takes the preferred one, unless
// Wiktionary has none or pronounces the candidates differently, as French "chat" for a cat and for a chat.
function checkTranscription(check: CardCheck, language: string, equivalent: Equivalent, candidates: Lexeme[]): void {
    // Wiktionary gives the masculine form, so the feminine part of "[pəti/pətit]" stays the model's, unchecked.
    if (language === "fr" && equivalent.ipa.includes("/")) {
        check.unchecked.add(equivalent);
    }
    const accepted = candidates.map((lexeme) => lexeme.ipas.map((ipa) => formatIpa(language, equivalent, lexeme, ipa)));
    if (accepted.flat().includes(equivalent.ipa)) {
        return;
    }
    const preferred = new Set(accepted.map((ipas) => ipas[0]).filter((ipa) => ipa !== undefined));
    if (preferred.size !== 1) {
        check.unchecked.add(equivalent);
        return;
    }
    equivalent.ipa = [...preferred][0]!;
}

// Corrects the gender and plural of a noun when exactly one Wiktionary noun fits. A German noun the model
// marks with [sg] keeps the mark, since a sense can lack the plural that the word has.
function checkNounEntry(language: string, equivalent: Equivalent, candidates: Lexeme[]): void {
    const lexeme = candidates[0];
    if (equivalent.gender === "none" || candidates.length !== 1 || lexeme?.genders.length !== 1) {
        return;
    }
    const gender = lexeme.genders[0] as Equivalent["gender"];
    if (language === "de" && lexeme.nounEntries.length > 0) {
        const entries =
            equivalent.entry.endsWith(" [sg]") && lexeme.nounSingular
                ? [`${lexeme.nounSingular} [sg]`]
                : lexeme.nounEntries;
        if (!entries.includes(equivalent.entry) || equivalent.gender !== gender) {
            equivalent.entry = entries[0]!;
            equivalent.gender = gender;
        }
    } else if (language === "fr" && (gender === "m" || gender === "f")) {
        // The article of the entry and the gender field can disagree, as in "le échelle" marked feminine.
        const article = equivalent.entry.match(/^(le|la) /)?.[1];
        const expected = gender === "m" ? "le" : "la";
        if (article && (article !== expected || equivalent.gender !== gender)) {
            equivalent.entry = `${expected} ${equivalent.entry.slice(article.length + 1)}`;
            equivalent.gender = gender;
        }
    }
}

export async function checkCard(card: WordCard, get: GetText): Promise<CardCheck> {
    const check: CardCheck = { unchecked: new Set() };
    const targets = card.senses.flatMap((sense) =>
        sense.equivalents
            .filter((equivalent) => kHosts[equivalent.language])
            .map((equivalent) => ({ equivalent, partOfSpeech: sense.part_of_speech })),
    );

    // One request per language, one after the other, as the Wikimedia API etiquette asks.
    const pages = new Map<string, Map<string, Lexeme[]>>();
    for (const language of kCheckedLanguages) {
        const titles = [
            ...new Set(
                targets
                    .filter((target) => target.equivalent.language === language)
                    .map((target) => pageTitle(language, target.equivalent))
                    .filter(Boolean),
            ),
        ];
        pages.set(language, titles.length > 0 ? await fetchPages(language, titles, get) : new Map<string, Lexeme[]>());
    }

    for (const { equivalent, partOfSpeech } of targets) {
        const language = equivalent.language;
        const lexemes = pages.get(language)?.get(pageTitle(language, equivalent)) ?? [];
        const candidates = candidateLexemes(lexemes, equivalent, partOfSpeech);
        checkTranscription(check, language, equivalent, candidates);
        checkNounEntry(language, equivalent, candidates);
    }
    return check;
}
