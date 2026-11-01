# grundform

grundform is an Obsidian plugin for learning several languages at once. You look up a word in any of your languages, and the card shows each of its senses side by side in all of them: the dictionary entry, the transcription, the key forms, a short definition and an example. A sense can be saved as a row of your dictionary note, and the study tab goes through the rows of the note with spaced repetition.

The plugin runs in Obsidian on macOS and iOS. It asks an AI model through an OpenAI-compatible API with your own key and checks German and French words against Wiktionary.

## Contents

- [Features](#features)
- [Installation](#installation)
- [Settings](#settings)
- [Usage](#usage)
- [The card](#the-card)
- [Dictionary](#dictionary)
- [Study](#study)
- [Requests, cost and cache](#requests-cost-and-cache)
- [Development](#development)
- [License](#license)

## Features

- Every sense of a word side by side in two or more of nine languages, in the order you choose: English, French, German, Russian, Spanish, Italian, Dutch, Polish and Ukrainian.
- Lookup from an input field, from the selection in a note, from the editor context menu and from an `obsidian://` link; with a shortcut, from any app on the iPhone and on the Mac.
- German and French transcriptions, noun genders and German plurals checked against Wiktionary.
- Saving a sense as a row of a dictionary note, and marks for the words and senses the note already holds.
- A study tab: each row of the dictionary note as two cards, one in each direction, with spaced repetition, and the rows to browse one by one.
- A cache of earlier cards on each device.
- Any OpenAI-compatible provider and model with structured outputs, that is, a strict JSON schema for the answer.

## Installation

grundform is not in the community plugin catalog: you build it from source and copy it into the vault. The build needs Node.js 24 or later.

1. Clone the repository and install the dependencies:

   ```bash
   git clone https://github.com/dersergioni/grundform.git
   cd grundform
   npm install
   ```

2. Copy the environment template and set `OBSIDIAN_VAULT` in `.env` to the absolute path of your vault; a path that starts with `~` does not work:

   ```bash
   cp .env.example .env
   ```

3. Build the plugin and copy `main.js`, `manifest.json` and `styles.css` into `.obsidian/plugins/grundform/` of the vault:

   ```bash
   npm run install-plugin
   ```

4. In Obsidian, open Settings → Community plugins, turn community plugins on if they are off, reload the list of installed plugins and enable grundform.

On the iPhone the plugin arrives with the vault when the vault syncs, for example through iCloud. Enable it there under Settings → Community plugins as well.

Obsidian loads the code of a plugin when it starts or when the plugin is turned on. After an update, restart Obsidian or turn grundform off and on, on every device once the vault has synced.

## Settings

Open Settings → grundform and enter the API key of your provider.

| Setting          | Default                     | Meaning                                                                                                   |
| ---------------- | --------------------------- | --------------------------------------------------------------------------------------------------------- |
| API base URL     | `https://api.openai.com/v1` | An OpenAI-compatible API with structured outputs, for example `https://api.x.ai/v1` for xAI.              |
| API key          | empty                       | The key of that provider.                                                                                 |
| Model            | `gpt-6.1-terra`             | The model name at that provider.                                                                          |
| Reasoning effort | `none`                      | Sent as `reasoning_effort`; "provider default" leaves the parameter out for models that do not accept it. |
| Dictionary note  | empty                       | The note that Save appends rows to; see [Dictionary](#dictionary).                                        |
| Card languages   | French, German, English     | The columns of the card in order. Add, remove and reorder languages; a card needs at least two.           |
| Study from       | first language of the note  | The language of the forward card, one of the card languages; see [Study](#study).                         |
| New words a day  | 10                          | The new rows a day; see [Study](#study).                                                                  |

The settings, the API key included, are stored in `.obsidian/plugins/grundform/data.json` in the vault and sync with it. Before each save, and when Obsidian comes back to the foreground, grundform takes the settings that another device changed meanwhile, except the ones changed on this device. In a vault kept in git, add `.obsidian/plugins/grundform/` to `.gitignore` before you enter the key.

## Usage

### Look up a word

Click the ribbon button "Look up a word in grundform" or run the command "grundform: Look up a word". Type a word or a short phrase in any card language and press Enter. An inflected form works too: _legte ab_ opens the card of _ablegen_.

A query can be at most 80 characters long; a longer one shows a notice.

### Look up the selection

Select a word in a note and run the command "grundform: Look up the selection". It works in editing and in reading mode. Give the command a hotkey under Settings → Hotkeys: a hotkey keeps the selection in place.

### Context menu

In editing mode, right-click the selection or a word and choose "Look up "…" in grundform". Without a selection the item takes the word at the cursor. Reading mode has no text context menu for plugins; use the command with a hotkey there.

### Link

`obsidian://grundform?word=ablegen` opens the card of a word from any app, note or script. The optional parameter `lang` names the language of a word that exists in several languages, as in `obsidian://grundform?word=bald&lang=de`. Encode spaces and non-ASCII letters, as in `word=legte%20ab`.

### Share Sheet on the iPhone

A shortcut turns the link into an item of the Share Sheet: select a word in Safari, Books or any other app, tap Share and choose grundform. To create the shortcut in the Shortcuts app:

1. Tap + to create a shortcut.
2. Open its details and turn on Show in Share Sheet. An input action appears at the start of the shortcut.
3. In the input action, turn off every content type except Text. Tap Continue in the input action and choose Ask For, so that the shortcut asks for a word when you run it directly.
4. Add the action URL Encode and give it the Shortcut Input.
5. Add the action Text with `obsidian://grundform?word=` followed by the variable URL Encoded Text.
6. Add the action Open URLs and give it the Text.
7. Name the shortcut grundform.

Some apps share a quote with the book title or a link instead of the bare selection. Such text can exceed 80 characters, and the card does not open.

### Services menu on the Mac

When the Shortcuts app syncs through iCloud, the shortcut appears on the Mac as well. In the Shortcuts app on the Mac, open its details, turn on Use as Quick Action and select Services Menu. Then select a word in any app and choose grundform under Services in the app menu or in the context menu.

## The card

- **Head:** the dictionary form of the word and its language. When the query is an inflected form, the head adds the query and its grammatical form, such as _legte ab: preterite, 1st and 3rd person singular_ for _ablegen_. A line under it lists the same spelling in another card language, such as English _bald_ for German _bald_. When the model took the word for a word of the wrong language, tap the flag of the head and pick the right one: the card is looked up again with that language as the hint.
- **Columns:** one per card language, marked with a flag.
- **Rows:** one per sense, most frequent first, at most six. The narrow left column holds the number and the part of speech of the sense and, once a dictionary note is chosen, the Save button or the number of the row that holds the sense.
- **Cells:** the entry, such as a noun with its article and plural; on one line under it, the transcription and the key forms, such as _legt ab, legte ab, hat abgelegt_; up to two alternatives; a short definition in the language of the column.
- **Examples:** one sentence per sense, each translation under its language.
- **Notes:** up to two hints in English against typical mistakes, such as false friends or a construction that differs between the languages, and a line such as "Gender: fr f, de m" when the genders differ, as for _la lune_ and _der Mond_. A noun of both genders, such as French _l'élève_, agrees with either.
- **Footer:** the model, the time of the lookup or "from cache", and the result of the Wiktionary check.
- **Unknown words:** spelling suggestions instead of a card.

On a narrow screen, such as a phone, each sense is a block: its number and part of speech with the Save button on one line, then the languages one under another, each with its flag on the left and the entry next to it, then the examples as an indented block in the same order, then the notes.

### Entry conventions

Russian, French, German and English follow the conventions of the author's dictionary:

- French nouns with the full article and no elision, such as _le hôtel_;
- German nouns with the article and the plural, such as _der Apfel, die Äpfel_;
- English verbs with _to_;
- Russian nouns in the nominative and verbs in the aspect of the sense, `(о женщине)` after a masculine noun where Russian has no feminine noun for a woman, and no Russian transcription.

Spanish, Italian, Dutch, Polish and Ukrainian follow general learner's-dictionary conventions.

### Wiktionary check

The model gets a few percent of the transcriptions wrong, so grundform checks the German and French words of each card against [de.wiktionary.org](https://de.wiktionary.org) and [fr.wiktionary.org](https://fr.wiktionary.org):

- **Transcriptions:** the model's transcription stays when Wiktionary lists it among the accepted ones, such as [ɑ̃ləve] next to [ɑ̃lve] for _enlever_; otherwise Wiktionary's preferred transcription replaces it, such as [tɛʁˈmiːn] for _Termin_. French transcriptions keep the conventions of the dictionary: [a] where Wiktionary writes [ɑ], as in [klase] for _classer_, and liaison marked with ‿, as in [lez‿amaʁ].
- **German nouns:** a wrong article, gender or plural is replaced, such as _die Leiter, die Leitern_ for the ladder. Any plural that Wiktionary lists stays, such as _die Pizzen_ next to _die Pizzas_. A noun the model marks with [sg] keeps the mark, because one sense can lack the plural that another sense has, as _das Wetter_ does.
- **French nouns:** an article or gender that contradicts Wiktionary is replaced, such as _la échelle_ for _le échelle_.

A question mark after a transcription means that Wiktionary did not confirm it, and the transcription stays as the model gave it. This happens when:

- Wiktionary has no entry for the word, as for most phrases;
- Wiktionary pronounces homographs differently, such as French _chat_, [ʃa] for a cat and [tʃat] for an online chat;
- a French adjective comes with its feminine form, such as [pəti/pətit], since Wiktionary gives the masculine form;
- the check failed.

Words of the other languages are not checked.

The footer says "checked against Wiktionary", or "Wiktionary unavailable" when the check failed, for example without a network connection or after too many lookups in a short time. A card without German or French words shows neither.

grundform sends Wikimedia no contact details, and Wikimedia allows such clients ten requests a minute from one address. A lookup makes up to two requests, one to each Wiktionary, so about five lookups a minute get the check.

## Dictionary

### Format

The dictionary is a Markdown table in a note. The first column is the number, named `No.`, `Nr.` or `#`; the other columns are named after languages in English:

| No. | Russian translation | French | French transcription | German | German transcription | English translation | English transcription |
| --- | ------------------- | ------ | -------------------- | ------ | -------------------- | ------------------- | --------------------- |

- A column named after a language, alone or with `translation`, holds its entries, and a column with `transcription` holds its transcriptions. Other columns are kept.
- grundform uses the first such table of the note; tables in code blocks and comments do not count. Text outside the table, such as a legend, stays as it is.
- Keep a blank line after the table. Markdown reads a line of text right after it as one more row, and Save stops with a message.
- Keep comments and code blocks out of the table. A comment line between rows ends the table for grundform, so Save stops with a message while rows follow it.

### Choosing the note

No note is chosen at first, and the card shows no dictionary marks. Settings → grundform → Dictionary offers two buttons:

- **Choose…** picks an existing note. The card languages become the languages of its columns, in their order; a note with fewer than two language columns leaves the card languages as they are.
- **Create…** creates a note with an empty table for the current card languages: a column for each language and one for its transcription, except for Russian. Its window asks for a folder and a note name; typing in the folder field lists the vault's folders, and an empty folder means the vault root. The line under the fields shows the path of the new note.

The line under the buttons shows the rows and languages of the note and the card languages it has no column for, or what keeps grundform from using the note. Renaming or moving the note in Obsidian keeps it the dictionary.

### Marks on the card

- **"In the dictionary: 532, 1624"** under the head lists the rows that hold the word.
- **"Row 532"** in a sense means that a row holds this sense: it agrees with the sense in every language where both have an entry, and there are at least two such languages. A language agrees when the entry of the row is the entry of the card or one of its alternatives. German entries are compared with their letter case, which tells _das Essen_ from _essen_.
- **"Similar: row 1624"** next to the Save button means that a row agrees with the sense in two languages and differs in another, often by a synonym, such as French _classer_ where the row has _ficher_. A dictionary may keep such a synonym in a row of its own, so Save stays available.

### Saving a sense

Save adds the row at once: the entry and transcription fields are filled from the card, and the fields of other columns stay empty. Hold Save, or right-click it on the Mac, to see the row first, one field per column, correct any field and then press Save. The row gets the next number and goes to the end of the table. Definitions, forms, alternatives, examples and notes stay in the card. After a save the card reads the note again, so the marks of all its senses follow the rows the note holds now.

Save never adds or removes columns: a card language without a column is left out, and a language removed from the card keeps its column in the note. grundform aligns the whole table the way Prettier does, so a later Prettier run leaves the note unchanged. On a table that is not aligned yet, the first Save aligns every row.

## Study

The study tab shows the rows of the dictionary note as cards. Open it with the ribbon button "Study the grundform dictionary" or the command "grundform: Study the dictionary".

### Cards

Each row gives two cards for the language of the setting Study from, by default the first language column of the note:

- **Forward card,** marked "From Russian" for Russian: shows the word in the Study from language and asks for the words of the other languages.
- **Reverse card,** marked "To Russian": shows the word in another language of the row and asks for the rest of the row. Each study day with an answer to the reverse card takes the next language of the row, and neighbouring rows start from different languages.

A row gives cards when it has a number, a word in the Study from language and a word in at least one other language. A language without a word in the row is left out of its cards. Of rows with the same number, the first one that can give cards does. A Study from language without a column in the note gives way to the first language column.

### Learn

Recall the answer, press Show answer or Space, and rate how well you remembered it with Again, Hard, Good or Easy, or with the keys 1 to 4; Space rates Good. Each button shows when the card comes back. The answer lists every word of the row with its transcription, and clicking or tapping a word looks up its dictionary form in the language of its column.

- **Schedule:** FSRS, a spaced-repetition algorithm that Anki also offers, aiming at 90% recall. A new card rated Again, Hard or Good and a forgotten card come back within minutes, up to 20 minutes early when no other card is left. A new card rated Easy comes back in days.
- **Cards of a day:** the cards due that day; new rows in the order of their numbers, up to New words a day; and up to as many reverse cards of rows whose forward card was first answered on an earlier day. New words a day set to 0 stops both kinds of new cards.
- **One card of a row a day:** the second card of a row waits for the next day, so one card does not give away the answer of the other. While one card of a row is in its learning steps, the other waits as well.
- **Day:** a study day starts at 4:00, so a session after midnight counts for the evening before.

The line at the top shows the cards to repeat, which are the cards seen before that are due today, the new words still to come today, up to New words a day in each direction, the answers of the day and the days in a row with answers; the last two count the answers of every Study from language. Undo, or Cmd+Z, takes back the answers given in the tab since it opened for the current dictionary note and Study from language, latest first, and shows the card again. Under a shown answer, Open the row in the note opens the dictionary note at the row, with the cursor in its first cell in editing mode, for example to correct a word.

### Browse

Browse shows one row at a time in the order of the table, with all its words and transcriptions, each a link to its card. The buttons ‹ and › or the arrow keys move to the previous or next row, and the number field jumps to a row; a number that no row has goes to the next row after it. Under a row that gives cards, the state of its two cards: new, learning or due, with the time until the card comes back. Open the row in the note works as in Learn. The line at the top counts the rows that give cards as words: learned, with both cards answered and out of their learning steps, learning, and not started; a forgotten card takes its word back to learning. Each device remembers the row it showed last.

### Progress

- Each answer is a line in a file in `.obsidian/plugins/grundform/study/`, one file per device and month, such as `desktop-k3j9x2-2026-11.jsonl`. A line holds the time of the answer in milliseconds since 1970, which is the time the answer was shown unless the rating came more than a minute later, the row number, the Study from language, the direction, the rating from 1, Again, to 4, Easy, and the path of the dictionary note: `{"time":1762164900000,"row":12,"from":"ru","direction":"forward","rating":3,"note":"Dictionary.md"}`.
- Each device writes only its own files, so two devices never change the same file. iCloud Drive copies the folder to the other devices; with a sync that leaves out `.obsidian`, each device keeps its own progress.
- The study tab reads the files of all devices when it opens, when it comes to the front, when Obsidian comes back to the foreground, when you open it again with the ribbon button or the command and when you press Learn or Browse. A line under the bar counts the files of other devices that iCloud has not downloaded yet; their answers count once they arrive. On the iPhone, while iCloud keeps only a placeholder of this device's file of the month, an answer is not saved and a notice says so.
- The progress belongs to the dictionary note, the row number and the Study from language. Another dictionary note chosen in the settings starts with its own progress, and a renamed note starts anew. An answer written before the note was recorded, without `note`, counts for every note. Corrections of a row keep its progress. Another Study from language has progress of its own, and switching back brings back the old one. A row that gets another number starts anew, and a new row that takes the number of a deleted one, as the next saved row does after the last row is deleted, takes over its progress.
- To start over on every device, delete `.obsidian/plugins/grundform/study`, for example in the Finder, where Cmd+Shift+. shows hidden folders. The sync removes it on the other devices.
- In a vault kept in git, the folder is ignored together with `.obsidian/plugins/grundform/`, as [Settings](#settings) suggests, so git neither keeps nor carries the progress.

## Requests, cost and cache

### Requests and cost

Every lookup that is not in the cache sends the word to the provider, and the German and French words of the card to Wiktionary.

On ten test words with several senses each, _ablegen, aufhören, Zug, Bank, Leiter, passer, le temps, la règle, take off_ and _file_:

| Card languages                    | Median time | Average cost |
| --------------------------------- | ----------- | ------------ |
| French, German, English (default) | 17 s        | $0.006       |
| Russian, French, German, English  | 20 s        | $0.007       |

The Wiktionary check adds about a second.

### Cache

Cards of earlier lookups are kept in a cache on each device, so a repeated lookup opens at once and costs nothing.

- The footer of a card from the cache says "from cache" and offers Look up again, which asks the model anew and replaces the cached card, or removes it when the new card does not go into the cache.
- A card goes into the cache unless the model found no such word or the Wiktionary check failed.
- Changing the base URL, the model, the reasoning effort, or the card languages or their order makes grundform look the word up again.
- The cache lives in the storage of Obsidian on the device, outside the vault, so it does not sync. It keeps up to 1000 cards and drops the oldest.
- Settings → grundform → Cache shows the number of cached cards and empties the cache with Clear cache.

## Development

The plugin is in `src/`:

- `main.ts` registers the commands, the context menu item and the link, loads the settings and sends HTTP requests through Obsidian;
- `languages.ts` lists the card languages with their flags and entry conventions;
- `prompt.ts` and `card.ts` hold the prompt and the JSON schema of the card, and `ai.ts` sends the request;
- `wiktionary.ts` checks the card against Wiktionary, and `lookup.ts` runs the request and the check;
- `card-cache.ts` keeps the cards of earlier lookups on the device;
- `card-view.ts` renders the card, and `modals.ts` and `dictionary-modals.ts` hold the dialogs;
- `dictionary.ts` parses the dictionary table and appends rows to its text, and `dictionary-note.ts` reads and writes the note in the vault;
- `study.ts` computes the study schedule from the answers with [ts-fsrs](https://github.com/open-spaced-repetition/ts-fsrs), `study-log.ts` keeps the answers, and `study-view.ts` is the study tab;
- `settings.ts` holds the settings and their tab, and `ui.ts` small helpers for the dialogs and the settings.

Only `main.ts`, `dictionary-note.ts`, `settings.ts`, the dialogs, `study-log.ts` and `study-view.ts` use the Obsidian API. The other modules are plain TypeScript, so the prototype runs the same prompt, schema and request on Node.js. The design and the reasons behind it are in [docs/design.md](docs/design.md).

Check the types, build the plugin into `dist/`, or build and install it:

```bash
npm run check
npm run build
npm run install-plugin
```

`npm run check` checks the plugin with `tsconfig.json`, against ES2021 and the DOM without Node.js types, as Obsidian on iOS 15 runs it, and the prototype and the scripts with `tsconfig.node.json`.

Format the code and the documents with Prettier:

```bash
npm run format
```

### Prototype

The command-line prototype in `prototype/` looks up words with the same prompt and schema and compares models. It prints the card as the model gives it, without the Wiktionary check. It runs on Node.js 24, which runs TypeScript files directly.

It reads its settings from `.env`:

- `XAI_API_KEY` and `OPENAI_API_KEY`; a key is needed only for the provider in use;
- `AI_MODEL`, the default model;
- `LANGUAGES`, the card languages in column order.

A model is written as `[provider/]name[:effort]`. The provider is `xai` or `openai` and defaults to `xai`. The effort after the colon is sent as `reasoning_effort`. Examples are `grok-4.3`, `grok-4.7:low` and `openai/gpt-6.1-terra:none`.

List the models available to a provider's key, `xai` by default:

```bash
node prototype/models.ts openai
```

Look up one word and print its card. `--lang` gives a language hint, `--model` overrides `AI_MODEL`, `--json` prints the card as JSON, and `--dry-run` prints the request without calling the API:

```bash
node prototype/lookup.ts ablegen
node prototype/lookup.ts bald --lang de --model grok-4.7:low
node prototype/lookup.ts ablegen --dry-run
```

Run test words on one or more models:

```bash
node prototype/batch.ts --model grok-4.7:low,openai/gpt-6.1-terra:none --out out/run-3
```

- The words come from `prototype/words.txt` or from the file given by `--words`: one word or phrase per line, optionally followed by a language hint such as `@de`; lines that start with `#` are comments.
- `--concurrency` sets how many requests run at once, 4 by default.
- Each model gets a folder in `out/`, or in the folder given by `--out`, with the raw cards and `report.md`. `summary.md` in the output folder compares the models by failures, latency and cost.
- xAI reports the cost of each request; for OpenAI models the cost comes from the price list in `prototype/prices.ts`.

## License

grundform is released under the [MIT License](LICENSE). The build includes [ts-fsrs](https://github.com/open-spaced-repetition/ts-fsrs), copyright Open Spaced Repetition, also under the MIT License. The Wiktionary content that the plugin fetches at run time is under the [Creative Commons Attribution-ShareAlike 4.0 license](https://creativecommons.org/licenses/by-sa/4.0/).
