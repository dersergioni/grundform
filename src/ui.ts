// Helpers shared by the dialogs and the settings tab.

// The message of a caught error for a notice or a line of text.
export function errorText(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

// Autocorrect, autocapitalization and the spell check on the iPhone would change foreign words and paths.
export function plainInput(input: HTMLInputElement): void {
    input.setAttribute("autocapitalize", "off");
    input.setAttribute("autocorrect", "off");
    input.spellcheck = false;
}
