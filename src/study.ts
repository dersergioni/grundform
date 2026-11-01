// Learning the dictionary with spaced repetition. Each row gives two cards: the forward card shows the entry of the
// front language and asks for the rest of the row, and the reverse card shows the entry of another language and
// asks for the rest of the row, the front language included. The schedule of a card is FSRS, replayed from the
// answers in time order, so the answers are the only stored state.

import { type Card, createEmptyCard, fsrs, type Grade, Grades, State } from "ts-fsrs";
import type { Dictionary } from "./dictionary.ts";

export type Direction = "forward" | "reverse";

export interface Answer {
    // Milliseconds since 1970.
    time: number;
    row: number;
    // The front language of the card. Cards from another front language are other cards.
    from: string;
    direction: Direction;
    // 1 Again, 2 Hard, 3 Good, 4 Easy.
    rating: Grade;
    // The vault path of the dictionary note, or "" for an answer written before the note was recorded, which counts
    // for every note.
    note: string;
}

export interface StudyWord {
    entry: string;
    transcription: string;
}

export interface StudyRow {
    number: number;
    // The position of the row in the table, which gives its line in the note.
    index: number;
    // The words of the languages that have an entry in the row, in column order.
    words: Map<string, StudyWord>;
}

export interface CardProgress {
    card: Card;
    // Times of the first and the last answer.
    first: number;
    last: number;
    // The number of study days with an answer.
    days: number;
}

export interface StudyCard {
    row: StudyRow;
    direction: Direction;
    from: string;
    // The language whose entry the card shows.
    prompt: string;
    isNew: boolean;
    // The time of the last answer when the card was chosen, to notice an answer given since on another device.
    last?: number;
}

export interface StudyQueue {
    // The card to show now, if any.
    next?: StudyCard;
    // Cards due today, those in their learning steps included, and new cards left for today.
    due: number;
    fresh: number;
    answeredToday: number;
}

export interface StudyTotals {
    words: number;
    // Rows whose two cards have left the learning steps.
    learned: number;
    // Rows answered at least once and not learned yet.
    learning: number;
}

// The fuzz spreads the reviews of words learned on the same day over neighbouring days. Its seed comes from the
// card and the time of the answer, so a replay gives the same dates.
const kScheduler = fsrs({ enable_fuzz: true });

const kDayMs = 24 * 3_600_000;
// A study day starts at 4:00 local time, so a session after midnight still belongs to the evening before.
const kDayStartHour = 4;
// When no other card is left, a card in its learning steps comes up to this much early.
const kLearnAheadMs = 20 * 60_000;

// The local date of the study day of a moment.
function studyDate(time: number): Date {
    const date = new Date(time);
    if (date.getHours() < kDayStartHour) {
        date.setDate(date.getDate() - 1);
    }
    return date;
}

// The study day of a moment as days since 1970.
export function studyDay(time: number): number {
    const date = studyDate(time);
    return Math.round(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / kDayMs);
}

// The end of the study day of a moment: 4:00 of the next local date.
function dayEnd(time: number): number {
    const date = studyDate(time);
    return new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1, kDayStartHour).getTime();
}

// ts-fsrs counts the days between two reviews by their UTC dates, which in Germany change at 1:00 or 2:00 local
// time. The times it gets are moved so that their UTC date is the study day, and the due times it gives are moved
// back, so that it counts study days.
function toScheduler(time: number): Date {
    return new Date(time - new Date(time).getTimezoneOffset() * 60_000 - kDayStartHour * 3_600_000);
}

function fromScheduler(date: Date): number {
    const local = date.getTime() + kDayStartHour * 3_600_000;
    // The offset of the time itself, found in two steps, since a change of the clock may lie in between.
    const guess = local + new Date(local).getTimezoneOffset() * 60_000;
    return local + new Date(guess).getTimezoneOffset() * 60_000;
}

// When a card is due, in real time.
export function dueTime(progress: CardProgress): number {
    return fromScheduler(progress.card.due);
}

function cardKey(row: number, direction: Direction, from: string): string {
    return `${row}:${direction}:${from}`;
}

function inLearningSteps(card: Card): boolean {
    return card.state === State.Learning || card.state === State.Relearning;
}

// The numbered rows of the dictionary with their entries and transcriptions.
export function studyRows(dictionary: Dictionary): StudyRow[] {
    const transcriptions = new Map<string, number>();
    dictionary.columns.forEach((column, index) => {
        if (column.kind === "transcription") {
            transcriptions.set(column.language!, index);
        }
    });
    const rows: StudyRow[] = [];
    dictionary.rows.forEach((cells, index) => {
        if (!/^\d+$/.test(cells[0] ?? "")) {
            return;
        }
        const words = new Map<string, StudyWord>();
        dictionary.columns.forEach((column, columnIndex) => {
            const entry = cells[columnIndex] ?? "";
            if (column.kind !== "entry" || !entry || words.has(column.language!)) {
                return;
            }
            const transcription = cells[transcriptions.get(column.language!) ?? -1] ?? "";
            words.set(column.language!, { entry, transcription });
        });
        rows.push({ number: Number(cells[0]), index, words });
    });
    return rows;
}

// A row gives cards when it has an entry in the front language and in at least one other language.
export function isStudied(row: StudyRow, front: string): boolean {
    return row.words.has(front) && row.words.size >= 2;
}

// The row of a number that gives cards: of rows with the same number, the first one that gives cards.
export function studiedRow(rows: readonly StudyRow[], number: number, front: string): StudyRow | undefined {
    return rows.find((row) => row.number === number && isStudied(row, front));
}

// The rows that give cards, in the order of their numbers. Of rows with the same number, the first one that gives
// cards counts.
function studiedRows(rows: readonly StudyRow[], front: string): StudyRow[] {
    const numbers = new Set<number>();
    return [...rows]
        .sort((a, b) => a.number - b.number)
        .filter((row) => {
            if (!isStudied(row, front) || numbers.has(row.number)) {
                return false;
            }
            numbers.add(row.number);
            return true;
        });
}

// The card of a row. A reverse card shows the other languages of the row in turn, the next one on each study day
// with an answer, and neighbouring rows start from different languages.
export function studyCard(
    row: StudyRow,
    direction: Direction,
    from: string,
    progress: CardProgress | undefined,
    now: number,
): StudyCard {
    const others = [...row.words.keys()].filter((language) => language !== from);
    // Today does not count, so the language stays the same through the learning steps of a day.
    const days = progress ? progress.days - (studyDay(progress.last) === studyDay(now) ? 1 : 0) : 0;
    const prompt = direction === "forward" ? from : others[(row.number + days) % others.length]!;
    return { row, direction, from, prompt, isNew: !progress, ...(progress ? { last: progress.last } : {}) };
}

// The cards of all rows as the answers so far leave them.
export class Progress {
    private readonly cards = new Map<string, CardProgress>();
    // In the order they were added: time order on a replay; an answer given in the tab comes after the answers read
    // before it.
    readonly answers: Answer[] = [];

    constructor(answers: readonly Answer[] = []) {
        for (const answer of [...answers].sort((a, b) => a.time - b.time)) {
            this.add(answer);
        }
    }

    get(row: number, direction: Direction, from: string): CardProgress | undefined {
        return this.cards.get(cardKey(row, direction, from));
    }

    add(answer: Answer): void {
        const key = cardKey(answer.row, answer.direction, answer.from);
        const progress = this.cards.get(key);
        // A clock of another device may lag behind: an answer never goes back before the previous one.
        const time = Math.max(answer.time, progress?.last ?? answer.time);
        const at = toScheduler(time);
        const card = kScheduler.next(progress?.card ?? createEmptyCard(at), at, answer.rating);
        const newDay = !progress || studyDay(time) !== studyDay(progress.last);
        this.cards.set(key, {
            card: card.card,
            first: progress?.first ?? time,
            last: time,
            days: (progress?.days ?? 0) + (newDay ? 1 : 0),
        });
        this.answers.push(answer);
    }

    // The due time that each rating of the card would give at a moment.
    preview(card: StudyCard, time: number): Map<Grade, number> {
        const progress = this.get(card.row.number, card.direction, card.from);
        const at = Math.max(time, progress?.last ?? time);
        const outcomes = kScheduler.repeat(progress?.card ?? createEmptyCard(toScheduler(at)), toScheduler(at));
        return new Map(Grades.map((grade) => [grade, fromScheduler(outcomes[grade].card.due)]));
    }

    // The number of new cards of a direction first answered on the study day of a moment.
    startedOn(time: number, direction: Direction, from: string): number {
        const day = studyDay(time);
        let count = 0;
        for (const [key, progress] of this.cards) {
            if (key.endsWith(`:${direction}:${from}`) && studyDay(progress.first) === day) {
                count++;
            }
        }
        return count;
    }
}

// The cards for now, in this order: cards in their learning steps that are due, cards due today, new reverse
// cards, new forward cards, and then cards in their learning steps due within the next 20 minutes.
// A row shows at most one of its cards a day apart from learning steps, so a forward card does not give away the
// answer of its reverse card, and while one card of a row is in its learning steps the other waits, also when the
// steps began on an earlier day. A new reverse card comes no earlier than the day after its forward card.
// Each day takes up to newPerDay new forward cards and as many new reverse cards.
export function studyQueue(
    rows: readonly StudyRow[],
    progress: Progress,
    front: string,
    newPerDay: number,
    now: number,
): StudyQueue {
    const today = studyDay(now);
    const end = dayEnd(now);
    const answeredToday = progress.answers.filter((answer) => studyDay(answer.time) === today).length;
    const learningNow: [number, StudyCard][] = [];
    const learningSoon: [number, StudyCard][] = [];
    // Cards in their learning steps due later today, which the count of the day includes.
    let learningLater = 0;
    const due: [number, StudyCard][] = [];
    const newForward: StudyCard[] = [];
    const newReverse: StudyCard[] = [];

    for (const row of studiedRows(rows, front)) {
        const forward = progress.get(row.number, "forward", front);
        const reverse = progress.get(row.number, "reverse", front);
        const answered = [forward, reverse].some(
            (item) => item && (studyDay(item.last) === today || inLearningSteps(item.card)),
        );
        let review: [number, StudyCard] | undefined;
        for (const [direction, item] of [
            ["forward", forward],
            ["reverse", reverse],
        ] as const) {
            if (!item) {
                continue;
            }
            const dueAt = dueTime(item);
            const card = studyCard(row, direction, front, item, now);
            if (inLearningSteps(item.card)) {
                if (dueAt <= now) {
                    learningNow.push([dueAt, card]);
                } else if (dueAt <= now + kLearnAheadMs && dueAt < end) {
                    learningSoon.push([dueAt, card]);
                } else if (dueAt < end) {
                    learningLater++;
                }
            } else if (item.card.state === State.Review && dueAt < end && !answered && (!review || dueAt < review[0])) {
                review = [dueAt, card];
            }
        }
        if (review) {
            due.push(review);
        } else if (!answered && !forward) {
            newForward.push(studyCard(row, "forward", front, undefined, now));
        } else if (!answered && forward && !reverse && studyDay(forward.first) < today) {
            newReverse.push(studyCard(row, "reverse", front, undefined, now));
        }
    }

    const byTime = (items: [number, StudyCard][]): StudyCard[] =>
        items.sort((a, b) => a[0] - b[0]).map(([, card]) => card);
    const freshReverse = newReverse.slice(0, Math.max(0, newPerDay - progress.startedOn(now, "reverse", front)));
    const freshForward = newForward.slice(0, Math.max(0, newPerDay - progress.startedOn(now, "forward", front)));
    const queue = [...byTime(learningNow), ...byTime(due), ...freshReverse, ...freshForward, ...byTime(learningSoon)];
    return {
        ...(queue[0] ? { next: queue[0] } : {}),
        due: learningNow.length + learningSoon.length + learningLater + due.length,
        fresh: freshReverse.length + freshForward.length,
        answeredToday,
    };
}

export function studyTotals(rows: readonly StudyRow[], progress: Progress, front: string): StudyTotals {
    const totals: StudyTotals = { words: 0, learned: 0, learning: 0 };
    for (const row of studiedRows(rows, front)) {
        totals.words++;
        const cards = [progress.get(row.number, "forward", front), progress.get(row.number, "reverse", front)];
        if (cards.every((item) => item?.card.state === State.Review)) {
            totals.learned++;
        } else if (cards.some((item) => item)) {
            totals.learning++;
        }
    }
    return totals;
}

// The number of study days in a row with answers, up to today, or up to yesterday while today has none yet.
export function streak(progress: Progress, now: number): number {
    const days = new Set(progress.answers.map((answer) => studyDay(answer.time)));
    let day = studyDay(now);
    if (!days.has(day)) {
        day--;
    }
    let count = 0;
    while (days.has(day - count)) {
        count++;
    }
    return count;
}

// "new", or when the card is due: "learning, due now", "due in 3 days" and the like.
export function cardStatus(progress: CardProgress | undefined, now: number): string {
    if (!progress) {
        return "new";
    }
    const dueAt = dueTime(progress);
    const when = dueAt <= now ? "due now" : `due in ${formatInterval(dueAt - now, true)}`;
    return inLearningSteps(progress.card) ? `learning, ${when}` : when;
}

// An interval in the largest unit that fits: "10m", "3d", "1.5mo" or, spelled out, "10 minutes", "3 days".
export function formatInterval(ms: number, long = false): string {
    const units: [limit: number, size: number, short: string, name: string][] = [
        [60, 1, "m", "minute"],
        [24 * 60, 60, "h", "hour"],
        [30 * 24 * 60, 24 * 60, "d", "day"],
        [365 * 24 * 60, 30 * 24 * 60, "mo", "month"],
        [Infinity, 365 * 24 * 60, "y", "year"],
    ];
    const minutes = Math.max(1, Math.round(ms / 60_000));
    const [, size, short, name] = units.find(([limit]) => minutes < limit)!;
    const value = size >= 30 * 24 * 60 ? Math.round((minutes / size) * 10) / 10 : Math.round(minutes / size);
    return long ? `${value} ${name}${value === 1 ? "" : "s"}` : `${value}${short}`;
}

// The query that looks up an entry: its first variant without marks and the plural, such as "der Apfel" for
// "der Apfel, die Äpfel", "dégoûtant" for "dégoûtant/dégoûtante" and "le" for "le<br>la<br>les".
export function lookupQuery(entry: string): string {
    return entry
        .split(/<br\s*\/?>/i)[0]!
        .replace(/\\\|/g, "|")
        .replace(/\[[^\]]*\]/g, " ")
        .split(",")[0]!
        .split(/\s+/)
        .map((word) => word.split("/")[0]!)
        .join(" ")
        .trim();
}
