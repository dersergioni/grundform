// The dictionary note: a Markdown table with a number column and, per language, an entry column and an optional
// transcription column, for example "No. | Russian translation | French | French transcription | ...".
// This module reads the table, finds rows, appends a row and creates a new note. It writes the table the way
// Prettier formats it, so that a later Prettier run leaves the note unchanged.

import type { Equivalent, Sense } from "./card.ts";
import { findLanguage, kLanguages, languageName } from "./languages.ts";

export type ColumnKind = "number" | "entry" | "transcription" | "other";

// Column alignment as the colons of the separator line set it.
export type Alignment = "none" | "left" | "center" | "right";

export interface DictionaryColumn {
    header: string;
    kind: ColumnKind;
    // Set for entry and transcription columns.
    language?: string;
}

export interface Dictionary {
    lines: string[];
    // The line break after each line, "" after the last one; kept when the note is written back.
    breaks: string[];
    // Index of the header line and of the first line after the table.
    start: number;
    end: number;
    columns: DictionaryColumn[];
    alignments: Alignment[];
    rows: string[][];
    // A text line right after the table that Markdown joins to it as a row, if there is one.
    joinedLine?: number;
    // A comment or code line inside the table with more rows after it, if there is one: the table ends there, and a
    // new row would go before the rows that follow.
    splitLine?: number;
}

// Display width of a cell as Prettier 3 measures it: control characters and combining marks such as the IPA
// diacritics take no space, wide East Asian characters and the emoji of the main emoji blocks take two. A few rare
// symbols that Prettier counts as two, such as ✅ or characters beyond the main CJK blocks, count as one here.
function textWidth(text: string): number {
    let width = 0;
    for (const character of text) {
        const code = character.codePointAt(0)!;
        if (
            code <= 31 ||
            (code >= 127 && code <= 159) ||
            (code >= 0x300 && code <= 0x36f) ||
            (code >= 0xfe00 && code <= 0xfe0f)
        ) {
            continue;
        }
        const wide =
            (code >= 0x1100 && code <= 0x115f) ||
            (code >= 0x2e80 && code <= 0xa4cf) ||
            (code >= 0xac00 && code <= 0xd7a3) ||
            (code >= 0xf900 && code <= 0xfaff) ||
            (code >= 0xff00 && code <= 0xff60) ||
            (code >= 0xffe0 && code <= 0xffe6) ||
            (code >= 0x1f300 && code <= 0x1faff);
        width += wide ? 2 : 1;
    }
    return width;
}

// Cells of a table line, with escaped pipes kept inside their cell. No lookbehind: iOS before 16.4 lacks it.
function splitRow(line: string): string[] {
    const inner = line.trim().replace(/^\|/, "").replace(/\|$/, "");
    const cells: string[] = [];
    let cell = "";
    for (let i = 0; i < inner.length; i++) {
        if (inner[i] === "\\" && inner[i + 1] === "|") {
            cell += "\\|";
            i++;
        } else if (inner[i] === "|") {
            cells.push(cell.trim());
            cell = "";
        } else {
            cell += inner[i];
        }
    }
    cells.push(cell.trim());
    return cells;
}

function classify(header: string): DictionaryColumn {
    const name = header.trim();
    if (/^(no\.?|#|nr\.?)$/i.test(name)) {
        return { header: name, kind: "number" };
    }
    for (const language of kLanguages) {
        if (!name.toLowerCase().startsWith(language.name.toLowerCase())) {
            continue;
        }
        const rest = name.slice(language.name.length).trim().toLowerCase();
        if (rest === "" || rest === "translation") {
            return { header: name, kind: "entry", language: language.code };
        }
        if (rest === "transcription") {
            return { header: name, kind: "transcription", language: language.code };
        }
    }
    return { header: name, kind: "other" };
}

function alignment(separator: string): Alignment {
    const left = separator.startsWith(":");
    const right = separator.endsWith(":");
    return left && right ? "center" : left ? "left" : right ? "right" : "none";
}

// The lines of a text and the line break after each, so that a note keeps its own line breaks.
function splitLines(text: string): { lines: string[]; breaks: string[] } {
    const lines: string[] = [];
    const breaks: string[] = [];
    let from = 0;
    for (const match of text.matchAll(/\r?\n/g)) {
        lines.push(text.slice(from, match.index));
        breaks.push(match[0]);
        from = match.index + match[0].length;
    }
    lines.push(text.slice(from));
    breaks.push("");
    return { lines, breaks };
}

// Lines that Markdown does not show as text: the front matter, fenced code blocks and %% or <!-- --> comments.
function hiddenLines(lines: string[]): boolean[] {
    const hidden: boolean[] = [];
    const frontMatterEnd = lines[0] === "---" ? lines.indexOf("---", 1) : -1;
    for (let index = 0; index <= frontMatterEnd; index++) {
        hidden.push(true);
    }
    let fence: RegExp | undefined;
    let commentEnd: string | undefined;
    for (const line of lines.slice(hidden.length)) {
        const trimmed = line.trim();
        if (fence) {
            hidden.push(true);
            if (fence.test(trimmed)) {
                fence = undefined;
            }
            continue;
        }
        if (commentEnd) {
            hidden.push(true);
            if (line.includes(commentEnd)) {
                commentEnd = undefined;
            }
            continue;
        }
        const opening = /^(`{3,}|~{3,})/.exec(trimmed);
        if (opening) {
            const mark = opening[1]!;
            fence = new RegExp(`^\\${mark[0]}{${mark.length},}\\s*$`);
            hidden.push(true);
        } else if (trimmed.startsWith("%%")) {
            commentEnd = trimmed.slice(2).includes("%%") ? undefined : "%%";
            hidden.push(true);
        } else if (trimmed.startsWith("<!--")) {
            commentEnd = trimmed.includes("-->") ? undefined : "-->";
            hidden.push(true);
        } else {
            hidden.push(false);
        }
    }
    return hidden;
}

const kSeparator = /^\s{0,3}\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;
// A line that starts a new Markdown block and so ends a table: a heading, a list item, a quote, a fence, HTML or
// a thematic break. A line that starts with "|" is never one.
const kBlockStart = /^\s{0,3}(#{1,6}(\s|$)|[-*+]\s|\d+[.)]\s|>|```|~~~|<|(-\s*){3,}$|(\*\s*){3,}$|(_\s*){3,}$)/;

// The first table of the note whose first column is the number column, or undefined when there is none. Rows
// are the lines that follow while they hold a "|", also without a leading one or with an indent, until a blank
// line or a new block.
export function parseDictionary(text: string): Dictionary | undefined {
    const { lines, breaks } = splitLines(text);
    const hidden = hiddenLines(lines);
    const shown = (index: number): boolean => index < lines.length && !hidden[index] && lines[index]!.trim() !== "";
    for (let start = 0; start + 1 < lines.length; start++) {
        const header = lines[start]!;
        const rule = lines[start + 1]!;
        const isTable = shown(start) && shown(start + 1) && header.includes("|") && rule.includes("|");
        if (!isTable || !kSeparator.test(rule)) {
            continue;
        }
        const columns = splitRow(header).map(classify);
        if (columns[0]?.kind !== "number") {
            continue;
        }
        const alignments = splitRow(rule).map(alignment);
        let end = start + 2;
        const rows: string[][] = [];
        while (shown(end) && lines[end]!.includes("|") && !kBlockStart.test(lines[end]!)) {
            rows.push(splitRow(lines[end]!));
            end++;
        }
        const joined = shown(end) && !kBlockStart.test(lines[end]!);
        let next = end;
        while (next < lines.length && hidden[next]) {
            next++;
        }
        const split = next > end && shown(next) && lines[next]!.trimStart().startsWith("|");
        return {
            lines,
            breaks,
            start,
            end,
            columns,
            alignments,
            rows,
            ...(joined ? { joinedLine: end } : {}),
            ...(split ? { splitLine: end } : {}),
        };
    }
    return undefined;
}

// The languages that have an entry column, in column order.
export function dictionaryLanguages(dictionary: Dictionary): string[] {
    return dictionary.columns.filter((column) => column.kind === "entry").map((column) => column.language!);
}

// The comparable core of an entry: without hints, gender and number marks, the plural after a comma, an article
// or "to", and a feminine form after a slash or a line break, so that "der/die Angestellte" gives "Angestellte"
// and "un<br>une" gives "un". German keeps its letter case, which tells "das Essen" from "essen"; the other
// languages compare in lowercase.
export function entryKey(entry: string, language = ""): string {
    const core = entry
        .replace(/<br\s*\/?>/gi, "/")
        .replace(/\([^)]*\)/g, " ")
        .replace(/\[[^\]]*\]/g, " ")
        .split(",")[0]!
        .trim()
        .replace(/^((der|die|das|le|la|les|the|to)(\/(der|die|das|le|la|les))*\s+|l['’]\s*)/i, "");
    const key = core.split("/")[0]!.replace(/\s+/g, " ").trim();
    return language === "de" ? key : key.toLowerCase();
}

export interface DictionaryRow {
    // NaN when the number cell holds anything but digits.
    number: number;
    cells: string[];
}

function entryIndex(dictionary: Dictionary, language: string): number {
    return dictionary.columns.findIndex((column) => column.kind === "entry" && column.language === language);
}

function rowsOf(dictionary: Dictionary): DictionaryRow[] {
    return dictionary.rows.map((cells) => ({ number: /^\d+$/.test(cells[0] ?? "") ? Number(cells[0]) : NaN, cells }));
}

// Rows whose entry in the language has the same core as the given entry.
export function findRows(dictionary: Dictionary, language: string, entry: string): DictionaryRow[] {
    const index = entryIndex(dictionary, language);
    const key = entryKey(entry, language);
    if (index < 0 || !key) {
        return [];
    }
    return rowsOf(dictionary).filter((row) => entryKey(row.cells[index] ?? "", language) === key);
}

export interface SenseRows {
    // Rows that hold the sense: they agree with it in every language where both have an entry, at least two.
    same: DictionaryRow[];
    // Rows that agree in at least two languages and differ in another, often by a synonym, such as "ficher" and
    // "classer" for "ablegen, to file".
    similar: DictionaryRow[];
}

// The rows that hold a sense of the card. Its entries are given by language, the main entry first and then the
// alternatives; a row agrees in a language when its entry matches any of them. A row that differs in one language
// stays similar: the dictionary may keep a synonym in a row of its own, such as "salut" and "coucou".
export function findSenseRows(dictionary: Dictionary, entries: Map<string, readonly string[]>): SenseRows {
    const items = [...entries]
        .map(([language, words]) => ({
            language,
            index: entryIndex(dictionary, language),
            keys: words.map((word) => entryKey(word, language)),
        }))
        .filter((item) => item.index >= 0 && item.keys[0]);
    const result: SenseRows = { same: [], similar: [] };
    for (const row of rowsOf(dictionary)) {
        let shared = 0;
        let agreeing = 0;
        for (const item of items) {
            const key = entryKey(row.cells[item.index] ?? "", item.language);
            if (key) {
                shared++;
                agreeing += item.keys.includes(key) ? 1 : 0;
            }
        }
        if (agreeing >= 2) {
            (agreeing === shared ? result.same : result.similar).push(row);
        }
    }
    return result;
}

export interface SenseRow {
    // The cells by column header: the entry and the transcription of each language with a column.
    values: Map<string, string>;
    // What the row leaves out or does not vouch for, such as a card language without a column.
    notes: string[];
}

// The row that saving a sense of a card appends.
export function senseRow(
    dictionary: Dictionary,
    sense: Sense,
    languages: readonly string[],
    unchecked: ReadonlySet<Equivalent>,
): SenseRow {
    const values = new Map<string, string>();
    for (const column of dictionary.columns) {
        const equivalent = sense.equivalents.find((item) => item.language === column.language);
        if (column.kind === "entry") {
            values.set(column.header, equivalent?.entry ?? "");
        } else if (column.kind === "transcription") {
            values.set(column.header, equivalent?.ipa ?? "");
        }
    }
    const hasColumn = (language: string, kind: ColumnKind): boolean =>
        dictionary.columns.some((column) => column.kind === kind && column.language === language);
    const notes = [
        ...languages
            .filter((code) => !hasColumn(code, "entry"))
            .map((code) => `${languageName(code)} has no column in the dictionary and is not saved.`),
        ...sense.equivalents
            .filter(
                (equivalent) =>
                    unchecked.has(equivalent) && equivalent.ipa && hasColumn(equivalent.language, "transcription"),
            )
            .map(
                (equivalent) =>
                    `The ${languageName(equivalent.language)} transcription is not checked against Wiktionary.`,
            ),
    ];
    return { values, notes };
}

function nextNumber(dictionary: Dictionary): number {
    // A row without a number has NaN, which is never greater.
    return rowsOf(dictionary).reduce((max, row) => (row.number > max ? row.number : max), 0) + 1;
}

function pad(cell: string, width: number, align: Alignment): string {
    const space = width - textWidth(cell);
    if (align === "right") {
        return " ".repeat(space) + cell;
    }
    if (align === "center") {
        const left = Math.floor(space / 2);
        return " ".repeat(left) + cell + " ".repeat(space - left);
    }
    return cell + " ".repeat(space);
}

function separator(width: number, align: Alignment): string {
    switch (align) {
        case "left":
            return ":" + "-".repeat(width - 1);
        case "right":
            return "-".repeat(width - 1) + ":";
        case "center":
            return ":" + "-".repeat(width - 2) + ":";
        default:
            return "-".repeat(width);
    }
}

// The table lines as Prettier aligns them: every cell padded to its column width, at least three wide, by the
// column alignment. A row with cells beyond the header keeps them, aligned among the rows that have them.
export function formatTable(headers: string[], rows: string[][], alignments: Alignment[] = []): string[] {
    const widths = headers.map((header, column) =>
        Math.max(3, textWidth(header), ...rows.map((row) => textWidth(row[column] ?? ""))),
    );
    const extraWidths: number[] = [];
    for (const row of rows) {
        row.slice(headers.length).forEach((cell, index) => {
            extraWidths[index] = Math.max(extraWidths[index] ?? 3, textWidth(cell));
        });
    }
    const align = (column: number): Alignment => alignments[column] ?? "none";
    const line = (cells: string[]): string => {
        const padded = widths.map((width, column) => pad(cells[column] ?? "", width, align(column)));
        const extra = cells.slice(headers.length).map((cell, index) => pad(cell, extraWidths[index]!, "none"));
        return "| " + [...padded, ...extra].join(" | ") + " |";
    };
    const rule = "| " + widths.map((width, column) => separator(width, align(column))).join(" | ") + " |";
    return [line(headers), rule, ...rows.map(line)];
}

// A field as a table cell: one line with single spaces, as Prettier writes it, and pipes escaped.
function escapeCell(text: string): string {
    return text.replace(/\s+/g, " ").replace(/\\\|/g, "|").replace(/\|/g, "\\|").trim();
}

// The note text with one more row at the end of the table, numbered after the highest number, and that number.
export function appendRow(text: string, values: Map<string, string>): { text: string; number: number } {
    const dictionary = parseDictionary(text);
    if (!dictionary) {
        throw new Error("The note has no dictionary table.");
    }
    if (dictionary.joinedLine !== undefined) {
        throw new Error(
            `Line ${dictionary.joinedLine + 1} follows the table without a blank line, so Markdown reads it as a row. Add a blank line before it.`,
        );
    }
    if (dictionary.splitLine !== undefined) {
        throw new Error(
            `Line ${dictionary.splitLine + 1} is a comment or code inside the table, with rows after it. Move it out of the table before saving.`,
        );
    }
    const number = nextNumber(dictionary);
    const row = dictionary.columns.map((column) =>
        column.kind === "number" ? String(number) : escapeCell(values.get(column.header) ?? ""),
    );
    const table = formatTable(
        dictionary.columns.map((column) => column.header),
        [...dictionary.rows, row],
        dictionary.alignments,
    );
    // The table lines take the line break of the header; the last one keeps the break of the old last row.
    const { lines, breaks, start, end } = dictionary;
    const tableBreaks = table.map((_, index) => (index === table.length - 1 ? breaks[end - 1]! : breaks[start]!));
    const outLines = [...lines.slice(0, start), ...table, ...lines.slice(end)];
    const outBreaks = [...breaks.slice(0, start), ...tableBreaks, ...breaks.slice(end)];
    return { text: outLines.map((line, index) => line + outBreaks[index]).join(""), number };
}

// The headers of a new dictionary for the languages: an entry column for each, and a transcription column for
// the languages that have one.
function newDictionaryHeaders(languages: readonly string[]): string[] {
    const headers = ["No."];
    for (const code of languages) {
        const language = findLanguage(code);
        const name = language?.name ?? code;
        headers.push(name);
        if (language?.transcription ?? true) {
            headers.push(`${name} transcription`);
        }
    }
    return headers;
}

export function newDictionaryText(title: string, languages: readonly string[]): string {
    return [`# ${title}`, "", ...formatTable(newDictionaryHeaders(languages), []), ""].join("\n");
}
