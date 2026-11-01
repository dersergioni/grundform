// The modals around the dictionary note: choosing a note, creating one and saving a sense as a row.

import {
    AbstractInputSuggest,
    type App,
    FuzzySuggestModal,
    Modal,
    Notice,
    Setting,
    TextComponent,
    type TFile,
    TFolder,
} from "obsidian";
import type { DictionaryColumn } from "./dictionary.ts";
import type { DictionaryNote } from "./dictionary-note.ts";
import { errorText, plainInput } from "./ui.ts";

export class NotePickerModal extends FuzzySuggestModal<TFile> {
    private readonly onChoose: (file: TFile) => void;

    constructor(app: App, onChoose: (file: TFile) => void) {
        super(app);
        this.onChoose = onChoose;
        this.setPlaceholder("Choose the dictionary note");
    }

    getItems(): TFile[] {
        return this.app.vault.getMarkdownFiles();
    }

    getItemText(file: TFile): string {
        return file.path;
    }

    onChooseItem(file: TFile): void {
        this.onChoose(file);
    }
}

// Suggests the folders of the vault under a text field, as Obsidian does in its own settings.
class FolderSuggest extends AbstractInputSuggest<TFolder> {
    private readonly onPick: () => void;

    constructor(app: App, input: HTMLInputElement, onPick: () => void) {
        super(app, input);
        this.onPick = onPick;
    }

    protected getSuggestions(query: string): TFolder[] {
        const lower = query.toLowerCase();
        return this.app.vault
            .getAllLoadedFiles()
            .filter((file): file is TFolder => file instanceof TFolder)
            .filter((folder) => folder.path.toLowerCase().includes(lower))
            .sort((a, b) => a.path.localeCompare(b.path));
    }

    renderSuggestion(folder: TFolder, el: HTMLElement): void {
        el.setText(folder.isRoot() ? "/" : folder.path);
    }

    selectSuggestion(folder: TFolder): void {
        this.setValue(folder.isRoot() ? "" : folder.path);
        this.onPick();
        this.close();
    }
}

// The folder and the name of a new dictionary note, with the path they give.
export class CreateDictionaryModal extends Modal {
    private readonly folder: string;
    private readonly name: string;
    private readonly onCreate: (path: string) => void;

    constructor(app: App, folder: string, name: string, onCreate: (path: string) => void) {
        super(app);
        this.folder = folder;
        this.name = name;
        this.onCreate = onCreate;
    }

    onOpen(): void {
        this.titleEl.setText("Create a dictionary note");
        this.contentEl.createEl("p", {
            cls: "gf-muted",
            text: "The note gets an empty table with a column for each card language and a transcription column for each of them except Russian.",
        });
        const folderSetting = new Setting(this.contentEl)
            .setName("Folder")
            .setDesc("Empty for the root of the vault. Type to see the folders.");
        const folder = new TextComponent(folderSetting.controlEl).setPlaceholder("Vault root").setValue(this.folder);
        const name = new TextComponent(new Setting(this.contentEl).setName("Note name").controlEl).setValue(this.name);
        const preview = new Setting(this.contentEl).setName("New note");

        const path = (): string => {
            const folderPath = folder
                .getValue()
                .trim()
                .replace(/^\/+|\/+$/g, "");
            const fileName = name.getValue().trim();
            const file = fileName && !fileName.endsWith(".md") ? `${fileName}.md` : fileName;
            return file && folderPath ? `${folderPath}/${file}` : file;
        };
        const showPath = (): void => {
            preview.setDesc(path() || "Type a note name.");
        };
        const submit = (): void => {
            const target = path();
            if (target) {
                this.close();
                this.onCreate(target);
            }
        };

        for (const text of [folder, name]) {
            text.inputEl.addClass("gf-wide-input");
            plainInput(text.inputEl);
            text.onChange(showPath);
        }
        new FolderSuggest(this.app, folder.inputEl, showPath);
        name.inputEl.addEventListener("keydown", (event) => {
            if (event.key === "Enter" && !event.isComposing) {
                // Closing the modal gives the focus back to the Create… button of the settings, and the rest of this
                // key press would press it again.
                event.preventDefault();
                submit();
            }
        });
        new Setting(this.contentEl).addButton((button) => button.setButtonText("Create").setCta().onClick(submit));
        showPath();
        name.inputEl.focus();
        name.inputEl.select();
    }

    onClose(): void {
        this.contentEl.empty();
    }
}

// The row a sense becomes, one field per column, to check and correct before it is appended.
export class SaveModal extends Modal {
    private readonly columns: DictionaryColumn[];
    private readonly values: Map<string, string>;
    private readonly notes: string[];
    private readonly dictionary: DictionaryNote;
    private readonly onSaved: (number: number) => void;

    constructor(
        app: App,
        columns: DictionaryColumn[],
        values: Map<string, string>,
        notes: string[],
        dictionary: DictionaryNote,
        onSaved: (number: number) => void,
    ) {
        super(app);
        this.columns = columns;
        this.values = values;
        this.notes = notes;
        this.dictionary = dictionary;
        this.onSaved = onSaved;
    }

    onOpen(): void {
        this.titleEl.setText("Save to the dictionary");
        for (const column of this.columns) {
            if (column.kind === "number") {
                continue;
            }
            new Setting(this.contentEl).setName(column.header).addText((text) => {
                text.inputEl.addClass("gf-wide-input");
                plainInput(text.inputEl);
                text.setValue(this.values.get(column.header) ?? "").onChange((value) => {
                    this.values.set(column.header, value);
                });
            });
        }
        for (const note of this.notes) {
            this.contentEl.createEl("p", { cls: "gf-muted", text: note });
        }
        new Setting(this.contentEl)
            .addButton((button) =>
                button
                    .setButtonText("Save")
                    .setCta()
                    .onClick(async () => {
                        button.setDisabled(true);
                        try {
                            const number = await this.dictionary.append(this.values);
                            new Notice(`Saved as row ${number}.`);
                            this.onSaved(number);
                            this.close();
                        } catch (error) {
                            button.setDisabled(false);
                            new Notice(`Saving failed: ${errorText(error)}`);
                        }
                    }),
            )
            .addButton((button) => button.setButtonText("Cancel").onClick(() => this.close()));
    }

    onClose(): void {
        this.contentEl.empty();
    }
}
