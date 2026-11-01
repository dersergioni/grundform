// The answers of the study tab: files in the plugin folder, one per device and month, such as
// "desktop-k3j9x2-2026-11.jsonl", with one JSON line per answer, such as
// {"time":1762164900000,"row":12,"from":"ru","direction":"forward","rating":3,"note":"Dictionary.md"}, or per mark
// set in Browse, such as {"time":1762164900000,"row":12,"from":"ru","mark":"known","note":"Dictionary.md"}. Each
// device writes only its own files, so a sync of the vault never has to merge two versions of a file; the study tab
// reads the files of all devices. A new file each month keeps the files small and the file being written recent.
// The same folder keeps the row that Browse showed last, in a file per device such as "desktop-k3j9x2-browse.json"
// with {"time":1762164900000,"row":52}; Browse opens at the latest of them.

import { type DataAdapter, Platform } from "obsidian";
import { isMark, type StudyEntry } from "./study.ts";

const kDeviceKey = "grundform-device";
const kDayMs = 24 * 3_600_000;
// The name iCloud gives a file on iOS while the file itself is not downloaded, such as ".a-2026-11.jsonl.icloud".
const kPlaceholder = /^\..+\.jsonl\.icloud$/;
const kBrowseSuffix = "-browse.json";

// The row that Browse showed and when it was chosen.
export interface BrowseRow {
    row: number;
    time: number;
}

export interface StudyEntries {
    entries: StudyEntry[];
    // Files that could not be read, such as files of another device that iCloud has not downloaded yet.
    unread: number;
}

function parseEntry(line: string): StudyEntry | undefined {
    let value: unknown;
    try {
        value = JSON.parse(line);
    } catch {
        // A line that a sync has not finished writing yet.
        return undefined;
    }
    const { time, row, from, direction, rating, mark, note } = (value ?? {}) as Record<string, unknown>;
    const common =
        typeof time === "number" &&
        (note === undefined || typeof note === "string") &&
        Number.isInteger(row) &&
        typeof from === "string" &&
        from !== "";
    if (!common) {
        return undefined;
    }
    if (mark === "known" || mark === "reset") {
        return { time, row: row as number, from, mark, note: note ?? "" };
    }
    const answer =
        (direction === "forward" || direction === "reverse") &&
        (rating === 1 || rating === 2 || rating === 3 || rating === 4);
    return answer ? { time, row: row as number, from, direction, rating, note: note ?? "" } : undefined;
}

function serialize(entry: StudyEntry): string {
    const { time, row, from, note } = entry;
    const rest = isMark(entry) ? { mark: entry.mark } : { direction: entry.direction, rating: entry.rating };
    return JSON.stringify({ time, row, from, ...rest, ...(note ? { note } : {}) });
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

    // The id of this device in the names of its files. The device keeps it in its local storage; a device that has
    // lost it starts new files and still reads the old ones.
    private deviceId(): string {
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
        return id;
    }

    // The file of this device for the month of an answer.
    private file(time: number): string {
        const date = new Date(time);
        const month = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
        return `${this.folder}/${this.deviceId()}-${month}.jsonl`;
    }

    // The answers and marks of all devices. Other lines, entries dated more than a day ahead and repeated entries,
    // such as those of a copy that a sync made of a file, are skipped.
    async read(): Promise<StudyEntries> {
        const result: StudyEntries = { entries: [], unread: 0 };
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
            // A device clock set back must not reorder the entries of its file.
            let previous = 0;
            for (const line of text.split("\n")) {
                const entry = line.trim() ? parseEntry(line) : undefined;
                if (!entry || entry.time > latest) {
                    continue;
                }
                // The key is the line as written, so that two entries clamped to one time still both count.
                const key = serialize(entry);
                entry.time = Math.max(entry.time, previous);
                previous = entry.time;
                if (!seen.has(key)) {
                    seen.add(key);
                    result.entries.push(entry);
                }
            }
        }
        return result;
    }

    // The row that Browse showed last on any device, or undefined while no device has saved one. A file that cannot be
    // read yet, such as one that a sync has not finished writing, is skipped.
    async readBrowseRow(): Promise<BrowseRow | undefined> {
        if (!(await this.adapter.exists(this.folder))) {
            return undefined;
        }
        let latest: BrowseRow | undefined;
        for (const path of (await this.adapter.list(this.folder)).files) {
            if (!fileName(path).endsWith(kBrowseSuffix)) {
                continue;
            }
            try {
                const { row, time } = JSON.parse(await this.adapter.read(path)) as Record<string, unknown>;
                if (Number.isInteger(row) && typeof time === "number" && (!latest || time > latest.time)) {
                    latest = { row: row as number, time };
                }
            } catch {
                // The file is skipped.
            }
        }
        return latest;
    }

    // Writes the row that Browse shows into the file of this device.
    saveBrowseRow(browsed: BrowseRow): Promise<void> {
        return this.serial(async () => {
            if (!(await this.adapter.exists(this.folder))) {
                await this.adapter.mkdir(this.folder);
            }
            const { row, time } = browsed;
            await this.adapter.write(
                `${this.folder}/${this.deviceId()}${kBrowseSuffix}`,
                JSON.stringify({ time, row }),
            );
        });
    }

    private serial<T>(task: () => Promise<T>): Promise<T> {
        const result = this.writes.then(task);
        this.writes = result.catch(() => undefined);
        return result;
    }

    append(entry: StudyEntry): Promise<void> {
        return this.serial(() => this.appendNow(entry));
    }

    // Removes the latest line of the answer from the file of this device, where append put it. Later answers stay,
    // such as those given meanwhile from another Study from language.
    removeLast(entry: StudyEntry): Promise<void> {
        return this.serial(() => this.removeNow(entry));
    }

    private async appendNow(entry: StudyEntry): Promise<void> {
        if (!(await this.adapter.exists(this.folder))) {
            await this.adapter.mkdir(this.folder);
        }
        const file = this.file(entry.time);
        let line = `${serialize(entry)}\n`;
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

    private async removeNow(entry: StudyEntry): Promise<void> {
        const file = this.file(entry.time);
        const lines = (await this.adapter.read(file)).split("\n").filter((line) => line.trim() !== "");
        const index = lines.lastIndexOf(serialize(entry));
        if (index < 0) {
            throw new Error("The answer is no longer in the study file of this device.");
        }
        lines.splice(index, 1);
        await this.adapter.write(file, lines.length > 0 ? `${lines.join("\n")}\n` : "");
    }
}
