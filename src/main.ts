// The grundform Obsidian plugin: looks up a word and shows its card.

import { MarkdownView, normalizePath, Notice, Plugin, requestUrl, type RequestUrlParam } from "obsidian";
import type { AiSettings, PostJson } from "./ai.ts";
import { CardCache, cardCacheKey } from "./card-cache.ts";
import { DictionaryNote } from "./dictionary-note.ts";
import { parseLanguages } from "./languages.ts";
import { type CardLookup, lookUpCard } from "./lookup.ts";
import { CardModal, LookupModal } from "./modals.ts";
import { GrundformSettingTab, type GrundformSettings, kDefaultSettings } from "./settings.ts";
import { StudyLog } from "./study-log.ts";
import { kStudyViewType, StudyView } from "./study-view.ts";
import type { GetText } from "./wiktionary.ts";

// Longer text is a sentence or a paragraph selected by mistake rather than a word or phrase.
const kMaxQueryLength = 80;
// A lookup waits this long for the card cache, which WebKit may leave without an answer after the app resumes.
const kCacheWaitMs = 1000;

// A copy of settings, which are plain JSON; structuredClone is missing before iOS 15.4.
function copy<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
}

// requestUrl uses the native networking of Obsidian, which CORS does not restrict.
async function sendRequest(request: RequestUrlParam, timeoutMs: number): Promise<{ status: number; text: string }> {
    let timer: number | undefined;
    const timeout = new Promise<never>((_, reject) => {
        timer = window.setTimeout(() => reject(new Error(`No response in ${timeoutMs / 1000} s`)), timeoutMs);
    });
    try {
        const response = await Promise.race([requestUrl({ ...request, throw: false }), timeout]);
        return { status: response.status, text: response.text };
    } finally {
        window.clearTimeout(timer);
    }
}

const postWithRequestUrl: PostJson = (url, headers, body, timeoutMs) =>
    sendRequest({ url, method: "POST", headers, body }, timeoutMs);

const getWithRequestUrl: GetText = (url, headers, timeoutMs) => sendRequest({ url, method: "GET", headers }, timeoutMs);

export default class GrundformPlugin extends Plugin {
    settings: GrundformSettings = { ...kDefaultSettings };
    // The settings as data.json held them when this device last read or wrote it, to tell a change made here from
    // one that another device synced in meanwhile.
    private stored: GrundformSettings = { ...kDefaultSettings };
    readonly dictionary = new DictionaryNote(this);
    // One cache per vault on this device.
    readonly cache = new CardCache(`grundform-cache-${this.app.vault.getName()}`);
    // The answers of the study tab, in the plugin folder, which the vault syncs to the other devices.
    readonly studyLog = new StudyLog(
        this.app.vault.adapter,
        normalizePath(`${this.manifest.dir ?? `${this.app.vault.configDir}/plugins/${this.manifest.id}`}/study`),
    );

    async onload(): Promise<void> {
        await this.loadSettings();
        this.register(() => this.cache.close());
        this.addSettingTab(new GrundformSettingTab(this.app, this));

        this.registerView(kStudyViewType, (leaf) => new StudyView(leaf, this));

        this.addRibbonIcon("languages", "Look up a word in grundform", () => this.openLookup());
        this.addRibbonIcon("graduation-cap", "Study the grundform dictionary", () => void this.openStudy());
        this.addCommand({
            id: "look-up-word",
            name: "Look up a word",
            icon: "languages",
            callback: () => this.openLookup(),
        });
        this.addCommand({
            id: "study",
            name: "Study the dictionary",
            icon: "graduation-cap",
            callback: () => void this.openStudy(),
        });
        this.addCommand({
            id: "look-up-selection",
            name: "Look up the selection",
            icon: "languages",
            callback: () => {
                const selection = this.selectedText();
                if (selection) {
                    this.lookUp(selection);
                } else {
                    new Notice("Select a word first.");
                }
            },
        });

        this.registerEvent(
            this.app.workspace.on("editor-menu", (menu, editor) => {
                // The selection, or else the word at the cursor.
                let query = editor.getSelection().trim();
                if (!query) {
                    const word = editor.wordAt(editor.getCursor());
                    query = word ? editor.getRange(word.from, word.to).trim() : "";
                }
                if (!query) {
                    return;
                }
                const label = query.length > 30 ? `${query.slice(0, 30)}…` : query;
                menu.addItem((item) =>
                    item
                        .setTitle(`Look up "${label}" in grundform`)
                        .setIcon("languages")
                        .onClick(() => this.lookUp(query)),
                );
            }),
        );

        this.registerEvent(this.app.vault.on("rename", (file, oldPath) => this.dictionary.followRename(file, oldPath)));

        // Another device may have changed the settings while this one was in the background.
        this.registerDomEvent(document, "visibilitychange", () => {
            if (document.visibilityState === "visible") {
                this.takeStoredSettings().then(
                    (changed) => {
                        if (changed) {
                            this.refreshStudyViews();
                        }
                    },
                    (error: unknown) => {
                        console.warn("grundform: the settings were not read again", error);
                    },
                );
            }
        });

        // obsidian://grundform?word=ablegen&lang=de opens the card, for example from a Shortcut in the iOS Share sheet.
        this.registerObsidianProtocolHandler("grundform", (params) => {
            const word = params.word?.trim();
            if (word) {
                this.lookUp(word, params.lang);
            } else {
                new Notice("The grundform link has no word parameter.");
            }
        });
    }

    // The settings in data.json. Only the settings this version knows: a key of a removed setting drops out of
    // data.json on the next save.
    private async readSettings(): Promise<GrundformSettings> {
        const saved = ((await this.loadData()) ?? {}) as Record<string, unknown>;
        const known = Object.fromEntries(Object.entries(saved).filter(([key]) => key in kDefaultSettings));
        return { ...kDefaultSettings, ...known, languages: parseLanguages(saved.languages) };
    }

    private async loadSettings(): Promise<void> {
        this.stored = await this.readSettings();
        this.settings = copy(this.stored);
    }

    // Takes each setting that changed in data.json since this device last read or wrote it, unless it changed here as
    // well; returns whether any did. A device that kept old settings in memory would otherwise write them back.
    private async takeStoredSettings(): Promise<boolean> {
        const disk = await this.readSettings();
        const settings = this.settings as unknown as Record<string, unknown>;
        const stored = this.stored as unknown as Record<string, unknown>;
        let changed = false;
        for (const [key, value] of Object.entries(disk)) {
            const there = JSON.stringify(value);
            if (
                there !== JSON.stringify(stored[key]) &&
                JSON.stringify(settings[key]) === JSON.stringify(stored[key])
            ) {
                settings[key] = copy(value);
                changed = true;
            }
        }
        this.stored = disk;
        return changed;
    }

    // No onExternalSettingsChange: Obsidian calls it for every change of data.json on disk that it takes for an
    // external one and then redraws the open settings tab, which takes the focus away from a field being edited.
    // The changes of other devices are taken here and when Obsidian comes back to the foreground instead.
    async saveSettings(): Promise<void> {
        // A data.json that cannot be read is written over, as before.
        await this.takeStoredSettings().catch(() => false);
        await this.saveData(this.settings);
        this.stored = copy(this.settings);
        this.refreshStudyViews();
    }

    private refreshStudyViews(): void {
        for (const leaf of this.app.workspace.getLeavesOfType(kStudyViewType)) {
            if (leaf.view instanceof StudyView) {
                leaf.view.refresh();
            }
        }
    }

    // The selected text of the active note: the editor selection in editing mode, the page selection in reading mode.
    private selectedText(): string {
        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (view?.getMode() === "source") {
            return view.editor.getSelection().trim();
        }
        return activeWindow.getSelection()?.toString().trim() ?? "";
    }

    private openLookup(): void {
        new LookupModal(this.app, (query) => this.lookUp(query)).open();
    }

    // Shows the study tab, opening it in a new tab the first time, and reads the answers of other devices again.
    private async openStudy(): Promise<void> {
        const workspace = this.app.workspace;
        let leaf = workspace.getLeavesOfType(kStudyViewType)[0];
        if (!leaf) {
            leaf = workspace.getLeaf("tab");
            await leaf.setViewState({ type: kStudyViewType, active: true });
        } else if (leaf.view instanceof StudyView) {
            leaf.view.freshen();
        }
        await workspace.revealLeaf(leaf);
    }

    // The card from the cache, or else a new lookup, which the cache keeps once Wiktionary has checked it. A cache
    // that cannot be read or written only makes the lookup slower. With fresh set, the cache is skipped and its card
    // replaced, or removed when the new card is not kept.
    private async lookUpCached(
        ai: AiSettings,
        languages: readonly string[],
        query: string,
        languageHint: string | undefined,
        fresh: boolean,
    ): Promise<CardLookup> {
        const key = cardCacheKey(ai, languages, query, languageHint);
        const cached = fresh
            ? undefined
            : await Promise.race([this.cache.get(key), sleep(kCacheWaitMs).then(() => undefined)]).catch(
                  () => undefined,
              );
        if (cached) {
            return cached;
        }
        const lookup = await lookUpCard(ai, languages, query, languageHint, postWithRequestUrl, getWithRequestUrl);
        // A card for a word the model did not find, or one Wiktionary could not check, is asked for again next time.
        if (lookup.card.found && lookup.wiktionary !== "unavailable") {
            this.cache.put(key, lookup).catch((error: unknown) => {
                console.warn("grundform: the card was not cached", error);
            });
        } else if (fresh) {
            this.cache.delete(key).catch((error: unknown) => {
                console.warn("grundform: the cached card was not removed", error);
            });
        }
        return lookup;
    }

    lookUp(query: string, languageHint?: string, fresh = false): void {
        const { baseUrl, apiKey, model, reasoningEffort, languages } = this.settings;
        if (!apiKey) {
            new Notice("Put the API key into the grundform settings.");
            return;
        }
        if (query.length > kMaxQueryLength) {
            new Notice(`grundform looks up a word or a short phrase of up to ${kMaxQueryLength} characters.`);
            return;
        }
        const ai: AiSettings = { baseUrl, apiKey, model, ...(reasoningEffort ? { reasoningEffort } : {}) };
        const result = this.lookUpCached(ai, languages, query, languageHint, fresh);
        new CardModal(
            this.app,
            query,
            languages,
            model,
            result,
            this.dictionary,
            () => this.lookUp(query, languageHint, true),
            (language) => this.lookUp(query, language),
        ).open();
    }
}
