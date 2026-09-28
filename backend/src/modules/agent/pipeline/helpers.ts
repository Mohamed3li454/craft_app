/**
 * Agent Pipeline Helper Functions (Phase 8.1)
 *
 * Extracted pure utility functions for multimodal processing,
 * conversation history formatting, and tool result serialization.
 */

import mammoth from 'mammoth';
import { logger } from '../../../core/logger';
import { GroqMessage } from '../../groq/groq.provider';
import { MessageEntity } from '../../../database/repositories/types';
import { LanguageContext } from '../../language';
import { ContextWindowManager } from '../../conversation';
import { AgentMediaAttachment } from './types';

/**
 * Prepares user prompt and text from media attachments:
 * - Images: user prompt/caption for Groq vision
 * - PDFs: user prompt/caption (raw text parsing is not yet implemented)
 * - Word docs (.docx): extracts raw text via mammoth and embeds in prompt
 * - Code & text (.dart, .ts, .md, .txt, etc.): decodes UTF-8 and embeds in prompt
 */
export async function processMediaAttachment(
  userText: string,
  media?: AgentMediaAttachment,
  languageContext?: LanguageContext
): Promise<{
  effectivePrompt: string;
  historyRecordText: string;
}> {
  const cleanText = (userText || '').trim();
  const isEnglish = languageContext?.targetLanguage === 'en';

  if (!media) {
    return {
      effectivePrompt: cleanText,
      historyRecordText: cleanText,
    };
  }

  const filename = media.filename || '';
  const lastDot = filename.lastIndexOf('.');
  const ext = lastDot !== -1 ? filename.substring(lastDot).toLowerCase() : '';
  const mime = (media.mimeType || '').toLowerCase();

  // 1. Image formats (JPEG, PNG, WebP, GIF, HEIC, BMP)
  const isImage =
    mime.startsWith('image/') ||
    ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.heic'].includes(ext);
  if (isImage) {
    const defaultImagePrompt = isEnglish
      ? 'Analyze this attached image and explain what you see in detail.'
      : 'حلل هذه الصورة المرفقة واشرح ما تراه فيها بشكل مفصل ودقيق.';
    const effectivePrompt = cleanText
      ? `${cleanText}\n(${isEnglish ? 'Attached image' : 'مرفق صورة مع هذا الطلب'})`
      : defaultImagePrompt;
    const historyRecordText = cleanText
      ? `[${isEnglish ? 'Attached Image' : 'صورة مرفقة'}] ${cleanText}`
      : `[${isEnglish ? 'Attached Image' : 'صورة مرفقة'}]`;
    return { effectivePrompt, historyRecordText };
  }

  // 2. Audio & Voice Notes (OGG Opus from WhatsApp, MP3, WAV, AAC, M4A)
  const cleanMime = mime.split(';')[0].trim();
  const isAudio =
    cleanMime.startsWith('audio/') ||
    ['.ogg', '.opus', '.mp3', '.m4a', '.aac', '.wav', '.flac', '.amr'].includes(ext);
  if (isAudio) {
    const defaultAudioPrompt = isEnglish
      ? 'Listen carefully to this attached audio recording and answer or fulfill the request as Craft AI assistant.'
      : 'استمع إلى هذا التسجيل الصوتي المرفق بعناية وافهم ما يقوله المستخدم بدقة، ثم أجب عليه أو نفذ طلبه بالشكل المطلوب كوكيل ذكي.';
    const effectivePrompt = cleanText
      ? `${cleanText}\n(${isEnglish ? 'Attached audio recording' : 'مرفق تسجيل صوتي مع هذا الطلب'})`
      : defaultAudioPrompt;
    const historyRecordText = cleanText
      ? `[${isEnglish ? 'Audio recording' : 'تسجيل صوتي'}: ${cleanText}]`
      : `[${isEnglish ? 'Audio recording from user' : 'تسجيل صوتي من المستخدم'}]`;
    return { effectivePrompt, historyRecordText };
  }

  // 3. PDF Documents
  const isPdf = mime === 'application/pdf' || ext === '.pdf';
  if (isPdf) {
    const defaultPdfPrompt = isEnglish
      ? 'Read this attached PDF document and explain or summarize its contents in detail.'
      : 'اقرأ هذا المستند المرفق بصيغة PDF واشرح أو لخص محتواه بالتفصيل.';
    const effectivePrompt = cleanText
      ? `${cleanText}\n(${isEnglish ? 'Attached PDF' : 'مرفق مستند PDF'}: ${filename || 'document.pdf'})`
      : defaultPdfPrompt;
    const historyRecordText = cleanText
      ? `[${isEnglish ? 'Attached PDF' : 'ملف PDF مرفق'}: ${filename || 'document.pdf'}] ${cleanText}`
      : `[${isEnglish ? 'Attached PDF' : 'ملف PDF مرفق'}: ${filename || 'document.pdf'}]`;
    return { effectivePrompt, historyRecordText };
  }

  // 4. Word Documents (.docx)
  const isDocx = ext === '.docx' || mime.includes('wordprocessingml') || mime.includes('msword');
  if (isDocx) {
    let docText = '';
    try {
      const result = await mammoth.extractRawText({ buffer: media.buffer });
      docText = result.value.trim();
    } catch (err: any) {
      logger.warn('Failed to extract text from DOCX with mammoth', { error: err.message });
      docText = isEnglish
        ? '(Failed to extract text from Word document automatically)'
        : '(تعذر استخراج النص من ملف Word تلقائياً)';
    }

    const defaultDocxPrompt = isEnglish
      ? 'Read this attached document and explain its main points in detail.'
      : 'اقرأ محتوى هذا المستند المرفق واشرح أهم ما ورد فيه بالتفصيل.';
    const docLabel = isEnglish ? 'Attached Word document' : 'ملف Word مرفق';
    const contentLabel = isEnglish ? 'Document Content' : 'محتوى المستند';
    const effectivePrompt = `[${docLabel}: ${filename || 'document.docx'}]\n\n${contentLabel}:\n\`\`\`text\n${docText}\n\`\`\`\n\n${cleanText || defaultDocxPrompt}`;
    const historyRecordText = cleanText
      ? `[${docLabel}: ${filename || 'document.docx'}] ${cleanText}`
      : `[${docLabel}: ${filename || 'document.docx'}]`;

    return { effectivePrompt, historyRecordText };
  }

  // 5. Code & Text Files (.dart, .ts, .js, .py, .json, .yaml, .md, .txt, etc.)
  const codeExtensions: Record<string, string> = {
    '.dart': 'dart',
    '.ts': 'typescript',
    '.tsx': 'typescript',
    '.js': 'javascript',
    '.jsx': 'javascript',
    '.json': 'json',
    '.yaml': 'yaml',
    '.yml': 'yaml',
    '.md': 'markdown',
    '.txt': 'text',
    '.py': 'python',
    '.html': 'html',
    '.css': 'css',
    '.xml': 'xml',
    '.sql': 'sql',
    '.sh': 'bash',
    '.env': 'dotenv',
    '.csv': 'csv',
    '.java': 'java',
    '.kt': 'kotlin',
    '.swift': 'swift',
    '.c': 'c',
    '.cpp': 'cpp',
    '.h': 'c',
    '.rs': 'rust',
    '.go': 'go',
  };

  const isCodeOrText =
    codeExtensions[ext] !== undefined ||
    mime.startsWith('text/') ||
    mime.includes('json') ||
    mime.includes('xml') ||
    mime.includes('javascript');

  if (isCodeOrText) {
    const lang = codeExtensions[ext] || 'text';
    const textContent = media.buffer.toString('utf-8');
    const defaultCodePrompt = isEnglish
      ? 'Examine and read this attached code/text file and explain its functionality or answer any questions about it.'
      : 'افحص واقرأ هذا الكود/الملف المرفق واشرح وظيفته بالتفصيل أو أجب عن أي استفسار بشأنه.';
    const codeLabel = isEnglish ? 'Attached code/text file' : 'ملف برمجي/نصي مرفق';
    const effectivePrompt = `[${codeLabel}: ${filename || 'file'}]\n\`\`\`${lang}\n${textContent}\n\`\`\`\n\n${cleanText || defaultCodePrompt}`;
    const historyRecordText = cleanText
      ? `[${isEnglish ? 'Attached file' : 'ملف مرفق'}: ${filename || 'file'}] ${cleanText}`
      : `[${isEnglish ? 'Attached file' : 'ملف مرفق'}: ${filename || 'file'}]`;

    return { effectivePrompt, historyRecordText };
  }

  // 6. Fallback for other file types: attempt UTF-8 decoding
  try {
    const textContent = media.buffer.toString('utf-8');
    if (!textContent.includes('\u0000')) {
      const defaultOtherPrompt = isEnglish
        ? 'Read the content of this attached file and explain it in detail.'
        : 'اقرأ محتوى هذا الملف المرفق واشرحه بالتفصيل.';
      const effectivePrompt = `[${isEnglish ? 'Attached file' : 'ملف مرفق'}: ${filename || 'file'}]\n\`\`\`\n${textContent}\n\`\`\`\n\n${cleanText || defaultOtherPrompt}`;
      const historyRecordText = cleanText
        ? `[${isEnglish ? 'Attached file' : 'ملف مرفق'}: ${filename || 'file'}] ${cleanText}`
        : `[${isEnglish ? 'Attached file' : 'ملف مرفق'}: ${filename || 'file'}]`;
      return { effectivePrompt, historyRecordText };
    }
  } catch {
    // Binary fallback
  }

  const effectivePrompt = `[${isEnglish ? 'Attached file' : 'ملف مرفق'}: ${filename || 'file'} (${isEnglish ? 'type' : 'نوع'}: ${mime || (isEnglish ? 'unknown' : 'غير معروف')})]\n${cleanText || (isEnglish ? 'Attached file received successfully.' : 'تم استلام الملف المرفق بنجاح.')}`;
  const historyRecordText = `[${isEnglish ? 'Attached file' : 'ملف مرفق'}: ${filename || 'file'}] ${cleanText}`.trim();
  return { effectivePrompt, historyRecordText };
}

export function formatGroqConversationHistory(
  messages: MessageEntity[],
  currentInput: string
): GroqMessage[] {
  return ContextWindowManager.formatHistory(
    messages.map((m) => ({
      role: m.senderRole,
      text: m.text,
      createdAt: m.createdAt,
      toolsUsed: m.toolsUsed,
    })),
    currentInput
  );
}

export function serializeToolResultForGroq(
  toolName: string,
  outputOrError: any,
  languageContext?: LanguageContext
): string {
  if (toolName === 'web_search' && outputOrError?.results && Array.isArray(outputOrError.results)) {
    const compactResults = outputOrError.results.slice(0, 8).map((r: any) => {
      let sourceSite = '';
      if (r.url) {
        try {
          sourceSite = new URL(r.url).hostname.replace('www.', '');
        } catch {}
      }
      return {
        title: r.title,
        snippet: (r.snippet || '').substring(0, 500),
        source: sourceSite || undefined,
      };
    });

    const isEnglish = languageContext?.targetLanguage === 'en';
    const instruction = isEnglish
      ? 'Live search completed. Synthesize your final comprehensive response in fluent, natural English now based on the search results above. You MUST state the exact prices, numbers, and distributor details found in the results directly. Do not omit the numbers or be evasive. Never mention RSS, search engine, or API. Do not call any browsing or tool functions; output final text directly.'
      : 'Live search completed. Synthesize your final comprehensive response in natural, friendly Arabic now based on the search results above. You MUST state the exact prices, numbers, and distributor details found in the results directly. Do not omit the numbers or be evasive. Never mention RSS, search engine, or API. Do not call any browsing or tool functions; output final text directly.';

    return JSON.stringify({
      status: 'search_complete',
      query: outputOrError.query,
      results: compactResults,
      instruction,
    });
  }
  return JSON.stringify(outputOrError);
}
