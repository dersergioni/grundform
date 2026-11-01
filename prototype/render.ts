// Markdown view of a word card for the terminal and the reports.

import { findGenderMismatches, type Equivalent, type WordCard } from "../src/card.ts";

function escapeCell(text: string): string {
    return text.replace(/\|/g, "\\|");
}

function renderEquivalent(equivalent: Equivalent | undefined): string {
    if (!equivalent) {
        return "_missing_";
    }
    const parts = [`**${equivalent.entry}** ${equivalent.ipa}`.trim()];
    if (equivalent.forms) {
        parts.push(equivalent.forms);
    }
    if (equivalent.alternatives.length > 0) {
        parts.push(`_also: ${equivalent.alternatives.join(", ")}_`);
    }
    if (equivalent.definition) {
        parts.push(equivalent.definition);
    }
    return escapeCell(parts.join("<br>"));
}

export function renderCard(card: WordCard, languages: readonly string[]): string {
    if (!card.found) {
        const suggestions = card.suggestions.length > 0 ? card.suggestions.join(", ") : "none";
        return `Not found. Suggestions: ${suggestions}.`;
    }

    const lines = [[`**${card.lemma}**`, card.query_language, card.query_form].filter(Boolean).join(" · ")];
    if (card.other_readings.length > 0) {
        const readings = card.other_readings.map(
            (reading) => `${reading.language} ${reading.lemma} (${reading.gloss})`,
        );
        lines.push(`Also: ${readings.join("; ")}`);
    }

    lines.push("", `| Sense | ${languages.map((code) => code.toUpperCase()).join(" | ")} |`);
    lines.push(`| --- | ${languages.map(() => "---").join(" | ")} |`);
    card.senses.forEach((sense, index) => {
        const cells = languages.map((code) =>
            renderEquivalent(sense.equivalents.find((equivalent) => equivalent.language === code)),
        );
        lines.push(`| ${index + 1}. _(${sense.part_of_speech})_ | ${cells.join(" | ")} |`);
    });

    const mismatches = new Map(findGenderMismatches(card).map((mismatch) => [mismatch.sense, mismatch]));
    lines.push("");
    card.senses.forEach((sense, index) => {
        lines.push(`${index + 1}. ${sense.examples.map((example) => `_${example.text}_`).join(" · ")}`);
        for (const note of sense.notes) {
            lines.push(`   - Note: ${note}`);
        }
        const mismatch = mismatches.get(index);
        if (mismatch) {
            const genders = mismatch.genders.map((item) => `${item.language} ${item.gender}`);
            lines.push(`   - Gender: ${genders.join(", ")}`);
        }
    });
    return lines.join("\n");
}
