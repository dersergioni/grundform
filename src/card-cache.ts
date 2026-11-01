// Cards of earlier lookups, kept in IndexedDB on this device so that a repeated lookup opens at once. The cache
// is not part of the vault, so iCloud does not sync it and two devices never write the same file.

import { type AiSettings, buildCardRequest } from "./ai.ts";
import type { WordCard } from "./card.ts";
import type { CardLookup } from "./lookup.ts";
import { kCheckVersion } from "./wiktionary.ts";

// Part of every key: raise it when StoredCard changes, so that older cards are looked up anew. The prompt, the
// schema and the version of the Wiktionary check are in the key already.
const kVersion = 2;
const kStore = "cards";
const kDefaultMaxCards = 1000;

interface StoredCard {
    key: string;
    storedAt: number;
    card: WordCard;
    usage: CardLookup["usage"];
    rawUsage: unknown;
    latencyMs: number;
    wiktionary: CardLookup["wiktionary"];
    // The unchecked equivalents as sense and equivalent indexes, since a stored card is a copy.
    unchecked: [number, number][];
}

// A short hash of a text (cyrb53), enough to tell prompts apart.
function hash(text: string): string {
    let h1 = 0xdeadbeef;
    let h2 = 0x41c6ce57;
    for (let i = 0; i < text.length; i++) {
        const code = text.charCodeAt(i);
        h1 = Math.imul(h1 ^ code, 2654435761);
        h2 = Math.imul(h2 ^ code, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

// The key of a lookup: the query and the hint, and a hash of everything else the answer depends on, namely the
// provider, the model, the reasoning effort, the card languages, the prompt, the schema and the Wiktionary check.
export function cardCacheKey(
    ai: AiSettings,
    languages: readonly string[],
    query: string,
    languageHint: string | undefined,
): string {
    const request = JSON.stringify(buildCardRequest(ai, languages, "", undefined));
    const setup = hash(`${kVersion}|${kCheckVersion}|${ai.baseUrl}|${request}`);
    return `${setup}|${languageHint ?? ""}|${query.trim().replace(/\s+/g, " ")}`;
}

function done<T>(request: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error("IndexedDB failed"));
    });
}

function completed(transaction: IDBTransaction): Promise<void> {
    return new Promise((resolve, reject) => {
        // The error of a failed request reaches the transaction before the transaction gets its own error.
        const fail = (event: Event): void => {
            reject((event.target as IDBRequest | null)?.error ?? transaction.error ?? new Error("IndexedDB failed"));
        };
        transaction.oncomplete = () => resolve();
        transaction.onerror = fail;
        transaction.onabort = fail;
    });
}

export class CardCache {
    private readonly name: string;
    private readonly maxCards: number;
    private database: Promise<IDBDatabase> | undefined;

    constructor(name: string, maxCards = kDefaultMaxCards) {
        this.name = name;
        this.maxCards = maxCards;
    }

    private open(): Promise<IDBDatabase> {
        this.database ??= new Promise((resolve, reject) => {
            const request = indexedDB.open(this.name, 1);
            request.onupgradeneeded = () => {
                const store = request.result.createObjectStore(kStore, { keyPath: "key" });
                store.createIndex("storedAt", "storedAt");
            };
            request.onsuccess = () => {
                const database = request.result;
                // A connection that the system closes, as iOS may do in the background, is opened again later.
                database.onclose = () => {
                    this.database = undefined;
                };
                database.onversionchange = () => {
                    database.close();
                    this.database = undefined;
                };
                resolve(database);
            };
            request.onerror = () => {
                // The next call tries again.
                this.database = undefined;
                reject(request.error ?? new Error("IndexedDB failed"));
            };
        });
        return this.database;
    }

    async get(key: string): Promise<CardLookup | undefined> {
        const database = await this.open();
        const stored = await done(
            database.transaction(kStore).objectStore(kStore).get(key) as IDBRequest<StoredCard | undefined>,
        );
        if (!stored) {
            return undefined;
        }
        const unchecked = new Set(
            stored.unchecked.flatMap(([sense, equivalent]) => {
                const item = stored.card.senses[sense]?.equivalents[equivalent];
                return item ? [item] : [];
            }),
        );
        return {
            card: stored.card,
            usage: stored.usage,
            rawUsage: stored.rawUsage,
            latencyMs: stored.latencyMs,
            unchecked,
            wiktionary: stored.wiktionary,
            cached: true,
        };
    }

    // Keeps a card; the oldest cards go when there are more than maxCards.
    async put(key: string, lookup: CardLookup): Promise<void> {
        const unchecked: [number, number][] = [];
        lookup.card.senses.forEach((sense, senseIndex) =>
            sense.equivalents.forEach((equivalent, equivalentIndex) => {
                if (lookup.unchecked.has(equivalent)) {
                    unchecked.push([senseIndex, equivalentIndex]);
                }
            }),
        );
        const stored: StoredCard = {
            key,
            storedAt: Date.now(),
            card: lookup.card,
            usage: lookup.usage,
            rawUsage: lookup.rawUsage,
            latencyMs: lookup.latencyMs,
            wiktionary: lookup.wiktionary,
            unchecked,
        };
        const database = await this.open();
        const transaction = database.transaction(kStore, "readwrite");
        const store = transaction.objectStore(kStore);
        store.put(stored);
        // Callbacks rather than awaits: a transaction ends once no request of it is pending.
        const count = store.count();
        count.onsuccess = () => {
            let excess = count.result - this.maxCards;
            if (excess <= 0) {
                return;
            }
            store.index("storedAt").openCursor().onsuccess = (event) => {
                const cursor = (event.target as IDBRequest<IDBCursorWithValue | null>).result;
                if (cursor && excess > 0) {
                    cursor.delete();
                    excess--;
                    cursor.continue();
                }
            };
        };
        await completed(transaction);
    }

    async delete(key: string): Promise<void> {
        const database = await this.open();
        const transaction = database.transaction(kStore, "readwrite");
        transaction.objectStore(kStore).delete(key);
        await completed(transaction);
    }

    async count(): Promise<number> {
        const database = await this.open();
        return done(database.transaction(kStore).objectStore(kStore).count());
    }

    async clear(): Promise<void> {
        const database = await this.open();
        const transaction = database.transaction(kStore, "readwrite");
        transaction.objectStore(kStore).clear();
        await completed(transaction);
    }

    close(): void {
        void this.database?.then(
            (database) => {
                database.close();
            },
            () => undefined,
        );
        this.database = undefined;
    }
}
