/**
 * Strips the Markdown syntax that Grammarly's server removes before it analyses
 * text, and returns the stripped plain text together with a position-mapping
 * array so that alert positions (which are in Grammarly's coordinate space) can
 * be translated back to correct CM6 document positions.
 *
 * Elements stripped:
 *   • YAML frontmatter   — the opening ---…--- block
 *   • ATX headings       — # Heading, ## Heading, …
 *   • Unordered lists    — - item, * item, + item  (optional leading whitespace)
 *   • Ordered lists      — 1. item, 2. item, …     (optional leading whitespace)
 *   • Blockquotes        — > text
 *
 * NOT stripped (too rare in journal notes to justify the complexity right now):
 *   **bold**, *italic*, [[wikilinks]], inline `code`, fenced code blocks, URLs.
 *
 * grammarlyToOrig[grammarlyPos]  →  CM6 document position
 *
 * If a Grammarly alert index is out of range (e.g. pointing at a trailing
 * newline beyond the last mapped character) the caller should clamp to the
 * last entry or the document length.
 */
export interface TextMapping {
    plainText: string;
    grammarlyToOrig: number[];
}

export function buildTextMapping(text: string): TextMapping {
    const grammarlyToOrig: number[] = [];
    let plainText = '';

    let pos = 0;
    let lineIdx = 0;
    let inFrontmatter = false;

    while (pos < text.length) {
        const nlPos    = text.indexOf('\n', pos);
        const lineEnd  = nlPos === -1 ? text.length : nlPos;
        const rawLine  = text.slice(pos, lineEnd);
        const line     = rawLine.replace(/\r$/, '');     // normalise \r\n

        // ── YAML frontmatter ────────────────────────────────────────────
        if (lineIdx === 0 && line === '---') {
            inFrontmatter = true;
            pos = lineEnd + (nlPos === -1 ? 0 : 1);
            lineIdx++;
            continue;
        }
        if (inFrontmatter) {
            if (line === '---' || line === '...') inFrontmatter = false;
            pos = lineEnd + (nlPos === -1 ? 0 : 1);
            lineIdx++;
            continue;
        }

        // ── Determine where the line's prose content begins ─────────────
        let contentStart = pos;

        const headingMatch = line.match(/^(#{1,6} )/);
        if (headingMatch) {
            contentStart = pos + headingMatch[0].length;
        } else {
            const ulMatch = line.match(/^(\s*[-*+] )/);
            if (ulMatch) {
                contentStart = pos + ulMatch[0].length;
            } else {
                const olMatch = line.match(/^(\s*\d+\.\s+)/);
                if (olMatch) {
                    contentStart = pos + olMatch[0].length;
                } else if (line.startsWith('> ')) {
                    contentStart = pos + 2;
                }
            }
        }

        // ── Map each prose character ─────────────────────────────────────
        for (let i = contentStart; i < lineEnd; i++) {
            grammarlyToOrig.push(i);
            plainText += text[i];
        }

        // Map the newline itself (Grammarly counts newlines)
        if (nlPos !== -1) {
            grammarlyToOrig.push(nlPos);
            plainText += '\n';
        }

        pos = lineEnd + (nlPos === -1 ? 0 : 1);
        lineIdx++;
    }

    return { plainText, grammarlyToOrig };
}
