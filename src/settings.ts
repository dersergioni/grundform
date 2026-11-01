// Plugin settings and their tab in the Obsidian settings.

import { type App, Notice, PluginSettingTab, Setting } from "obsidian";
import { CreateDictionaryModal, NotePickerModal } from "./dictionary-modals.ts";
import { kDefaultLanguages, kLanguages, kMinLanguages, languageName } from "./languages.ts";
import type GrundformPlugin from "./main.ts";
import { errorText } from "./ui.ts";

export interface GrundformSettings {
    baseUrl: string;
    apiKey: string;
    model: string;
    // Empty keeps the provider default.
    reasoningEffort: string;
    // Language codes in the order of the card columns.
    languages: string[];
    // The dictionary note that Save appends rows to; empty when none is chosen.
    dictionaryPath: string;
    // The language that forward study cards show; empty for the first language of the dictionary note.
    studyFrom: string;
    // The new cards a day, forward and reverse together; the key keeps its first name, under which data.json has it.
    newWordsPerDay: number;
}

export const kDefaultSettings: GrundformSettings = {
    baseUrl: "https://api.openai.com/v1",
    apiKey: "",
    model: "gpt-6.1-terra",
    reasoningEffort: "none",
    languages: [...kDefaultLanguages],
    dictionaryPath: "",
    studyFrom: "",
    newWordsPerDay: 10,
};

const kEfforts = ["", "none", "low", "medium", "high"];

export class GrundformSettingTab extends PluginSettingTab {
    private readonly plugin: GrundformPlugin;

    constructor(app: App, plugin: GrundformPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        const settings = this.plugin.settings;
        containerEl.empty();

        new Setting(containerEl)
            .setName("API base URL")
            .setDesc("An OpenAI-compatible API, for example https://api.openai.com/v1 or https://api.x.ai/v1.")
            .addText((text) =>
                text.setValue(settings.baseUrl).onChange(async (value) => {
                    settings.baseUrl = value.trim().replace(/\/+$/, "");
                    await this.plugin.saveSettings();
                }),
            );

        new Setting(containerEl)
            .setName("API key")
            .setDesc("Stored in data.json in the plugin folder of the vault.")
            .addText((text) => {
                text.inputEl.type = "password";
                text.setValue(settings.apiKey).onChange(async (value) => {
                    settings.apiKey = value.trim();
                    await this.plugin.saveSettings();
                });
            });

        new Setting(containerEl)
            .setName("Model")
            .setDesc("For example gpt-6.1-terra or grok-4.3.")
            .addText((text) =>
                text.setValue(settings.model).onChange(async (value) => {
                    settings.model = value.trim();
                    await this.plugin.saveSettings();
                }),
            );

        new Setting(containerEl)
            .setName("Reasoning effort")
            .setDesc("Sent as reasoning_effort. Choose provider default for a model that does not accept it.")
            .addDropdown((dropdown) => {
                for (const effort of kEfforts) {
                    dropdown.addOption(effort, effort || "provider default");
                }
                dropdown.setValue(settings.reasoningEffort).onChange(async (value) => {
                    settings.reasoningEffort = value;
                    await this.plugin.saveSettings();
                });
            });

        this.displayDictionary(containerEl);
        this.displayLanguages(containerEl);
        this.displayStudy(containerEl);
        this.displayCache(containerEl);
    }

    // The language that study cards ask from and the number of new cards a day.
    private displayStudy(containerEl: HTMLElement): void {
        const settings = this.plugin.settings;
        new Setting(containerEl)
            .setName("Study")
            .setDesc("The study tab asks for each row of the dictionary note in both directions.")
            .setHeading();
        new Setting(containerEl)
            .setName("Study from")
            .setDesc(
                "The forward card shows the word in this language and asks for the rest of the row; the reverse card shows the word in another language and asks for the rest. A language without a column in the dictionary note gives way to its first language. Each language has its own progress.",
            )
            .addDropdown((dropdown) => {
                dropdown.addOption("", "First language of the dictionary note");
                for (const code of new Set([
                    ...settings.languages,
                    ...(settings.studyFrom ? [settings.studyFrom] : []),
                ])) {
                    dropdown.addOption(code, languageName(code));
                }
                dropdown.setValue(settings.studyFrom).onChange(async (value) => {
                    settings.studyFrom = value;
                    await this.plugin.saveSettings();
                });
            });
        new Setting(containerEl)
            .setName("New cards a day")
            .setDesc(
                "The new cards a day, forward and reverse together. A row gives two cards: the forward card first, the reverse card from the next day on.",
            )
            .addText((text) => {
                text.inputEl.inputMode = "numeric";
                text.setValue(String(settings.newWordsPerDay)).onChange(async (value) => {
                    const number = Number(value.trim());
                    if (value.trim() !== "" && Number.isInteger(number) && number >= 0) {
                        settings.newWordsPerDay = number;
                        await this.plugin.saveSettings();
                    }
                });
            });
    }

    // The number of cached cards and a button that empties the cache.
    private displayCache(containerEl: HTMLElement): void {
        new Setting(containerEl)
            .setName("Cache")
            .setDesc("Cards of earlier lookups, kept on this device so that a repeated lookup opens at once.")
            .setHeading();
        const setting = new Setting(containerEl).setName("Cached cards").addButton((button) =>
            button.setButtonText("Clear cache").onClick(async () => {
                try {
                    await this.plugin.cache.clear();
                    new Notice("The grundform cache is empty.");
                } catch (error) {
                    new Notice(`grundform: ${errorText(error)}`);
                }
                this.display();
            }),
        );
        // Block bodies for the same reason as in displayDictionary: a Setting has a then method.
        this.plugin.cache.count().then(
            (count) => {
                setting.setDesc(`${count} ${count === 1 ? "card" : "cards"} on this device.`);
            },
            (error) => {
                setting.setDesc(errorText(error));
            },
        );
    }

    // The dictionary note with its state, and buttons to choose an existing note or create a new one.
    private displayDictionary(containerEl: HTMLElement): void {
        new Setting(containerEl)
            .setName("Dictionary")
            .setDesc("Save appends rows to this note. Choosing a note takes the card languages from its columns.")
            .setHeading();
        const setting = new Setting(containerEl)
            .setName("Dictionary note")
            .setDesc(this.plugin.settings.dictionaryPath || "No dictionary note is chosen.")
            .addButton((button) =>
                button.setButtonText("Choose…").onClick(() =>
                    new NotePickerModal(this.app, (file) => {
                        void this.report(this.plugin.dictionary.use(file.path));
                    }).open(),
                ),
            )
            .addButton((button) =>
                button.setButtonText("Create…").onClick(() => {
                    // The folder of the current dictionary note, or the vault root.
                    const current = this.plugin.settings.dictionaryPath;
                    const folder = current.includes("/") ? current.slice(0, current.lastIndexOf("/")) : "";
                    new CreateDictionaryModal(this.app, folder, "grundform Dictionary", (path) => {
                        void this.report(this.plugin.dictionary.create(path));
                    }).open();
                }),
            );
        // The callbacks return nothing: a Setting has a then method, and a promise resolved with it calls that method
        // again and again, which hangs Obsidian.
        this.plugin.dictionary.describe().then(
            (text) => {
                setting.setDesc(text);
            },
            (error) => {
                setting.setDesc(errorText(error));
            },
        );
    }

    // Shows the outcome of choosing or creating the dictionary note and redraws the settings.
    private async report(action: Promise<string>): Promise<void> {
        try {
            new Notice(await action);
        } catch (error) {
            new Notice(`grundform: ${errorText(error)}`);
        }
        this.display();
    }

    // The card languages in column order, each with buttons to move or remove it, and a menu to add one.
    private displayLanguages(containerEl: HTMLElement): void {
        const languages = this.plugin.settings.languages;
        const update = async (next: string[]): Promise<void> => {
            this.plugin.settings.languages = next;
            try {
                await this.plugin.saveSettings();
            } catch (error) {
                new Notice(`grundform: ${errorText(error)}`);
            }
            this.display();
        };

        new Setting(containerEl)
            .setName("Card languages")
            .setDesc(`The columns of the card, in this order. A card needs at least ${kMinLanguages} languages.`)
            .setHeading();

        languages.forEach((code, index) => {
            const moved = (offset: number): string[] => {
                const next = [...languages];
                [next[index], next[index + offset]] = [next[index + offset]!, next[index]!];
                return next;
            };
            new Setting(containerEl)
                .setName(`${languageName(code)} (${code})`)
                .addExtraButton((button) =>
                    button
                        .setIcon("arrow-up")
                        .setTooltip("Move up")
                        .setDisabled(index === 0)
                        .onClick(() => update(moved(-1))),
                )
                .addExtraButton((button) =>
                    button
                        .setIcon("arrow-down")
                        .setTooltip("Move down")
                        .setDisabled(index === languages.length - 1)
                        .onClick(() => update(moved(1))),
                )
                .addExtraButton((button) =>
                    button
                        .setIcon("trash")
                        .setTooltip("Remove")
                        .setDisabled(languages.length <= kMinLanguages)
                        .onClick(() => update(languages.filter((item) => item !== code))),
                );
        });

        const available = kLanguages.filter((language) => !languages.includes(language.code));
        if (available.length === 0) {
            return;
        }
        let selected = available[0]!.code;
        new Setting(containerEl)
            .setName("Add a language")
            .addDropdown((dropdown) => {
                for (const language of available) {
                    dropdown.addOption(language.code, `${language.name} (${language.code})`);
                }
                dropdown.setValue(selected).onChange((value) => {
                    selected = value;
                });
            })
            .addButton((button) => button.setButtonText("Add").onClick(() => update([...languages, selected])));
    }
}
