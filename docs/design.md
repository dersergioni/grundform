# Design

grundform is a personal tool for learning German and French alongside English and Russian. You look up a word in any of the card languages and see each of its senses with the equivalents in the other languages, their forms and an example. Save adds a sense as a new row of the grundform dictionary in the Obsidian vault, and the study tab goes through the rows with spaced repetition.

## Shell

The tool is an Obsidian plugin. It runs in Obsidian on macOS and iOS. The vault syncs through iCloud, so the plugin, its settings and the dictionary reach the iPhone without a server or an app store.

Other shells were considered:

- **Telegram bot:** the chat interface is too limited for a card with tables and transcriptions.
- **Native iOS and macOS app:** an install on an iPhone signed with a free Apple account runs for 7 days; longer installs need the paid Apple Developer Program.
- **Web app:** it needs a server for the API key and sync, and Safari on iOS does not support the Web Share Target API, so a word cannot be shared into it.

## Lookup flow

- **Mac:** the ribbon button or the command "Look up a word" opens an input field. The command "Look up the selection" looks up the text selected in a note, in editing and in reading mode, and works best with a hotkey. In editing mode the context menu also offers the selection or the word at the cursor; in reading mode Obsidian gives plugins no context menu for text.
- **iPhone:** the ribbon button opens the same input field; the word is typed, pasted or dictated.
- **Share sheet:** the link `obsidian://grundform?word=…&lang=…` opens the card on the Mac and on iOS, so a Shortcut in the Share sheet can open the card for a word selected in another app.

## Card

- The query language and the lemma; an inflected form resolves to its lemma, for example "legte ab" to "ablegen", and the card names the form, here the preterite, 1st and 3rd person singular. The model picks the query language itself, since asking for it before every lookup would slow down the common case; when it picks the wrong one, the language in the head is a picker that looks the query up again with the picked language as the hint.
- The senses a learner at A2 to B2 level meets, most frequent first, at most six. Senses with the same equivalents in all languages are merged.
- For each sense:
  - the part of speech;
  - one equivalent per language: the entry in the dictionary format, the lemma, the gender, the transcription, the key forms, up to two alternatives and a short definition written in that language;
  - an example sentence in the query language with its translations;
  - up to two notes in English against typical mistakes, such as false friends.
- Gender mismatches between the languages, computed by the app.
- The dictionary rows that already contain the word.

## Languages

The card languages are a setting: a list of language codes in column order, at least two. `src/languages.ts` lists the languages the settings offer, each with its name, flag and the entry conventions for the prompt. Russian, French, German and English follow the conventions of the author's dictionary, written down in the legend of the note; other languages follow general learner's-dictionary conventions.

A dictionary note has its own language columns. Choosing an existing note in the settings takes the card languages from the header of its table; creating a note makes a table for the card languages. Removing a language from the card never removes a column from a dictionary.

## Data sources

- **AI:** an OpenAI-compatible chat completions API with a strict JSON schema for the card. The settings hold the base URL, the key, the model and the reasoning effort. The default is OpenAI gpt-6.1-terra without reasoning, effort `none`. On the 30 test words of the prototype, with French, German and English, the earlier card format without definitions and effort `low`, it gave 90 senses where xAI grok-4.7 with effort `low` gave 73, with a similar share of transcriptions matching Wiktionary, three times faster and at a fifth of the cost. On 10 words with four languages and definitions, effort `none` gave as many senses and as few transcription errors as `low`, in 5% less time; gpt-6-luna and grok-4.20 without reasoning answered two to three times faster but gave fewer senses, some of them wrong, and more transcription errors.
- **Wiktionary:** after the model answers, the German and French equivalents are looked up on de.wiktionary.org and fr.wiktionary.org, one request per language, each naming grundform and its repository in the Api-User-Agent header, as Wikimedia asks. Wiktionary's transcriptions are first brought to the conventions of the dictionary: no syllable dots, [ɔʏ̯] in German and [a] for the French oral [ɑ]. A transcription that Wiktionary does not accept is replaced with its preferred one, and so are a wrong article, gender or plural of a German noun and an article or gender of a French noun that contradicts Wiktionary; a German [sg] mark stays, since it describes the sense, and so does any of the plurals that Wiktionary lists. A page whose transcription is still a placeholder counts as a page without one. A transcription stays as the model gave it and is marked as unverified when Wiktionary has no entry or pronounces the homographs differently, and so does the feminine part of a French adjective such as [pəti/pətit]. If Wiktionary does not answer, the card shows the model's values, all marked as unverified. A card without German or French words needs no check.
- **Cache:** a card is kept in IndexedDB on the device, up to 1000 cards, unless the model found no such word or the Wiktionary check failed; Look up again under a cached card asks the model anew. Its key is the query and the language hint with a hash of the provider, the model, the reasoning effort, the card languages, the prompt, the schema and the version of the Wiktionary check, so any of these changes looks the word up anew. A lookup waits at most a second for the cache, which WebKit may leave without an answer after the app resumes. IndexedDB keeps the cache outside the vault, where iCloud would sync it after every lookup and two devices could write it at once.

## Saving

Save appends one row for the chosen sense to the dictionary note chosen in the settings. `src/dictionary.ts` reads the table: the first table outside code blocks, comments and the front matter whose first column is `No.`, `Nr.` or `#`; a column named after a language, alone or with `translation`, is its entry column, and one with `transcription` its transcription column. The row takes the next number; a field the user corrects in the save modal wins over the card. The table is rewritten with Prettier's alignment, measured as Prettier measures text width, so a later Prettier run changes nothing; the 2474-row table of the author's dictionary comes out byte for byte the same. Vault.process does the read and the write in one step. The example stays in the card.

The card marks the rows that already hold the word, matched on the entry of the query language, and the senses already saved, matched when a row agrees in every language where both have an entry, provided there are at least two such languages; a language agrees when the entry of the row is the entry of the card or one of its alternatives. A row that agrees in two languages and differs in another is shown as similar next to the Save button, with Save still available, because the dictionary keeps synonyms in rows of their own: 54 pairs of its rows differ in exactly one language, such as _salut_ and _coucou_, and a few of them are different words, such as _улыбаться_ and _улыбка_; for the 30 test words, 7 of the 10 such rows differed by a synonym, such as _ficher_ and _classer_ for _ablegen_, to file, and 3 held another sense. Entries are compared without articles, hints, gender and number marks, plurals and feminine forms, and in lowercase except in German, where the capital letter tells a noun from another word: the author's dictionary has 19 such pairs, such as _das Essen_ and _essen_. After a save the card reads the note again and marks every sense anew.

The table ends at a blank line or a new block. A text line right after it would be joined to the table as a row, so Save refuses to write until a blank line separates them. A comment line between rows ends the table as well, and Save refuses to write while rows follow it, since a new row would go before them. Each line keeps its own line break, and a renamed dictionary note stays in the settings. Before the write, an open editor of the note saves its pending changes.

## Study

- **Cards:** a row is the unit of study, as one row holds one sense. Each row gives two cards, and one rating covers all the languages a card asks for: the forward card shows the word in the Study from language and asks for the rest of the row, and the reverse card shows the word in another language and asks for the rest. One card per row and language was considered: it rates each language apart, but gives the author's dictionary of four languages four cards per row instead of two. The reverse card takes the next language of the row on each study day with an answer to it, so every language serves as the prompt in turn. A word that another row shows as well is left out of the turn, since the learner could not tell which row the card asks for: a language that makes no distinction where the others do, such as French _son_ for both _his_ and _her_, repeats its word in both rows, and a hint in every such cell would clutter the dictionary. A row whose other words are all shared uses them anyway. The forward card has no such choice, so the Study from column needs a word of its own in each row.
- **Order:** new rows come in the order of their numbers, which in the author's dictionary is the order in which a beginner meets the words. A reverse card comes no earlier than the day after its forward card, and a row shows at most one of its cards a day; while one card of a row is in its learning steps, the other waits, also when the steps began on an earlier day. A session takes the cards in this order: cards in their learning steps that are due, reviews due today, new reverse cards, new forward cards, and cards in their learning steps due within 20 minutes.
- **Schedule:** FSRS-6 through ts-fsrs 5.4.2, with the default parameters, 90% desired retention, learning steps of 1 and 10 minutes, a relearning step of 10 minutes and fuzz. Anki offers FSRS as an alternative to its default scheduler, a variant of SM-2, and with FSRS it needs fewer reviews for the same retention. A study day starts at 4:00, as in Anki. ts-fsrs counts the days between reviews by their UTC dates, so the plugin moves the times it passes so that their UTC date is the study day, and moves the due times back. ts-fsrs adds helper methods to Date.prototype that it never calls; the plugin shares its window with Obsidian and other plugins, so the build leaves them out.
- **Storage:** the answers are the only stored state, together with the marks Known and Reset that Browse sets on a row, one JSON line each in a file per device and month in the `study` folder of the plugin folder, and the schedule is replayed from them. A Known mark keeps the schedule of the cards underneath, so an answer given later goes on from there; a Reset mark drops it. A device with an older version of the plugin skips the mark lines. Since each device writes only its own files, two devices never change the same file. IndexedDB, which keeps the card cache, does not sync, and data.json would be rewritten by both devices. The [Remember](https://github.com/volfpe/obsidian-remember) plugin for Obsidian also keeps an append-only log per device and replays it, but in a vault folder, since some sync services leave out parts of the settings folder; grundform keeps the log in the plugin folder, which iCloud syncs and the vault's git ignores. A new file each month keeps the files small and the file being written recent. On iOS, iCloud may keep only a placeholder of a file; a placeholder of another device's file counts as unread, and a placeholder of the file to write stops the answer rather than letting a new file replace it. A copy of a file that a sync makes on a conflict adds no answers, as repeated answers are dropped. The row that Browse shows is shared the same way: each device writes its row and the time it was chosen into a file of its own in the folder, a second after the last move and when Obsidian goes to the background, and the tab takes the latest row of all devices whenever it reads the answers, unless a row chosen here is later.
- **Reading:** Obsidian sends no vault events for files in the settings folder, so the study tab reads the answers again when it comes to the front and when Obsidian returns to the foreground. The fuzz of FSRS takes its seed from the card and the time of the answer, which is the time the answer was shown unless the rating came more than a minute later, so the buttons show the intervals the answers give and a replay gives the same dates; 40,000 answers replay in about 0.2 s on the Mac.
- **Identity:** a card belongs to the dictionary note, the row number, its direction and the Study from language, so a test note studied for a while leaves the progress of the real one alone. The author's dictionary never changes its row numbers, and a corrected word keeps the progress of its row. The study days are counted in the time zone of the device, so two devices in different zones may draw the day boundary and the reverse language of a row differently on the day of a trip.

## Settings and secrets

Obsidian stores plugin settings, the API key included, in `.obsidian/plugins/<plugin-id>/data.json` inside the vault. In a vault kept in git, the plugin folder belongs in the vault's `.gitignore` before the key is entered. Two devices share data.json through the sync. A device reads it at the start, before each save and when it comes back to the foreground, and takes each setting that changed there unless it changed the setting itself, so a device with old settings in memory does not write them back. Obsidian's onExternalSettingsChange would also do this, but it redraws the open settings tab and takes the focus from a field being edited.

## Milestones

1. Repository and design.
2. Card prototype: schema, prompt and a model comparison on 30 test words.
3. Plugin: settings, lookup, card and the `obsidian://grundform` link, checked on the Mac and the iPhone.
4. Wiktionary check of transcriptions and noun forms.
5. Dictionary: existing rows and Save.
6. Study tab: spaced repetition and browsing of the dictionary rows.
7. Two weeks of daily use on the Mac and the iPhone.

## Later

- The conventions and a Wiktionary check for more languages.
- The card shown while the model writes it, sense by sense.
