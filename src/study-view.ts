// The study tab: the rows of the dictionary note as cards with spaced repetition, and the same rows to browse one
// by one.

import {
    debounce,
    ItemView,
    type KeymapEventListener,
    MarkdownView,
    type Modifier,
    Notice,
    normalizePath,
    Platform,
    Scope,
    type TAbstractFile,
    type WorkspaceLeaf,
} from "obsidian";
import { type Grade, Rating } from "ts-fsrs";
import { add, addLanguageLabel } from "./card-view.ts";
import { dictionaryLanguages } from "./dictionary.ts";
import { languageName } from "./languages.ts";
import type GrundformPlugin from "./main.ts";
import {
    type Answer,
    cardStatus,
    formatInterval,
    isStudied,
    lookupQuery,
    type Mark,
    Progress,
    streak,
    type StudyCard,
    studyCard,
    studyQueue,
    studiedRow,
    type StudyRow,
    studyRows,
    type StudyEntry,
    studyTotals,
} from "./study.ts";
import { errorText } from "./ui.ts";

export const kStudyViewType = "grundform-study";

// The row that Browse showed last, which earlier versions kept on each device rather than in the study folder.
const kBrowseKey = "grundform-browse-row";
// The row that Browse shows is written to the study folder once the arrows have rested this long.
const kBrowseSaveMs = 1000;
// Bringing the tab to the front reads the answers again unless they were read this recently.
const kFreshMs = 2000;
// An answer given this long after the answer was shown takes the time of the rating, as the card has been put aside.
const kStaleMs = 60_000;

const kGrades: [rating: Grade, label: string][] = [
    [Rating.Again, "Again"],
    [Rating.Hard, "Hard"],
    [Rating.Good, "Good"],
    [Rating.Easy, "Easy"],
];

type Mode = "learn" | "browse";

interface StudyData {
    path: string;
    // The line of the table header in the note: row i of the table is on line start + 2 + i.
    start: number;
    rows: StudyRow[];
    front: string;
    progress: Progress;
    // Study files that could not be read.
    unread: number;
}

// The text of a cell with its line breaks and escaped pipes.
function addCellText(parent: HTMLElement, text: string): void {
    text.replace(/\\\|/g, "|")
        .split(/<br\s*\/?>/i)
        .forEach((part, index) => {
            if (index > 0) {
                parent.appendChild(parent.ownerDocument.createElement("br"));
            }
            parent.appendChild(parent.ownerDocument.createTextNode(part.trim()));
        });
}

function totalsText(data: StudyData): string {
    const totals = studyTotals(data.rows, data.progress, data.front);
    const fresh = totals.words - totals.learned - totals.learning;
    return `${totals.words} words: ${totals.learned} learned, ${totals.learning} learning, ${fresh} not started`;
}

function addButton(parent: HTMLElement, cls: string, text: string, onClick: () => void): HTMLButtonElement {
    const button = add(parent, "button", cls, text);
    button.addEventListener("click", onClick);
    return button;
}

// The answers and marks that count for a dictionary note: its own and those written before the note was recorded.
function forNote(entries: readonly StudyEntry[], path: string): StudyEntry[] {
    return entries.filter((entry) => entry.note === "" || entry.note === path);
}

function sameCard(a: StudyCard, b: StudyCard): boolean {
    return a.row.number === b.row.number && a.direction === b.direction && a.from === b.from;
}

// The row of the table as the shown mode draws it, waiting up to ten seconds for the drawing. The first wait lets
// the scroll that Obsidian applies with the next frame happen first.
async function drawnRow(view: MarkdownView, row: StudyRow): Promise<HTMLTableRowElement | undefined> {
    for (let attempt = 0; attempt < 200; attempt++) {
        await sleep(50);
        for (const table of Array.from(view.contentEl.querySelectorAll("table"))) {
            // The header is the first row of the drawn table. A cell in Live Preview also holds its source, hidden,
            // and the hidden mode keeps its drawn table.
            const item = table.rows[row.index + 1];
            if (item?.isShown() && item.cells[0]?.innerText.trim() === String(row.number)) {
                return item;
            }
        }
    }
    return undefined;
}

// The text of the first cell of a table line, such as "12" for "| 12   | слово |".
function firstCell(line: string): string {
    return line.trim().replace(/^\|/, "").split("|")[0]?.trim() ?? "";
}

export class StudyView extends ItemView {
    private readonly plugin: GrundformPlugin;
    private mode: Mode = "learn";
    private data: StudyData | undefined;
    private problem = "";
    // The card that Learn shows, whether its answer is shown, and when. The intervals on the buttons and the answer
    // both take that time, so the fuzz of the schedule gives the interval the button shows.
    private card: StudyCard | undefined;
    private revealed = false;
    private shownAt = 0;
    // The answers given in this tab, latest last, for Undo.
    private readonly given: Answer[] = [];
    // The row that Browse shows, by number and by position in the table, which tells rows with one number apart.
    private browseNumber = 1;
    private browsePosition = -1;
    // When the row was chosen, here or on another device, so that only a row chosen later replaces it.
    private browseTime = 0;
    // When the answers were last read.
    private loadedAt = 0;
    // Whether Open the row in the note is at work.
    private opening = false;
    // Reloads, answers and undos run one after another, so that none of them works on data that another replaces.
    private pending: Promise<void> = Promise.resolve();
    // A reload while a button is held draws the tab only once it is released: a button replaced between the press and
    // the release never gets its click, and the press that makes the tab active starts a reload.
    private pointerDown = false;
    private renderOnRelease = false;
    // An editor saves the note while you type, so the note is read again only once the changes stop.
    private readonly noteChanged = debounce(() => this.serial(() => this.reload(false)), 500, true);
    private readonly settingsChanged = debounce(() => this.serial(() => this.reload(true)), 500, true);
    private readonly saveBrowseRow = debounce(
        () => {
            this.plugin.studyLog
                .saveBrowseRow({ row: this.browseNumber, time: this.browseTime })
                .catch((error: unknown) => {
                    console.warn("grundform: the row of Browse was not saved", error);
                });
        },
        kBrowseSaveMs,
        true,
    );

    constructor(leaf: WorkspaceLeaf, plugin: GrundformPlugin) {
        super(leaf);
        this.plugin = plugin;
        // The keys work while the tab is active.
        const keys: [Modifier[], string, () => void][] = [
            [[], " ", () => (this.revealed ? this.answer(Rating.Good) : this.reveal())],
            ...kGrades.map(([rating], index): [Modifier[], string, () => void] => [
                [],
                String(index + 1),
                () => this.answer(rating),
            ]),
            [[], "ArrowLeft", () => this.browse(-1)],
            [[], "ArrowRight", () => this.browse(1)],
            [["Mod"], "Z", () => this.undo()],
        ];
        this.scope = new Scope(this.app.scope);
        for (const [modifiers, key, action] of keys) {
            this.scope.register(modifiers, key, this.key(action));
        }
    }

    getViewType(): string {
        return kStudyViewType;
    }

    getDisplayText(): string {
        return "grundform study";
    }

    getIcon(): string {
        return "graduation-cap";
    }

    async onOpen(): Promise<void> {
        // A row saved in the study folder replaces this one.
        try {
            this.browseNumber = Number(window.localStorage.getItem(kBrowseKey)) || 1;
        } catch {
            // Browse starts at the first row.
        }
        // Edits of the note show at once. Answers given on another device come in when the tab comes to the front
        // and when Obsidian comes back to the foreground.
        this.registerEvent(
            this.app.vault.on("modify", (file) => {
                if (file.path === this.notePath()) {
                    this.noteChanged();
                }
            }),
        );
        this.registerEvent(
            this.app.workspace.on("active-leaf-change", (leaf) => {
                if (leaf === this.leaf) {
                    this.freshen();
                }
            }),
        );
        const doc = this.containerEl.ownerDocument;
        const resume = (): void => {
            if (doc.visibilityState === "visible" && this.app.workspace.getActiveViewOfType(StudyView) === this) {
                this.freshen();
            }
            // iOS may suspend Obsidian in the background before the row is saved.
            if (doc.visibilityState === "hidden") {
                this.saveBrowseRow.run();
            }
        };
        this.registerDomEvent(doc, "visibilitychange", resume);
        this.registerDomEvent(doc.defaultView ?? window, "focus", resume);
        // A dictionary note that is deleted or comes back is read again.
        const noteEvent = (file: TAbstractFile): void => {
            if (file.path === this.notePath()) {
                this.noteChanged();
            }
        };
        this.registerEvent(this.app.vault.on("create", noteEvent));
        this.registerEvent(this.app.vault.on("delete", noteEvent));
        this.registerDomEvent(this.contentEl, "pointerdown", () => {
            this.pointerDown = true;
        });
        const release = (): void => {
            this.pointerDown = false;
            if (this.renderOnRelease) {
                this.renderOnRelease = false;
                // After the click that follows the release.
                window.setTimeout(() => this.render(), 0);
            }
        };
        this.registerDomEvent(doc, "pointerup", release);
        this.registerDomEvent(doc, "pointercancel", release);
        this.serial(() => this.reload(true));
        await this.pending;
    }

    async onClose(): Promise<void> {
        this.noteChanged.cancel();
        this.settingsChanged.cancel();
        this.saveBrowseRow.run();
        await this.pending;
    }

    // Reads the settings, the note and the answers again, for example after a change of the settings.
    refresh(): void {
        this.settingsChanged();
    }

    // Reads the answers again unless they were read just now, as when the tab comes to the front.
    freshen(): void {
        if (Date.now() - this.loadedAt > kFreshMs) {
            this.loadedAt = Date.now();
            this.serial(() => this.reload(true));
        }
    }

    private serial(task: () => Promise<void>): void {
        this.pending = this.pending.then(task).catch((error: unknown) => {
            console.error("grundform: study tab", error);
        });
    }

    private notePath(): string {
        return normalizePath(this.plugin.settings.dictionaryPath.trim());
    }

    // A key handler that leaves typing in a text field and Space on a focused button alone, and acts once for a
    // held key.
    private key(action: () => void): KeymapEventListener {
        return (event) => {
            const target = event.target as HTMLElement | null;
            const typing = target?.tagName === "INPUT" || target?.tagName === "TEXTAREA" || target?.isContentEditable;
            if (typing || (event.key === " " && target?.tagName === "BUTTON")) {
                return true;
            }
            if (!event.repeat) {
                action();
            }
            return false;
        };
    }

    // Reads the dictionary note and, with answers set or on the first read, the answers of all devices.
    private async reload(answers: boolean): Promise<void> {
        try {
            const dictionary = await this.plugin.dictionary.read();
            if (!dictionary) {
                throw new Error("Choose a dictionary note in the grundform settings.");
            }
            const languages = dictionaryLanguages(dictionary);
            if (new Set(languages).size < 2) {
                throw new Error("The dictionary note needs entry columns of at least two languages.");
            }
            const setting = this.plugin.settings.studyFrom;
            const front = languages.includes(setting) ? setting : languages[0]!;
            const path = this.notePath();
            // Another dictionary note has other progress and other rows.
            const sameNote = this.data?.path === path;
            let progress = sameNote ? this.data?.progress : undefined;
            let unread = this.data?.unread ?? 0;
            if (answers || !progress) {
                ({ progress, unread } = await this.loadProgress(path));
                this.loadedAt = Date.now();
                await this.takeBrowseRow();
            }
            const rows = studyRows(dictionary);
            this.data = { path, start: dictionary.start, rows, front, progress, unread };
            this.problem = "";
            // The card on screen stays, with the row as the note now has it, unless the note or the study language
            // has changed, the row no longer gives the card, or the card has been answered since, as on another
            // device.
            const card = this.card;
            const row = card && studiedRow(rows, card.row.number, front);
            const stays =
                card !== undefined &&
                row !== undefined &&
                sameNote &&
                card.from === front &&
                row.words.has(card.prompt) &&
                progress.get(card.row.number, card.direction, card.from)?.last === card.last;
            this.card = stays ? { ...card, row } : undefined;
        } catch (error) {
            this.data = undefined;
            this.problem = errorText(error);
            this.card = undefined;
        }
        if (!this.card) {
            this.revealed = false;
        }
        if (this.pointerDown) {
            this.renderOnRelease = true;
        } else {
            this.render();
        }
    }

    // Takes the row that Browse showed on another device if it was chosen there after the row here.
    private async takeBrowseRow(): Promise<void> {
        try {
            const browsed = await this.plugin.studyLog.readBrowseRow();
            if (browsed && browsed.time > this.browseTime) {
                this.browseNumber = browsed.row;
                this.browsePosition = -1;
                this.browseTime = browsed.time;
            }
        } catch (error) {
            console.warn("grundform: the row of Browse was not read", error);
        }
    }

    // The progress in the dictionary note from the answers of all devices.
    private async loadProgress(path: string): Promise<{ progress: Progress; unread: number }> {
        const read = await this.plugin.studyLog.read();
        return { progress: new Progress(forNote(read.entries, path)), unread: read.unread };
    }

    // The answers of this tab that Undo can take back: those of the note and the study language on screen.
    private undoable(data: StudyData): Answer[] {
        return this.given.filter((answer) => answer.from === data.front && answer.note === data.path);
    }

    private render(): void {
        const root = this.contentEl;
        root.replaceChildren();
        root.classList.add("gf-study");
        const bar = add(root, "div", "gf-study-bar");
        const modes = add(bar, "div", "gf-study-modes");
        for (const [mode, label] of [
            ["learn", "Learn"],
            ["browse", "Browse"],
        ] as const) {
            addButton(modes, mode === this.mode ? "is-active" : "", label, () => {
                this.mode = mode;
                this.serial(() => this.reload(true));
            });
        }
        const stats = add(bar, "div", "gf-muted gf-study-stats");
        const body = add(root, "div", "gf-study-body");
        if (!this.data) {
            add(body, "p", "gf-study-message", this.problem);
            return;
        }
        if (this.data.unread > 0) {
            const one = this.data.unread === 1;
            const files = one ? "1 study file is" : `${this.data.unread} study files are`;
            const answers = one ? "its answers count" : "their answers count";
            add(body, "p", "gf-muted", `${files} not downloaded yet; ${answers} once the sync brings them.`);
        }
        if (this.mode === "learn") {
            this.renderLearn(body, stats, this.data);
        } else {
            this.renderBrowse(body, stats, this.data);
        }
    }

    private renderLearn(body: HTMLElement, stats: HTMLElement, data: StudyData): void {
        const now = Date.now();
        const queue = studyQueue(data.rows, data.progress, data.front, this.newPerDay(), now);
        const days = streak(data.progress, now);
        // Plain words rather than the terms of Anki: the cards that come back and the new cards of the day.
        stats.textContent = [
            `${queue.due} to repeat`,
            `${queue.fresh} new ${queue.fresh === 1 ? "card" : "cards"} left today`,
            `${queue.answeredToday} answered today`,
            ...(days > 0 ? [`${days} ${days === 1 ? "day" : "days"} in a row`] : []),
        ].join(" · ");
        this.card ??= queue.next;
        const card = this.card;
        if (!card) {
            const message = add(body, "div", "gf-study-message");
            add(message, "p", "", "No more cards for today.");
            add(message, "p", "gf-muted", totalsText(data));
            this.addFooter(body, data);
            return;
        }

        const view = add(body, "div", "gf-study-card");
        const meta = add(view, "div", "gf-muted gf-study-meta");
        add(meta, "span", "", `No. ${card.row.number}`);
        const frontName = languageName(card.from);
        add(meta, "span", "", card.direction === "forward" ? `From ${frontName}` : `To ${frontName}`);
        if (card.isNew) {
            add(meta, "span", "gf-study-new", "new");
        }
        const prompt = add(view, "div", "gf-study-prompt");
        addLanguageLabel(prompt, card.prompt, "");
        addCellText(add(prompt, "div", "gf-study-word"), card.row.words.get(card.prompt)!.entry);

        if (!this.revealed) {
            const asks = add(view, "div", "gf-study-asks");
            for (const language of card.row.words.keys()) {
                if (language !== card.prompt) {
                    addLanguageLabel(asks, language, "");
                }
            }
            const dock = add(body, "div", "gf-study-dock");
            addButton(dock, "mod-cta gf-study-show", "Show answer", () => this.reveal());
            this.addFooter(dock, data);
            return;
        }

        this.addWords(view, card.row, card.prompt);
        const dock = add(body, "div", "gf-study-dock");
        const grades = add(dock, "div", "gf-study-grades");
        const outcomes = data.progress.preview(card, this.shownAt);
        for (const [rating, label] of kGrades) {
            const button = addButton(grades, `gf-grade gf-grade-${label.toLowerCase()}`, "", () => this.answer(rating));
            add(button, "span", "gf-grade-label", label);
            add(button, "span", "gf-grade-interval", formatInterval(outcomes.get(rating)! - this.shownAt));
        }
        this.addFooter(dock, data, card.row);
    }

    private renderBrowse(body: HTMLElement, stats: HTMLElement, data: StudyData): void {
        stats.textContent = totalsText(data);
        const rows = data.rows;
        if (rows.length === 0) {
            add(body, "p", "gf-study-message", "The dictionary note has no numbered rows.");
            return;
        }
        const index = this.browseIndex(rows);
        const row = rows[index]!;
        const view = add(body, "div", "gf-study-card");
        this.addWords(view, row);
        const studied = isStudied(row, data.front);
        const forward = data.progress.get(row.number, "forward", data.front);
        const reverse = data.progress.get(row.number, "reverse", data.front);
        if (studied) {
            const now = Date.now();
            const frontName = languageName(data.front);
            const status = add(view, "div", "gf-muted gf-study-status");
            add(status, "div", "", `From ${frontName}: ${cardStatus(forward, now)}`);
            add(status, "div", "", `To ${frontName}: ${cardStatus(reverse, now)}`);
        }

        // The pad: the marks of the row over the arrows and the row number.
        const dock = add(body, "div", "gf-study-dock");
        const pad = add(dock, "div", "gf-study-pad");
        const marks = add(pad, "div", "gf-study-pad-marks");
        const reset = addButton(marks, "gf-study-reset", "Reset", () => this.markRow(row, "reset"));
        reset.disabled = !studied || (!forward && !reverse);
        reset.title = "Make both cards of the row new again";
        const known = forward?.known === true && reverse?.known === true;
        const knownButton = addButton(marks, known ? "gf-study-known is-active" : "gf-study-known", "Known", () =>
            this.markRow(row, "known"),
        );
        knownButton.disabled = !studied || known;
        knownButton.title = "Take the row out of study as learned";
        const nav = add(pad, "div", "gf-study-nav");
        addButton(nav, "gf-study-arrow", "‹", () => this.browse(-1)).disabled = index === 0;
        const position = add(nav, "span", "gf-study-position");
        const input = add(position, "input", "gf-study-number");
        input.type = "text";
        input.enterKeyHint = "go";
        input.value = String(row.number);
        input.setAttribute("aria-label", "Row number");
        input.addEventListener("change", () => {
            const number = Number(input.value);
            if (Number.isInteger(number)) {
                this.showRow(number);
            }
        });
        // Return leaves the field, which commits the number; the number pad of the iPhone has no Return key.
        input.addEventListener("keydown", (event) => {
            if (event.key === "Enter") {
                input.blur();
            }
        });
        add(position, "span", "gf-muted", `of ${Math.max(...rows.map((item) => item.number))}`);
        addButton(nav, "gf-study-arrow", "›", () => this.browse(1)).disabled = index === rows.length - 1;
        this.addFooter(dock, data, row);
    }

    // The words of a row, each a link to its full card; the word the card showed is dimmed.
    private addWords(parent: HTMLElement, row: StudyRow, shown?: string): void {
        const list = add(parent, "div", "gf-study-words");
        for (const [language, word] of row.words) {
            const line = add(list, "div", language === shown ? "gf-study-line gf-study-shown" : "gf-study-line");
            addLanguageLabel(line, language, "");
            const text = add(line, "div", "gf-study-text");
            const query = lookupQuery(word.entry);
            const entry = addButton(text, "gf-study-entry", "", () => this.plugin.lookUp(query, language));
            entry.title = `Look up "${query}"`;
            addCellText(entry, word.entry);
            if (word.transcription) {
                addCellText(add(text, "span", "gf-ipa"), word.transcription);
            }
        }
    }

    private addFooter(parent: HTMLElement, data: StudyData, row?: StudyRow): void {
        const footer = add(parent, "div", "gf-study-footer");
        if (this.mode === "learn" && this.undoable(data).length > 0) {
            addButton(footer, "gf-study-link", "Undo", () => this.undo());
        }
        if (row) {
            addButton(footer, "gf-study-link", "Open the row in the note", () => {
                this.openRow(data, row).catch((error: unknown) => {
                    new Notice(`grundform: ${errorText(error)}`);
                });
            });
        }
    }

    private newPerDay(): number {
        const value = this.plugin.settings.newWordsPerDay;
        return Number.isInteger(value) && value >= 0 ? value : 10;
    }

    private reveal(): void {
        if (this.mode === "learn" && this.card && !this.revealed) {
            this.revealed = true;
            this.shownAt = Date.now();
            this.render();
        }
    }

    private answer(rating: Grade): void {
        const card = this.card;
        if (this.mode !== "learn" || !card || !this.revealed) {
            return;
        }
        const data = this.data;
        if (!data) {
            return;
        }
        // The answer takes the time the answer was shown, so that the intervals on the buttons are the ones applied,
        // unless the card was put aside for a while or the clock has been set back.
        const now = Date.now();
        const answer: Answer = {
            time: now - this.shownAt > kStaleMs || this.shownAt > now ? now : this.shownAt,
            row: card.row.number,
            from: card.from,
            direction: card.direction,
            rating,
            note: data.path,
        };
        this.serial(async () => {
            // An earlier answer or a reload may have taken the card away since the key press. A reload that kept the
            // card, as when the tab comes to the front with the press, leaves the answer to the data it read.
            const current = this.data;
            if (!current || current.path !== data.path || !this.card || !sameCard(this.card, card) || !this.revealed) {
                return;
            }
            try {
                await this.plugin.studyLog.append(answer);
                current.progress.add(answer);
                this.given.push(answer);
                this.card = undefined;
                this.revealed = false;
            } catch (error) {
                new Notice(`grundform: the answer was not saved: ${errorText(error)}`);
            }
            this.render();
        });
    }

    // Takes back the last answer of this tab for the current study language and shows its card again.
    private undo(): void {
        if (this.mode !== "learn") {
            return;
        }
        this.serial(async () => {
            const data = this.data;
            const answer = data && this.undoable(data).pop();
            if (!data || !answer) {
                return;
            }
            try {
                await this.plugin.studyLog.removeLast(answer);
            } catch (error) {
                // An answer that is no longer in the file, as after a reset of the study folder, cannot be undone.
                this.given.splice(this.given.lastIndexOf(answer), 1);
                new Notice(`grundform: ${errorText(error)}`);
                this.render();
                return;
            }
            this.given.splice(this.given.lastIndexOf(answer), 1);
            // The answers in memory without the removed one, and then those of all devices again.
            data.progress = new Progress([
                ...data.progress.answers.filter((item) => item !== answer),
                ...data.progress.marks,
            ]);
            try {
                ({ progress: data.progress, unread: data.unread } = await this.loadProgress(data.path));
            } catch (error) {
                new Notice(`grundform: the answers were not read again: ${errorText(error)}`);
            }
            const row = studiedRow(data.rows, answer.row, data.front);
            const progress = data.progress.get(answer.row, answer.direction, answer.from);
            this.card = row ? studyCard(row, answer.direction, answer.from, progress, Date.now()) : undefined;
            this.revealed = false;
            this.render();
        });
    }

    // Marks a row in Browse as known or as new again, for both of its cards in the study language.
    private markRow(row: StudyRow, kind: Mark["mark"]): void {
        this.serial(async () => {
            const data = this.data;
            if (!data || !isStudied(row, data.front)) {
                return;
            }
            const mark: Mark = { time: Date.now(), row: row.number, from: data.front, mark: kind, note: data.path };
            try {
                await this.plugin.studyLog.append(mark);
                data.progress.add(mark);
                // Learn picks its next card anew rather than show the row.
                if (this.card?.row.number === row.number && this.card.from === data.front) {
                    this.card = undefined;
                    this.revealed = false;
                }
            } catch (error) {
                new Notice(`grundform: the mark was not saved: ${errorText(error)}`);
            }
            this.render();
        });
    }

    // The position of the row that Browse shows: the remembered position while it holds the remembered number, or
    // else the first row with that number, the first row with a higher number, or the last row.
    private browseIndex(rows: readonly StudyRow[]): number {
        if (rows[this.browsePosition]?.number === this.browseNumber) {
            return this.browsePosition;
        }
        const exact = rows.findIndex((row) => row.number === this.browseNumber);
        const index = exact >= 0 ? exact : rows.findIndex((row) => row.number > this.browseNumber);
        return index >= 0 ? index : rows.length - 1;
    }

    private browse(offset: number): void {
        const rows = this.data?.rows;
        if (this.mode !== "browse" || !rows || rows.length === 0) {
            return;
        }
        const index = Math.min(rows.length - 1, Math.max(0, this.browseIndex(rows) + offset));
        this.showRow(rows[index]!.number, index);
    }

    // Shows the row and saves it for the other devices.
    private showRow(number: number, position = -1): void {
        this.browseNumber = number;
        this.browsePosition = position;
        this.browseTime = Date.now();
        this.saveBrowseRow();
        this.render();
    }

    // Opens the dictionary note at the row, in a tab that shows the note already or in a new tab. Live Preview and
    // reading mode draw the table as one block and scroll only as far as its start or end, so the row they draw is
    // scrolled to the middle of the tab.
    private async openRow(data: StudyData, row: StudyRow): Promise<void> {
        if (this.opening) {
            return;
        }
        this.opening = true;
        try {
            await this.showRowInNote(data, row);
        } finally {
            this.opening = false;
        }
    }

    private async showRowInNote(data: StudyData, row: StudyRow): Promise<void> {
        const file = this.app.vault.getFileByPath(data.path);
        if (!file) {
            new Notice(`grundform: ${data.path} does not exist.`);
            return;
        }
        const workspace = this.app.workspace;
        // A tab restored at startup holds a placeholder view until it is shown, so the tab is found by its state and
        // revealed, which loads the view with the mode the tab had.
        const found = workspace
            .getLeavesOfType("markdown")
            .find((item) => item.getViewState().state?.file === file.path);
        let leaf: WorkspaceLeaf;
        if (found) {
            await workspace.revealLeaf(found);
            workspace.setActiveLeaf(found, { focus: !Platform.isMobile });
            leaf = found;
        } else {
            leaf = workspace.getLeaf("tab");
            await leaf.openFile(file, { active: true });
        }
        const view = leaf.view;
        if (!(view instanceof MarkdownView)) {
            return;
        }
        let line = data.start + 2 + row.index;
        if (view.getMode() === "source") {
            // The line comes from the note as saved; an edit the editor has not saved yet can move the row, which is
            // then looked for near its line.
            const editor = view.editor;
            const holdsRow = (index: number): boolean =>
                index >= 0 && index < editor.lineCount() && firstCell(editor.getLine(index)) === String(row.number);
            if (!holdsRow(line)) {
                const near = [1, -1, 2, -2, 3, -3].map((offset) => line + offset).find(holdsRow);
                line = near ?? line;
            }
            // The cursor goes into the first cell of the row, ready for a correction: Live Preview moves a cursor
            // outside the cells to the last row. On a phone, a cursor in a cell opens the keyboard over the note,
            // so the cursor stays where it is.
            const position = { line, ch: Math.max(0, editor.getLine(line).search(/[^|\s]/)) };
            if (!Platform.isMobile) {
                editor.setCursor(position);
            }
            if (view.getState().source === true) {
                // The editor scrolls by estimated heights of the lines, which the long lines of the table exceed, so
                // the scroll is repeated until the lines it draws are measured and the position settles.
                for (let attempt = 0; attempt < 6; attempt++) {
                    const before = editor.getScrollInfo().top;
                    editor.scrollIntoView({ from: position, to: position }, true);
                    await sleep(100);
                    if (editor.getScrollInfo().top === before) {
                        return;
                    }
                }
                return;
            }
            // Live Preview draws only the lines near the visible part, so it scrolls to the table first.
            editor.scrollIntoView({ from: position, to: position }, true);
        } else {
            // The scroll by line, not the highlight that goes with it: reading mode would flash the whole table.
            view.previewMode.applyScroll(line);
        }
        const drawn = await drawnRow(view, row);
        if (!drawn) {
            new Notice(`grundform: row ${row.number} was not found in the note.`);
            return;
        }
        // The text above the table is still being measured in a tab that has just opened, so the scroll is repeated.
        for (let attempt = 0; attempt < 3; attempt++) {
            drawn.scrollIntoView({ block: "center" });
            await sleep(150);
        }
    }
}
