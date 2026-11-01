// The answers of the study tab: files in the plugin folder, one per device and month, such as
// "desktop-k3j9x2-2026-11.jsonl", with one JSON answer per line, such as
// {"time":1762164900000,"row":12,"from":"ru","direction":"forward","rating":3,"note":"Dictionary.md"}. Each device
// writes only its own
// files, so a sync of the vault never has to merge two versions of a file; the study tab reads the files of all
// devices. A new file each month keeps the files small and the file being written recent.

import { type DataAdapter, Platform } from "obsidian";
import type { Answer } from "./study.ts";

const kDeviceKey = "grundform-device";
const kDayMs = 24 * 3_600_000;
// The name iCloud gives a file on iOS while the file itself is not downloaded, such as ".a-2026-11.jsonl.icloud".
const kPlaceholder = /^\..+\.jsonl\.icloud$/;

export interface StudyAnswers {
    answers: Answer[];
    // Files that could not be read, such as files of another device that iCloud has not downloaded yet.
    unread: number;
}

function parseAnswer(line: string): Answer | undefined {
    let value: unknown;
    try {
        value = JSON.parse(line);
    } catch {
        // A line that a sync has not finished writing yet.
        return undefined;
    }
    const { time, row, from, direction, rating, note } = (value ?? {}) as Record<string, unknown>;
    const valid =
        typeof time === "number" &&
        (note === undefined || typeof note === "string") &&
        Number.isInteger(row) &&
        typeof from === "string" &&
        from !== "" &&
        (direction === "forward" || direction === "reverse") &&
        (rating === 1 || rating === 2 || rating === 3 || rating === 4);
    return valid ? { time, row: row as number, from, direction, rating, note: note ?? "" } : undefined;
}

function serialize(answer: Answer): string {
    const { time, row, from, direction, rating, note } = answer;
    return JSON.stringify({ time, row, from, direction, rating, ...(note ? { note } : {}) });
}

function fileName(path: string): string {
    return path.slice(path.lastIndexOf("/") + 1);
}

export class StudyLog {
    private readonly adapter: DataAdapter;
    private readonly folder: string;
    // Files of this device whose last line has been checked in this session.
    private readonly checked = new Set<string>();
    // Writes run one after another, so that removing a line never loses a line appended meanwhile.
    private writes: Promise<unknown> = Promise.resolve();

    constructor(adapter: DataAdapter, folder: string) {
        this.adapter = adapter;
        this.folder = folder;
    }

    // The file of this device for the month of an answer. The device keeps its id in its local storage; a device
    // that has lost it starts new files and still reads the old ones.
    private file(time: number): string {
        let id = "";
        try {
            id = window.localStorage.getItem(kDeviceKey) ?? "";
            if (!id) {
                id = `${Platform.isMobile ? "mobile" : "desktop"}-${Math.random().toString(36).slice(2, 8)}`;
                window.localStorage.setItem(kDeviceKey, id);
            }
        } catch {
            id ||= "device";
        }
        const date = new Date(time);
        const month = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
        return `${this.folder}/${id}-${month}.jsonl`;
    }

    // The answers of all devices. Lines that are not answers, answers dated more than a day ahead and repeated
    // answers, such as those of a copy that a sync made of a file, are skipped.
    async read(): Promise<StudyAnswers> {
        const result: StudyAnswers = { answers: [], unread: 0 };
        if (!(await this.adapter.exists(this.folder))) {
            return result;
        }
        const seen = new Set<string>();
        const latest = Date.now() + kDayMs;
        for (const path of (await this.adapter.list(this.folder)).files) {
            const name = fileName(path);
            if (kPlaceholder.test(name)) {
                result.unread++;
                continue;
            }
            if (!name.endsWith(".jsonl")) {
                continue;
            }
            let text: string;
            try {
                text = await this.adapter.read(path);
            } catch {
                result.unread++;
                continue;
            }
            // A device clock set back must not reorder the answers of its file.
            let previous = 0;
            for (const line of text.split("\n")) {
                const answer = line.trim() ? parseAnswer(line) : undefined;
                if (!answer || answer.time > latest) {
                    continue;
                }
                // The key is the line as written, so that two answers clamped to one time still both count.
                const key = serialize(answer);
                answer.time = Math.max(answer.time, previous);
                previous = answer.time;
                if (!seen.has(key)) {
                    seen.add(key);
                    result.answers.push(answer);
                }
            }
        }
        return result;
    }

    private serial<T>(task: () => Promise<T>): Promise<T> {
        const result = this.writes.then(task);
        this.writes = result.catch(() => undefined);
        return result;
    }

    append(answer: Answer): Promise<void> {
        return this.serial(() => this.appendNow(answer));
    }

    // Removes the latest line of the answer from the file of this device, where append put it. Later answers stay,
    // such as those given meanwhile from another Study from language.
    removeLast(answer: Answer): Promise<void> {
        return this.serial(() => this.removeNow(answer));
    }

    private async appendNow(answer: Answer): Promise<void> {
        if (!(await this.adapter.exists(this.folder))) {
            await this.adapter.mkdir(this.folder);
        }
        const file = this.file(answer.time);
        let line = `${serialize(answer)}\n`;
        if (await this.adapter.exists(file)) {
            // A line cut off when Obsidian quit in the middle of a write would swallow the next answer.
            if (!this.checked.has(file)) {
                const text = await this.adapter.read(file);
                line = text === "" || text.endsWith("\n") ? line : `\n${line}`;
                this.checked.add(file);
            }
            await this.adapter.append(file, line);
            return;
        }
        // Writing a file anew while iCloud keeps only its placeholder on the device would replace its answers.
        const placeholder = `.${fileName(file)}.icloud`;
        if ((await this.adapter.list(this.folder)).files.some((path) => fileName(path) === placeholder)) {
            throw new Error("iCloud has not downloaded the study file of this device yet. Try again later.");
        }
        await this.adapter.write(file, line);
        this.checked.add(file);
    }

    private async removeNow(answer: Answer): Promise<void> {
        const file = this.file(answer.time);
        const lines = (await this.adapter.read(file)).split("\n").filter((line) => line.trim() !== "");
        const index = lines.lastIndexOf(serialize(answer));
        if (index < 0) {
            throw new Error("The answer is no longer in the study file of this device.");
        }
        lines.splice(index, 1);
        await this.adapter.write(file, lines.length > 0 ? `${lines.join("\n")}\n` : "");
    }
}
