// The dictionary note of the settings: reading its table, appending rows, and choosing, creating and following
// the note.

import { MarkdownView, normalizePath, type TAbstractFile, type TFile, TFolder } from "obsidian";
import { appendRow, type Dictionary, dictionaryLanguages, newDictionaryText, parseDictionary } from "./dictionary.ts";
import { kMinLanguages, languageName } from "./languages.ts";
import type GrundformPlugin from "./main.ts";
import { errorText } from "./ui.ts";

export class DictionaryNote {
    private readonly plugin: GrundformPlugin;

    constructor(plugin: GrundformPlugin) {
        this.plugin = plugin;
    }

    private get path(): string {
        return this.plugin.settings.dictionaryPath.trim();
    }

    private file(path: string): TFile {
        const file = this.plugin.app.vault.getFileByPath(normalizePath(path));
        if (!file) {
            throw new Error(`The dictionary note ${path} does not exist.`);
        }
        return file;
    }

    private async parse(file: TFile): Promise<Dictionary> {
        const dictionary = parseDictionary(await this.plugin.app.vault.cachedRead(file));
        if (!dictionary) {
            throw new Error(`${file.path} has no dictionary table: a table whose first column is "No.", "Nr." or "#".`);
        }
        return dictionary;
    }

    // The table of the note, or undefined when no note is chosen. Throws when the note cannot be used.
    async read(): Promise<Dictionary | undefined> {
        return this.path ? this.parse(this.file(this.path)) : undefined;
    }

    // Appends a row with the values keyed by column header and returns its number.
    async append(values: Map<string, string>): Promise<number> {
        if (!this.path) {
            throw new Error("No dictionary note is chosen.");
        }
        const file = this.file(this.path);
        // An editor of the note writes its changes to the file with a delay; saving them first puts them into the
        // text that process reads.
        for (const leaf of this.plugin.app.workspace.getLeavesOfType("markdown")) {
            if (leaf.view instanceof MarkdownView && leaf.view.file?.path === file.path) {
                await leaf.view.save();
            }
        }
        // Vault.process reads and writes the note in one step, so the row number is computed on the current text.
        let number = 0;
        await this.plugin.app.vault.process(file, (text) => {
            const result = appendRow(text, values);
            number = result.number;
            return result.text;
        });
        return number;
    }

    // One line for the settings: the note's rows and languages, or what keeps the plugin from using it.
    async describe(): Promise<string> {
        let dictionary: Dictionary | undefined;
        try {
            dictionary = await this.read();
        } catch (error) {
            return errorText(error);
        }
        if (!dictionary) {
            return "No dictionary note is chosen.";
        }
        const languages = dictionaryLanguages(dictionary);
        const missing = this.plugin.settings.languages.filter((code) => !languages.includes(code));
        return [
            `${this.path}: ${dictionary.rows.length} ${dictionary.rows.length === 1 ? "row" : "rows"}; ${languages.map(languageName).join(", ")}.`,
            ...(missing.length > 0 ? [`No column for ${missing.map(languageName).join(", ")}: not saved.`] : []),
            ...(dictionary.joinedLine !== undefined
                ? [`Line ${dictionary.joinedLine + 1} follows the table without a blank line; add one before saving.`]
                : []),
            ...(dictionary.splitLine !== undefined
                ? [`Line ${dictionary.splitLine + 1} is a comment or code inside the table; move it out before saving.`]
                : []),
        ].join(" ");
    }

    // Makes the note the dictionary and takes the card languages from its columns.
    async use(path: string): Promise<string> {
        const dictionary = await this.parse(this.file(path));
        const settings = this.plugin.settings;
        settings.dictionaryPath = path;
        const languages = [...new Set(dictionaryLanguages(dictionary))];
        if (languages.length >= kMinLanguages) {
            settings.languages = languages;
        }
        await this.plugin.saveSettings();
        return `Dictionary: ${path}. Card languages: ${settings.languages.map(languageName).join(", ")}.`;
    }

    // Creates a note with an empty table for the card languages and makes it the dictionary.
    async create(path: string): Promise<string> {
        const vault = this.plugin.app.vault;
        const normalized = normalizePath(path.endsWith(".md") ? path : `${path}.md`);
        // The adapter also finds a note whose name differs only in case, which macOS and iOS treat as the same file.
        if (await vault.adapter.exists(normalized)) {
            throw new Error(`${normalized} already exists. Choose it instead.`);
        }
        const parts = normalized.split("/").slice(0, -1);
        for (let depth = 1; depth <= parts.length; depth++) {
            const folder = parts.slice(0, depth).join("/");
            if (!vault.getFolderByPath(folder)) {
                await vault.createFolder(folder);
            }
        }
        const settings = this.plugin.settings;
        const title = normalized.split("/").pop()!.replace(/\.md$/, "");
        await vault.create(normalized, newDictionaryText(title, settings.languages));
        settings.dictionaryPath = normalized;
        await this.plugin.saveSettings();
        return `Created ${normalized} with ${settings.languages.map(languageName).join(", ")}.`;
    }

    // Keeps the setting on the note when the note or one of its folders is renamed or moved.
    followRename(file: TAbstractFile, oldPath: string): void {
        if (!this.path) {
            return;
        }
        const path = normalizePath(this.path);
        const settings = this.plugin.settings;
        if (path === oldPath) {
            settings.dictionaryPath = file.path;
        } else if (file instanceof TFolder && path.startsWith(`${oldPath}/`)) {
            settings.dictionaryPath = file.path + path.slice(oldPath.length);
        } else {
            return;
        }
        this.plugin.saveSettings().catch((error: unknown) => {
            console.warn("grundform: the new path of the dictionary note was not saved", error);
        });
    }
}
