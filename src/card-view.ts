// The word card as DOM elements: a grid with a column per language, a row group per sense,
// and each example under its language. Below a narrow width the CSS stacks the columns.

import { findGenderMismatches, type Equivalent, type WordCard } from "./card.ts";
import { findLanguage, languageName, type Shape } from "./languages.ts";

// A card at most this wide in CSS pixels shows one column, each cell labelled with its language.
const kNarrowWidth = 560;

// Lowercase text without a leading article or "to", for comparing a query with its lemma.
function bare(text: string): string {
    return text
        .trim()
        .toLowerCase()
        .replace(/^((der|die|das|le|la|les|the|to)\s+|l['’]\s*)/, "");
}

export function add<K extends keyof HTMLElementTagNameMap>(
    parent: HTMLElement,
    tag: K,
    cls: string,
    text?: string,
): HTMLElementTagNameMap[K] {
    const element = parent.ownerDocument.createElement(tag);
    element.className = cls;
    if (text !== undefined) {
        element.textContent = text;
    }
    parent.appendChild(element);
    return element;
}

function addSvg(parent: HTMLElement, viewBox: string, cls: string, shapes: Shape[]): void {
    const svgNamespace = "http://www.w3.org/2000/svg";
    const svg = parent.ownerDocument.createElementNS(svgNamespace, "svg");
    svg.setAttribute("viewBox", viewBox);
    svg.setAttribute("class", cls);
    svg.setAttribute("aria-hidden", "true");
    for (const [tag, attributes] of shapes) {
        const shape = parent.ownerDocument.createElementNS(svgNamespace, tag);
        for (const [name, value] of Object.entries(attributes)) {
            shape.setAttribute(name, value);
        }
        svg.appendChild(shape);
    }
    parent.appendChild(svg);
}

function addFlag(parent: HTMLElement, shapes: Shape[]): void {
    addSvg(parent, "0 0 30 20", "gf-flag", shapes);
}

export function addLanguageLabel(parent: HTMLElement, code: string, cls: string): void {
    const label = add(parent, "span", `gf-label ${cls}`.trim());
    const flag = findLanguage(code)?.flag;
    if (flag) {
        addFlag(label, flag);
    }
    add(label, "span", "gf-code", code.toUpperCase());
}

// The language of the head as a picker: an invisible select over the flag, so a tap opens the picker of the system.
function addLanguagePicker(
    parent: HTMLElement,
    current: string,
    languages: readonly string[],
    onPick: (code: string) => void,
): void {
    const picker = add(parent, "span", "gf-language-picker");
    addLanguageLabel(picker, current, "");
    const chevron = { fill: "none", stroke: "currentColor", "stroke-width": "1.5", "stroke-linecap": "round" };
    addSvg(picker, "0 0 10 16", "gf-chevrons", [
        ["polyline", { points: "2,6 5,3 8,6", ...chevron }],
        ["polyline", { points: "2,10 5,13 8,10", ...chevron }],
    ]);
    const select = add(picker, "select", "gf-language-select");
    select.setAttribute("aria-label", "Language of the word");
    select.title = "Look the word up as a word of another language";
    for (const code of languages) {
        add(select, "option", "", languageName(code)).value = code;
    }
    select.value = current;
    select.addEventListener("change", () => {
        if (select.value !== current) {
            onPick(select.value);
        }
    });
}

// The forms of a word that the dictionary separates with "<br>", such as "mon<br>ma<br>mes", one per line.
function addForms(parent: HTMLElement, text: string): void {
    text.split(/<br\s*\/?>/i).forEach((part, index) => {
        if (index > 0) {
            parent.appendChild(parent.ownerDocument.createElement("br"));
        }
        parent.appendChild(parent.ownerDocument.createTextNode(part.trim()));
    });
}

function addEquivalent(
    cell: HTMLElement,
    code: string,
    equivalent: Equivalent | undefined,
    unchecked: ReadonlySet<Equivalent>,
): void {
    addLanguageLabel(cell, code, "gf-inline-label");
    const body = add(cell, "div", "gf-equivalent-body");
    if (!equivalent) {
        add(body, "div", "gf-missing", "—");
        return;
    }
    addForms(add(body, "div", "gf-entry"), equivalent.entry);
    if (equivalent.ipa || equivalent.forms) {
        // The transcription and the forms share a line, as the secondary data of the entry; the transcriptions of
        // several forms stand side by side.
        const sub = add(body, "div", "gf-sub");
        if (equivalent.ipa) {
            const text = equivalent.ipa.replace(/<br\s*\/?>/gi, " ");
            const ipa = add(sub, "span", unchecked.has(equivalent) ? "gf-ipa gf-unchecked" : "gf-ipa", text);
            if (unchecked.has(equivalent)) {
                ipa.title = "Not checked against Wiktionary: transcription from the model";
            }
        }
        if (equivalent.ipa && equivalent.forms) {
            add(sub, "span", "gf-dot", " · ");
        }
        if (equivalent.forms) {
            add(sub, "span", "gf-forms", equivalent.forms);
        }
    }
    if (equivalent.alternatives.length > 0) {
        add(body, "div", "gf-also", `also ${equivalent.alternatives.join(", ")}`);
    }
    if (equivalent.definition) {
        add(body, "div", "gf-definition", equivalent.definition);
    }
}

export interface CardViewOptions {
    // Fills a line under the head, for example with the dictionary rows that hold the word.
    headNote?: (element: HTMLElement) => void;
    // Fills the bottom of a sense cell, for example with a save button.
    senseFooter?: (senseIndex: number, element: HTMLElement) => void;
    // Makes the language of the head a picker; called with the language picked instead of the one the card took.
    onLanguage?: (code: string) => void;
}

// The query is shown next to the lemma when it differs from it or has a form of its own, such as "legte ab" for
// "ablegen". Transcriptions of the unchecked equivalents get a question mark. Returns a function that stops the card from
// following its width.
export function renderCardView(
    parent: HTMLElement,
    card: WordCard,
    languages: readonly string[],
    query: string,
    unchecked: ReadonlySet<Equivalent> = new Set(),
    options: CardViewOptions = {},
): () => void {
    const root = add(parent, "div", "gf-card");
    // The narrow layout follows the width of the card, as a container query would; iOS 15 lacks container queries.
    const view = root.ownerDocument.defaultView ?? window;
    const observer = new view.ResizeObserver(([entry]) => {
        root.classList.toggle("gf-narrow", entry!.contentRect.width <= kNarrowWidth);
    });
    observer.observe(root);
    const disconnect = (): void => observer.disconnect();
    if (!card.found) {
        add(root, "p", "gf-not-found", `"${query}" is not a word of the card languages.`);
        if (card.suggestions.length > 0) {
            add(root, "p", "gf-muted", `Did you mean ${card.suggestions.join(", ")}?`);
        }
        return disconnect;
    }

    const head = add(root, "div", "gf-head");
    add(head, "span", "gf-lemma", card.lemma);
    if (options.onLanguage) {
        addLanguagePicker(head, card.query_language, languages, options.onLanguage);
    } else {
        addLanguageLabel(head, card.query_language, "");
    }
    // An inflected query with its form, such as "der Bank: dative or genitive singular" for "die Bank".
    if (card.query_form) {
        add(head, "span", "gf-muted", `${query}: ${card.query_form}`);
    } else if (bare(query) !== bare(card.lemma)) {
        add(head, "span", "gf-muted", query);
    }
    if (card.other_readings.length > 0) {
        const readings = card.other_readings.map(
            (reading) => `${reading.language} ${reading.lemma} (${reading.gloss})`,
        );
        add(root, "p", "gf-muted", `Also ${readings.join("; ")}`);
    }
    if (options.headNote) {
        options.headNote(add(root, "p", "gf-muted"));
    }

    const grid = add(root, "div", "gf-grid");
    grid.style.setProperty("--gf-languages", String(languages.length));
    add(grid, "div", "gf-cell gf-header");
    for (const code of languages) {
        addLanguageLabel(add(grid, "div", "gf-cell gf-header gf-column"), code, "");
    }

    const mismatches = new Map(findGenderMismatches(card).map((mismatch) => [mismatch.sense, mismatch]));
    card.senses.forEach((sense, index) => {
        const first = index === 0 ? " gf-first" : "";
        const senseCell = add(grid, "div", `gf-cell gf-sense${first}`);
        const title = add(senseCell, "div", "gf-sense-title");
        add(title, "span", "gf-number", String(index + 1));
        add(title, "span", "gf-pos", sense.part_of_speech);
        if (options.senseFooter) {
            options.senseFooter(index, add(senseCell, "div", "gf-sense-footer"));
        }
        for (const code of languages) {
            const equivalent = sense.equivalents.find((item) => item.language === code);
            addEquivalent(add(grid, "div", `gf-cell gf-column gf-equivalent${first}`), code, equivalent, unchecked);
        }

        add(grid, "div", "gf-cell gf-gap");
        // In the wide layout the wrapper is transparent (display: contents) and the examples sit under their
        // columns; the narrow layout makes it a block, with the example in the query language in the text colour.
        const examples = add(grid, "div", "gf-examples");
        for (const code of languages) {
            const query = code === card.query_language ? " gf-query" : "";
            const cell = add(examples, "div", `gf-cell gf-column gf-example${query}`);
            const example = sense.examples.find((item) => item.language === code);
            if (example) {
                addLanguageLabel(cell, code, "gf-inline-label");
                add(cell, "span", "gf-example-text", example.text);
            }
        }

        const notes = [...sense.notes];
        const mismatch = mismatches.get(index);
        if (mismatch) {
            notes.push(`Gender: ${mismatch.genders.map((item) => `${item.language} ${item.gender}`).join(", ")}`);
        }
        if (notes.length > 0) {
            const cell = add(grid, "div", "gf-cell gf-notes");
            for (const note of notes) {
                add(cell, "div", "gf-note", note);
            }
        }
    });
    return disconnect;
}
