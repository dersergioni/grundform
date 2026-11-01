// The input field for a query and the modal that shows its card.

import { type App, Modal, Notice } from "obsidian";
import type { WordCard } from "./card.ts";
import { type CardViewOptions, renderCardView } from "./card-view.ts";
import { type Dictionary, type DictionaryRow, findRows, findSenseRows, senseRow } from "./dictionary.ts";
import { SaveModal } from "./dictionary-modals.ts";
import type { DictionaryNote } from "./dictionary-note.ts";
import type { CardLookup } from "./lookup.ts";
import { errorText, plainInput } from "./ui.ts";

// Holding the Save button this long opens the row to correct it before saving.
const kHoldMs = 500;

// The numbers of rows as the table writes them, such as "532, 1624".
function rowNumbers(rows: DictionaryRow[]): string {
    return rows.map((row) => row.cells[0]).join(", ");
}

export class LookupModal extends Modal {
    private readonly onSubmit: (query: string) => void;

    constructor(app: App, onSubmit: (query: string) => void) {
        super(app);
        this.onSubmit = onSubmit;
    }

    onOpen(): void {
        this.titleEl.setText("Look up a word");
        const input = this.contentEl.createEl("input", {
            type: "text",
            cls: "gf-input",
            attr: { placeholder: "A word or phrase in any of the card languages", enterkeyhint: "search" },
        });
        plainInput(input);
        input.addEventListener("keydown", (event) => {
            const query = input.value.trim();
            if (event.key === "Enter" && !event.isComposing && query) {
                // Closing the modal gives the focus back to where it was, and the rest of this key press would land
                // there.
                event.preventDefault();
                this.close();
                this.onSubmit(query);
            }
        });
        input.focus();
    }

    onClose(): void {
        this.contentEl.empty();
    }
}

export class CardModal extends Modal {
    private readonly query: string;
    private readonly languages: string[];
    private readonly model: string;
    private readonly result: Promise<CardLookup>;
    private readonly dictionary: DictionaryNote;
    // Looks the query up again without the cache.
    private readonly lookUpAgain: () => void;
    // Looks the query up as a word of the language given.
    private readonly lookUpAs: (language: string) => void;
    private closed = false;
    // Stops the card from following its width, once the modal closes.
    private disconnectCard: (() => void) | undefined;

    constructor(
        app: App,
        query: string,
        languages: string[],
        model: string,
        result: Promise<CardLookup>,
        dictionary: DictionaryNote,
        lookUpAgain: () => void,
        lookUpAs: (language: string) => void,
    ) {
        super(app);
        this.query = query;
        this.languages = languages;
        this.model = model;
        this.result = result;
        this.dictionary = dictionary;
        this.lookUpAgain = lookUpAgain;
        this.lookUpAs = lookUpAs;
    }

    onOpen(): void {
        this.modalEl.addClass("gf-card-modal");
        this.titleEl.setText(this.query);
        void this.showCard();
    }

    // Waits for the card and renders it; a failed request or rendering replaces the card with the error.
    private async showCard(): Promise<void> {
        this.contentEl.createEl("p", { cls: "gf-status", text: "Looking up…" });
        try {
            const result = await this.result;
            // A dictionary note that cannot be used leaves the card without marks and save buttons, with the reason
            // under the head.
            let options: CardViewOptions = {};
            if (result.card.found) {
                try {
                    const dictionary = await this.dictionary.read();
                    options = dictionary ? this.dictionaryOptions(dictionary, result) : {};
                } catch (error) {
                    options = { headNote: (element) => element.setText(errorText(error)) };
                }
                // A language picked in the head replaces the card with the card of the query in that language.
                options.onLanguage = (language) => {
                    this.close();
                    this.lookUpAs(language);
                };
            }
            if (this.closed) {
                return;
            }
            this.contentEl.empty();
            this.titleEl.empty();
            this.disconnectCard = renderCardView(
                this.contentEl,
                result.card,
                this.languages,
                this.query,
                result.unchecked,
                options,
            );
            const parts = [
                "grundform",
                this.model,
                result.cached ? "from cache" : `${(result.latencyMs / 1000).toFixed(1)} s`,
                ...(result.wiktionary === "checked" ? ["checked against Wiktionary"] : []),
                ...(result.wiktionary === "unavailable" ? ["Wiktionary unavailable"] : []),
            ];
            const status = this.contentEl.createEl("p", { cls: "gf-status", text: parts.join(" · ") });
            if (result.cached) {
                status.appendText(" · ");
                const again = status.createEl("a", { text: "Look up again", href: "#" });
                again.addEventListener("click", (event) => {
                    event.preventDefault();
                    this.close();
                    this.lookUpAgain();
                });
            }
        } catch (error) {
            if (this.closed) {
                return;
            }
            this.contentEl.empty();
            this.titleEl.setText(this.query);
            this.contentEl.createEl("p", { cls: "gf-status mod-warning", text: `Lookup failed: ${errorText(error)}` });
        }
    }

    // The rows of the dictionary that already hold the word or a sense, and a save button for the other senses. After
    // a save the note is read again, so that the head and the marks of every sense follow the rows it holds now.
    private dictionaryOptions(initial: Dictionary, result: CardLookup): CardViewOptions {
        const card: WordCard = result.card;
        const queryEntry =
            card.senses[0]?.equivalents.find((equivalent) => equivalent.language === card.query_language)?.entry ??
            card.lemma;
        let dictionary = initial;
        let headNote: HTMLElement | undefined;
        const footers = new Map<number, HTMLElement>();
        // The rows this card saved, by sense: a row corrected before saving need not match its sense.
        const savedRows = new Map<number, number>();
        const showWordRows = (): void => {
            const rows = findRows(dictionary, card.query_language, queryEntry);
            headNote?.setText(rows.length > 0 ? `In the dictionary: ${rowNumbers(rows)}` : "Not in the dictionary yet");
        };
        // The note as it is now, or else as the card last read it.
        const current = async (): Promise<Dictionary> => {
            dictionary = (await this.dictionary.read().catch(() => undefined)) ?? dictionary;
            return dictionary;
        };
        const fillFooter = (senseIndex: number, element: HTMLElement): void => {
            element.empty();
            const savedRow = savedRows.get(senseIndex);
            if (savedRow !== undefined) {
                element.createSpan({ cls: "gf-saved", text: `Row ${savedRow}` });
                return;
            }
            const sense = card.senses[senseIndex]!;
            const entries = new Map(
                sense.equivalents.map((equivalent) => [
                    equivalent.language,
                    [equivalent.entry, ...equivalent.alternatives],
                ]),
            );
            const { same, similar } = findSenseRows(dictionary, entries);
            if (same.length > 0) {
                element.createSpan({ cls: "gf-saved", text: `Row ${rowNumbers(same)}` });
                return;
            }
            const button = element.createEl("button", { cls: "gf-save", text: "Save" });
            button.title = "Save the row. Hold, or right-click, to correct it first.";
            if (similar.length > 0) {
                const label = similar.length === 1 ? "row" : "rows";
                element.createSpan({ cls: "gf-saved", text: `Similar: ${label}\u00a0${rowNumbers(similar)}` });
            }
            // A click saves the row at once; holding the button or a right click shows the row to correct first. Both
            // build the row from the note as it is now, so that a column renamed since the card opened gets its cell.
            const save = async (): Promise<void> => {
                button.disabled = true;
                try {
                    const { values, notes } = senseRow(await current(), sense, this.languages, result.unchecked);
                    const number = await this.dictionary.append(values);
                    new Notice([`Saved as row ${number}.`, ...notes].join(" "));
                    saved(senseIndex, number);
                } catch (error) {
                    button.disabled = false;
                    new Notice(`Saving failed: ${errorText(error)}`);
                }
            };
            const edit = async (): Promise<void> => {
                const note = await current();
                const { values, notes } = senseRow(note, sense, this.languages, result.unchecked);
                new SaveModal(this.app, note.columns, values, notes, this.dictionary, (number) =>
                    saved(senseIndex, number),
                ).open();
            };
            let hold: number | undefined;
            let held = false;
            const release = (): void => {
                window.clearTimeout(hold);
                hold = undefined;
            };
            button.addEventListener("pointerdown", (event) => {
                if (event.button !== 0) {
                    return;
                }
                held = false;
                release();
                hold = window.setTimeout(() => {
                    held = true;
                    void edit();
                }, kHoldMs);
            });
            for (const name of ["pointerup", "pointercancel", "pointerleave"] as const) {
                button.addEventListener(name, release);
            }
            button.addEventListener("click", () => {
                if (held) {
                    held = false;
                    return;
                }
                void save();
            });
            button.addEventListener("contextmenu", (event) => {
                event.preventDefault();
                release();
                void edit();
            });
        };
        const saved = (senseIndex: number, number: number): void => {
            savedRows.set(senseIndex, number);
            void current().then(() => {
                showWordRows();
                for (const [index, element] of footers) {
                    fillFooter(index, element);
                }
            });
        };
        return {
            headNote: (element) => {
                headNote = element;
                showWordRows();
            },
            senseFooter: (senseIndex, element) => {
                footers.set(senseIndex, element);
                fillFooter(senseIndex, element);
            },
        };
    }

    onClose(): void {
        this.closed = true;
        this.disconnectCard?.();
        this.contentEl.empty();
    }
}
