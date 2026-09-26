/**
 * WhatsApp & Mobile Message Formatter
 *
 * Ensures all outbound messages to WhatsApp and Flutter are:
 * 1. Free of broken Markdown tables (converts them to elegant bullet points / key-value lists).
 * 2. Free of raw HTML tags (<br>, <b>, <div>, etc.).
 * 3. Formatted using WhatsApp native styling (*bold*, _italic_, bullet symbols).
 * 4. Cleanly chunked into 2 to 3 natural, readable messages for long responses.
 */

export interface MessageSplitOptions {
  /** Minimum character length required before attempting to split (default: 750) */
  minLengthToSplit?: number;
  /** Ideal target length for each chunk (default: 700) */
  targetChunkLength?: number;
  /** Maximum number of chunks to produce (default: 3) */
  maxChunks?: number;
}

/**
 * Converts Markdown tables into mobile-friendly WhatsApp bullet lists.
 */
export function convertMarkdownTablesToWhatsApp(text: string): string {
  // Matches consecutive markdown table rows
  const tableRegex = /((?:^[ \t]*\|[^\n]+\|[ \t]*(?:\r?\n|$))+)/gm;

  return text.replace(tableRegex, (match) => {
    const rawLines = match
      .trim()
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);

    if (rawLines.length < 2) return match;

    // Filter out separator lines like |---|---| or |:---|---:|
    const contentLines = rawLines.filter(
      (line) => !/^[ \t]*\|([ \t]*:?-+:?[ \t]*\|)+[ \t]*$/.test(line)
    );

    if (contentLines.length < 2) return match;

    const parseCells = (line: string) =>
      line
        .replace(/^[ \t]*\|/, '')
        .replace(/\|[ \t]*$/, '')
        .split('|')
        .map((cell) => cell.trim());

    const headers = parseCells(contentLines[0]);
    const dataRows = contentLines.slice(1).map(parseCells);

    const formattedSections: string[] = [];

    for (const row of dataRows) {
      if (row.length === 0 || row.every((c) => !c)) continue;

      // First column is the attribute/feature name
      const attribute = row[0].replace(/^\*+|\*+$/g, '').trim();
      const values = row.slice(1);

      if (values.length === 1) {
        // Simple 2-column table: • *الخاصية*: القيمة
        formattedSections.push(`• *${attribute}*: ${values[0]}`);
      } else if (values.length > 1) {
        // Multi-column comparison table:
        // 📌 *الخاصية*:
        //   ▫️ *موديل 1*: قيمة 1
        //   ▫️ *موديل 2*: قيمة 2
        const isArabicText = /[\u0600-\u06FF]/.test(text);
        const subItems: string[] = [];
        for (let i = 0; i < values.length; i++) {
          const val = values[i];
          if (!val) continue;
          const fallbackCol = isArabicText ? `خيار ${i + 1}` : `Option ${i + 1}`;
          const colHeader = headers[i + 1] ? headers[i + 1].replace(/^\*+|\*+$/g, '').trim() : fallbackCol;
          subItems.push(`  ▫️ *${colHeader}*: ${val}`);
        }

        if (subItems.length > 0) {
          formattedSections.push(`📌 *${attribute}*:\n${subItems.join('\n')}`);
        }
      }
    }

    return formattedSections.join('\n\n');
  });
}

/**
 * Cleans and harmonizes text specifically for WhatsApp and mobile viewing.
 */
export function cleanWhatsAppText(rawText: string): string {
  if (!rawText || !rawText.trim()) return '';

  let text = rawText;

  // 1. Separate code blocks to preserve them intact
  const codeBlocks: string[] = [];
  text = text.replace(/```[\s\S]*?```/g, (match) => {
    codeBlocks.push(match);
    return `__CODE_BLOCK_${codeBlocks.length - 1}__`;
  });

  // 2. Convert Markdown tables to clean mobile bullet lists
  text = convertMarkdownTablesToWhatsApp(text);

  // 3. Replace <br>, <br/>, <br /> with standard newline and clean surrounding spaces
  text = text.replace(/[ \t]*<br\s*\/?>[ \t]*/gi, '\n');

  // 4. Convert basic HTML formatting to WhatsApp syntax
  text = text.replace(/<\s*(?:b|strong)\s*>(.*?)<\s*\/\s*(?:b|strong)\s*>/gi, '*$1*');
  text = text.replace(/<\s*(?:i|em)\s*>(.*?)<\s*\/\s*(?:i|em)\s*>/gi, '_$1_');
  text = text.replace(/<\s*(?:s|strike|del)\s*>(.*?)<\s*\/\s*(?:s|strike|del)\s*>/gi, '~$1~');
  text = text.replace(/<\s*code\s*>(.*?)<\s*\/\s*code\s*>/gi, '`$1`');

  // 5. Strip any remaining unsupported HTML tags
  text = text.replace(/<[^>]+>/g, '');

  // 6. Convert Markdown headers (###, ##, #) to WhatsApp Bold
  text = text.replace(/^#{1,6}\s+(.+)$/gm, '*$1*');

  // 7. Convert Markdown double asterisks **text** to single asterisk *text*
  // WhatsApp uses *bold*; **bold** renders ugly literal stars
  text = text.replace(/\*\*([^*]+)\*\*/g, '*$1*');

  // 8. Convert list markers `* item` to bullet `• item` so they don't break bold tags
  text = text.replace(/^([ \t]*)\*\s+([^*])/gm, '$1• $2');

  // 9. Normalize excessive newlines (max 2 consecutive newlines)
  text = text.replace(/\n{3,}/g, '\n\n');

  // 10. Restore code blocks
  text = text.replace(/__CODE_BLOCK_(\d+)__/g, (_, idx) => {
    return codeBlocks[parseInt(idx, 10)] || '';
  });

  return text.trim();
}

/**
 * Splits a long response into 2 or 3 natural, readable messages for WhatsApp.
 */
export function splitWhatsAppMessage(
  text: string,
  options: MessageSplitOptions = {}
): string[] {
  const {
    minLengthToSplit = 750,
    targetChunkLength = 700,
    maxChunks = 3,
  } = options;

  const cleaned = cleanWhatsAppText(text);

  // If short enough, keep as single message
  if (cleaned.length <= minLengthToSplit) {
    return [cleaned];
  }

  // Split into paragraphs / logical blocks
  const blocks = cleaned.split(/\n\n+/).map((b) => b.trim()).filter(Boolean);

  if (blocks.length <= 1) {
    // If there are no paragraph breaks, try splitting by single newlines
    const lineBlocks = cleaned.split(/\n+/).map((l) => l.trim()).filter(Boolean);
    if (lineBlocks.length <= 1) {
      // Single continuous wall of text: split by sentence endings
      return splitBySentence(cleaned, targetChunkLength, maxChunks);
    }
    return groupBlocksIntoChunks(lineBlocks, '\n', targetChunkLength, maxChunks);
  }

  return groupBlocksIntoChunks(blocks, '\n\n', targetChunkLength, maxChunks);
}

/**
 * Groups paragraphs or lines into balanced chunks (typically 2 or 3).
 */
function groupBlocksIntoChunks(
  blocks: string[],
  delimiter: string,
  targetLength: number,
  maxChunks: number
): string[] {
  const totalLength = blocks.reduce((acc, b) => acc + b.length + delimiter.length, 0);

  // Decide how many chunks to produce: 2 or 3 (capped by maxChunks)
  const desiredChunkCount = Math.min(
    maxChunks,
    Math.max(2, Math.round(totalLength / targetLength))
  );

  const idealChunkSize = totalLength / desiredChunkCount;
  const chunks: string[] = [];
  let currentChunk: string[] = [];
  let currentLength = 0;

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    const blockLen = block.length + delimiter.length;

    // Check if adding this block exceeds ideal chunk size, AND we haven't reached maxChunks - 1 yet
    const shouldBreak =
      chunks.length < desiredChunkCount - 1 &&
      currentLength > 0 &&
      currentLength + blockLen / 2 > idealChunkSize;

    if (shouldBreak) {
      chunks.push(currentChunk.join(delimiter).trim());
      currentChunk = [block];
      currentLength = blockLen;
    } else {
      currentChunk.push(block);
      currentLength += blockLen;
    }
  }

  if (currentChunk.length > 0) {
    chunks.push(currentChunk.join(delimiter).trim());
  }

  return chunks.filter((c) => c.length > 0);
}

/**
 * Splits continuous text without newlines by sentence punctuation.
 */
function splitBySentence(
  text: string,
  targetLength: number,
  maxChunks: number
): string[] {
  const sentences = text
    .split(/(?<=[.!?؟\n])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

  if (sentences.length <= 1) {
    // If really no punctuation, split at word boundary near targetLength
    const chunks: string[] = [];
    let remaining = text;
    while (remaining.length > targetLength && chunks.length < maxChunks - 1) {
      const splitIdx = remaining.lastIndexOf(' ', targetLength);
      const cut = splitIdx > 0 ? splitIdx : targetLength;
      chunks.push(remaining.substring(0, cut).trim());
      remaining = remaining.substring(cut).trim();
    }
    if (remaining.length > 0) {
      chunks.push(remaining);
    }
    return chunks;
  }

  return groupBlocksIntoChunks(sentences, ' ', targetLength, maxChunks);
}
