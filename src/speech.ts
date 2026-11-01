// Pronunciation through the speech synthesis of the system: the voices of macOS and iOS, which need no network and
// cost nothing.

import { findLanguage } from "./languages.ts";

// A French article that the dictionary writes before a vowel or a mute h to show the gender, as in "le accord".
const kFrenchArticle = /^(le|la) (?=[aeiouàâäæéèêëîïôöœùûüh])/i;

// The text of a dictionary entry as it is spoken: its forms and variants one after another, without the hints in
// brackets and parentheses. The article of a French noun is elided again, unless the transcription marks an
// aspirated h with an apostrophe, as in "le haricot ['aʁiko]".
export function spokenText(entry: string, language: string, transcription = ""): string {
    let text = entry
        .replace(/\\\|/g, "|")
        .replace(/\[[^\]]*\]|\([^)]*\)/g, " ")
        .replace(/<br\s*\/?>|\/|\.\.\.|…/gi, ", ")
        .replace(/\s+/g, " ")
        .replace(/\s+,/g, ",")
        .replace(/(,\s*)+/g, ", ")
        .replace(/^[\s,]+|[\s,]+$/g, "");
    if (language === "fr" && kFrenchArticle.test(text)) {
        const aspirated = /^h/i.test(text.replace(kFrenchArticle, "")) && /^\[\s*['ʼ’]/.test(transcription.trim());
        if (!aspirated) {
            text = text.replace(kFrenchArticle, "l'");
        }
    }
    return text;
}

function speechSynthesis(): SpeechSynthesis | undefined {
    return typeof window.speechSynthesis === "undefined" || typeof SpeechSynthesisUtterance === "undefined"
        ? undefined
        : window.speechSynthesis;
}

// Whether the language can be spoken here. The first call also makes Chromium load its list of voices.
export function canSpeak(language: string): boolean {
    const synthesis = speechSynthesis();
    synthesis?.getVoices();
    return synthesis !== undefined && findLanguage(language)?.voice !== undefined;
}

// The best voice of the system for a language tag such as "en-GB": a voice of the region over one of the language
// alone, and a premium or enhanced voice over a plain one. The Eloquence voices of Apple, such as "Eddy (English (UK))",
// sound robotic and come last. Without a list of voices the system picks one by the language of the text.
function pickVoice(voices: readonly SpeechSynthesisVoice[], tag: string): SpeechSynthesisVoice | undefined {
    const wanted = tag.toLowerCase();
    const base = wanted.split("-")[0]!;
    let best: SpeechSynthesisVoice | undefined;
    let bestScore = 0;
    for (const voice of voices) {
        const lang = voice.lang.toLowerCase().replace("_", "-");
        if (lang.split("-")[0] !== base) {
            continue;
        }
        let score = lang === wanted ? 10 : 5;
        if (/premium/i.test(voice.name)) {
            score += 3;
        } else if (/enhanced/i.test(voice.name)) {
            score += 2;
        }
        if (/\(.*\(/.test(voice.name)) {
            score -= 4;
        }
        if (voice.localService) {
            score += 1;
        }
        if (score > bestScore) {
            best = voice;
            bestScore = score;
        }
    }
    return best;
}

// Speaks the text in the language, stopping what is being spoken.
export function speak(text: string, language: string): void {
    const synthesis = speechSynthesis();
    const tag = findLanguage(language)?.voice;
    if (!synthesis || !tag || !text) {
        return;
    }
    // Safari may drop an utterance that comes right after a cancel, so only speech under way is cancelled.
    if (synthesis.speaking || synthesis.pending) {
        synthesis.cancel();
    }
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = tag;
    const voice = pickVoice(synthesis.getVoices(), tag);
    if (voice) {
        utterance.voice = voice;
    }
    synthesis.speak(utterance);
}
