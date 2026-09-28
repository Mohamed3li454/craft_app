/**
 * Memory Architecture - Safety & Privacy Gate (Phase 4.5)
 *
 * Deterministic, zero-LLM, zero-network security gate that protects
 * user memory storage from passwords, credentials, API keys, tokens,
 * financial payment data, government identifiers, security/OTP codes,
 * medical diagnostic records, and precise residential addresses.
 */

import { MemoryCategory } from './types';

export type MemorySafetyReason =
  | 'safe'
  | 'credential'
  | 'financial_secret'
  | 'government_identifier'
  | 'security_code'
  | 'health_data'
  | 'sensitive_address'
  | 'not_worthy'
  | 'ambiguous';

export interface MemorySafetyDecision {
  readonly allowed: boolean;
  readonly reason: MemorySafetyReason;
  readonly category?: MemoryCategory | string;
  readonly details?: string;
}

export class MemorySafetyGate {
  private static instance: MemorySafetyGate;

  public static getInstance(): MemorySafetyGate {
    if (!MemorySafetyGate.instance) {
      MemorySafetyGate.instance = new MemorySafetyGate();
    }
    return MemorySafetyGate.instance;
  }

  /**
   * Main gate evaluator. Inspects candidate text and category,
   * returning a structured decision.
   */
  public evaluate(text: string, category?: MemoryCategory | string): MemorySafetyDecision {
    if (!text || typeof text !== 'string') {
      return { allowed: false, reason: 'not_worthy', details: 'Empty or invalid input' };
    }

    const clean = text.trim();

    // 1. Credentials check (passwords, tokens, API keys, private keys, JWT, Bearer)
    if (this.isCredential(clean)) {
      return {
        allowed: false,
        reason: 'credential',
        details: 'Contains authentication credentials, secret keys, or passwords',
      };
    }

    // 2. Financial secrets check (credit/debit cards, CVV, bank accounts, IBANs)
    if (this.isFinancialSecret(clean)) {
      return {
        allowed: false,
        reason: 'financial_secret',
        details: 'Contains financial payment credentials, card numbers, or CVV',
      };
    }

    // 3. Government identifier check (National ID, passport, SSN, driver license)
    if (this.isGovernmentIdentifier(clean)) {
      return {
        allowed: false,
        reason: 'government_identifier',
        details: 'Contains government identity document numbers',
      };
    }

    // 4. Security / OTP / Verification codes
    if (this.isSecurityCode(clean)) {
      return {
        allowed: false,
        reason: 'security_code',
        details: 'Contains one-time password or verification code',
      };
    }

    // 5. Medical / Health data
    if (this.isHealthData(clean)) {
      return {
        allowed: false,
        reason: 'health_data',
        details: 'Contains medical diagnostic or prescription information',
      };
    }

    // 6. Detailed home address check (precise residential address vs general city/country)
    if (this.isSensitiveAddress(clean)) {
      return {
        allowed: false,
        reason: 'sensitive_address',
        details: 'Contains precise residential address with building or apartment details',
      };
    }

    // 7. Worthiness / Noise check
    const worthiness = this.isMemoryWorthy(clean, category);
    if (!worthiness.allowed) {
      return worthiness;
    }

    return { allowed: true, reason: 'safe', category };
  }

  /**
   * Detects credentials, API keys, access tokens, passwords, and private keys.
   */
  public isCredential(text: string): boolean {
    const lower = text.toLowerCase();

    // Known API key and token signatures
    if (
      /\bsk-[a-zA-Z0-9_\-]{20,}\b/.test(text) || // OpenAI standard key
      /\bsk-ant-[a-zA-Z0-9_\-]{20,}\b/.test(text) || // Anthropic standard key
      /\bAIza[0-9A-Za-z\-_]{30,45}\b/.test(text) || // Google API key
      /\bAKIA[0-9A-Z]{16}\b/.test(text) || // AWS access key ID
      /\b(?:ghp|gho|ghu|ghs|ghr|github_pat)_[a-zA-Z0-9_]{20,}\b/.test(text) || // GitHub tokens
      /\beyJ[a-zA-Z0-9_\-]{10,}\.eyJ[a-zA-Z0-9_\-]{10,}\.[a-zA-Z0-9_\-]{10,}\b/.test(text) || // JWT token
      /\bBearer\s+[a-zA-Z0-9_\-\.]{15,}\b/i.test(text) || // Bearer token
      /-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(text) || // SSH / PEM private key
      /\b(?:ssh-rsa|ssh-ed25519)\s+[A-Za-z0-9+/]{40,}/.test(text) // SSH public/private key
    ) {
      return true;
    }

    // Password declaration patterns (Arabic & English)
    if (
      // English: "my password is ...", "the password is ...", "password: ...", "passcode is ...", "old password was ..."
      /\b(?:my\s+|the\s+)?(?:old\s+|new\s+)?(?:password|passwd|passcode|secret_key|client_secret|app_secret)\s*(?:is|are|was|=|:)\s*\S+/i.test(text) ||
      // Arabic: "كلمة السر بتاعتي ...", "الباسورد بتاعي ...", "كلمة المرور هي ...", "باسوردي هو ...", "باسورد قديم: ..."
      /(?:كلمة المرور|كلمة السر|الباسورد|باسورد|الرقم السري|رمز المرور|المفتاح السري|باسوردي)\s*(?:الخاصة بي|بتاعتي|بتاعي|حقي|تبعنا|القديم|الجديد|قديم|جديد)?\s*(?:هي|هو|كان|is|:|=|:)\s*\S+/i.test(text) ||
      /\b(?:password|passwd|passcode)\s*[:=]\s*\S+/i.test(text)
    ) {
      return true;
    }

    // Generic API Key / Token assignment
    if (
      /(?:api[_\s]?key|access[_\s]?token|refresh[_\s]?token|secret[_\s]?key|مفتاح api|مفتاح الوصول|رمز الوصول|التوكن)\s*[:=isهو]\s*\S+/i.test(
        text
      ) ||
      /\b(?:my\s+)?api[_\s]?key\s*(?:is|starts with|:|=)\s*\S+/i.test(text)
    ) {
      return true;
    }

    return false;
  }

  /**
   * Detects financial payment secrets (card numbers, CVV, bank account, IBAN).
   */
  public isFinancialSecret(text: string): boolean {
    const cleanDigits = text.replace(/[\s\-]/g, '');

    // 1. Credit / Debit card patterns (13 to 19 digits matching card prefixes)
    const cardPattern = /\b(?:4[0-9]{12}(?:[0-9]{3})?|5[1-5][0-9]{14}|6(?:011|5[0-9]{2})[0-9]{12}|3[47][0-9]{13}|3(?:0[0-5]|[68][0-9])[0-9]{11})\b/;
    if (cardPattern.test(cleanDigits)) {
      return true;
    }

    // Explicit card number context + 13-19 digit number
    if (
      /(?:credit card|debit card|card number|رقم الكارت|رقم البطاقة الائتمانية|رقم بطاقة الدفع|فيزا رقم|ماستركارد)\s*(?:هو|is|:)?\s*[:\s]?\s*(?:\d[ \-]?){13,19}\b/i.test(
        text
      )
    ) {
      return true;
    }

    // 2. CVV / CVC security code
    if (
      /(?:cvv|cvc|card security code|الرقم السري للكارت|كود الأمان للكارت|رمز الأمان للبطاقة)\s*(?:هو|is|:)?\s*[:\s]?\s*\d{3,4}\b/i.test(
        text
      )
    ) {
      return true;
    }

    // 3. Bank Account / IBAN
    // Standard IBAN pattern (2 letters country code + 2 digits check + alphanumeric up to 34 chars)
    if (/\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/i.test(text) && /(?:iban|آيبان|حساب|bank)/i.test(text)) {
      return true;
    }

    if (
      /(?:رقم الحساب البنكي|رقم حسابي البنكي|حسابي في البنك|bank account number|bank account)\s*(?:هو|is|:)?\s*[:\s]?\s*\d{8,24}\b/i.test(
        text
      )
    ) {
      return true;
    }

    return false;
  }

  /**
   * Detects government identifiers (National ID, passport number, SSN, driver license).
   */
  public isGovernmentIdentifier(text: string): boolean {
    // National ID (Egyptian 14 digits, Saudi 10 digits, etc.)
    if (
      /(?:رقم البطاقة الشخصية|الرقم القومي|رقم الهوية الوطنية|رقم الهوية|رقم بطاقتي|بطاقتي رقم)\s*(?:هو|is|:)?\s*[:\s]?\s*\d{10,16}\b/i.test(
        text
      ) ||
      /(?:national id|ssn|social security number|tax id)\s*(?:is|#|:)?\s*[:\s]?\s*[A-Z0-9\-]{9,16}\b/i.test(
        text
      )
    ) {
      return true;
    }

    // Passport number
    if (
      /(?:رقم جواز السفر|جواز السفر رقم|رقم باسبوري|باسبوري رقم|passport number|passport no|my passport number|my passport)\s*(?:هو|is|:)?\s*[:\s]?\s*[A-Z0-9]{6,12}\b/i.test(
        text
      )
    ) {
      return true;
    }

    // Driver's license number
    if (
      /(?:رخصة القيادة رقم|رقم رخصة القيادة|driver(?:'s)? license (?:number|no))\s*(?:هو|is|:)?\s*[:\s]?\s*[A-Z0-9]{6,14}\b/i.test(
        text
      )
    ) {
      return true;
    }

    return false;
  }

  /**
   * Detects authentication, 2FA, OTP, and verification codes.
   */
  public isSecurityCode(text: string): boolean {
    // OTP / 2FA / Verification code patterns with 4-8 digits
    if (
      /(?:رمز التحقق|كود التحقق|رمز التأكيد|كود التأكيد|كود التفعيل|رمز الأمان|رمز الـ otp|كود الـ otp|كود otp|رمز otp|الـ\s*otp)\s*(?:اللي وصلني|الخاص بي|المرسل|بتاعي)?\s*(?:هو|is|:|=|:)?\s*[:\s]?\s*\d{4,8}\b/i.test(
        text
      ) ||
      /\b(?:the\s+)?(?:otp|verification code|one-time code|2fa code|auth code|confirmation code|security code)\s*(?:i\s+received|sent\s+to\s+me|received)?\s*(?:is|:|=)?\s*[:\s]?\s*\d{4,8}\b/i.test(
        text
      ) ||
      /(?:الكود|الرمز)\s*هو\s*\d{4,8}\b/i.test(text) ||
      /\b(?:the code is|code is)\s*\d{4,8}\b/i.test(text)
    ) {
      return true;
    }

    // Password reset or recovery code
    if (
      /(?:recovery code|backup code|كود الاسترداد|كود استرجاع الحساب)\s*(?:هو|is|:)?\s*[:\s]?\s*[A-Za-z0-9\-]{6,16}\b/i.test(
        text
      )
    ) {
      return true;
    }

    return false;
  }

  /**
   * Detects medical and health diagnostic records or drug prescriptions.
   */
  public isHealthData(text: string): boolean {
    const healthKeywords = [
      'أنا مريض بـ',
      'أنا مريضة بـ',
      'عندي مرض',
      'عندي السكر',
      'عندي الضغط',
      'أعاني من مرض',
      'أنا مصاب بـ',
      'أنا باخد دواء',
      'باخد دواء',
      'باخد علاج',
      'جرعة الدواء',
      'نتيجة التحليل الطبي',
      'رقم ملفي الطبي',
      'تشخيص الطبيب',
      'تقريري الطبي',
      'i have diabetes',
      'i have been diagnosed with',
      'my medical record',
      'i take medication',
      'my prescription is',
      'lab test result',
    ];

    return healthKeywords.some((kw) => text.toLowerCase().includes(kw.toLowerCase()));
  }

  /**
   * Distinguishes precise home addresses (blocked) from general city/country locations (allowed).
   */
  public isSensitiveAddress(text: string): boolean {
    // Precise residential address with apartment / floor / building numbers
    if (
      /(?:عنوان بيتي بالتفصيل|عنوان منزلي بالتفصيل|عنوان بيتي هو|my exact home address|my full address)\s*(?:هو|بالتفصيل|is|:)/i.test(
        text
      ) ||
      /(?:شارع|street).+(?:عمارة|building|شقة|apt|apartment|طابق|دور|floor)\s+\d+/i.test(text) ||
      /(?:عمارة|building)\s+\d+.+(?:شقة|apt|apartment)\s+\d+/i.test(text)
    ) {
      return true;
    }

    return false;
  }

  /**
   * Assesses whether a candidate fact is worthy of durable retention
   * or merely conversational noise / transient biological states.
   */
  public isMemoryWorthy(
    text: string,
    category?: MemoryCategory | string
  ): MemorySafetyDecision {
    const clean = text.trim();
    const lower = clean.toLowerCase();

    // 1. Minimum character length check
    if (clean.length < 3) {
      return {
        allowed: false,
        reason: 'not_worthy',
        category,
        details: 'Text is too short to represent a durable memory fact',
      };
    }

    // 2. Conversational fillers, acknowledgments, and greetings
    const noisePhrases = [
      'تمام',
      'شكرا',
      'شكراً',
      'أشكرك',
      'عفوا',
      'عفواً',
      'تسلم',
      'ألف شكر',
      'حبيبي',
      'thanks',
      'thank you',
      'ok',
      'okay',
      'sure',
      'yep',
      'cool',
      'great',
      'good',
      'fine',
      'alright',
      'هههه',
      'ههههه',
      'haha',
      'hahaha',
      'lol',
      'rofl',
      'صباح الخير',
      'مساء الخير',
      'أهلاً',
      'اهلاً',
      'مرحبا',
      'السلام عليكم',
      'وعليكم السلام',
      'إيه الأخبار',
      'ايه الاخبار',
      'كيف حالك',
      'شلونك',
      'ازيك',
      'عامل ايه',
      'hello',
      'hi',
      'hey',
      'how are you',
      'whats up',
      'what is up',
      'الجو حر النهارده',
      'الجو برد اليوم',
      'الدنيا بتشتي',
      'it is hot today',
      'it is cold today',
    ];

    if (
      noisePhrases.some((phrase) => {
        return (
          lower === phrase ||
          lower === phrase + '.' ||
          lower === phrase + '!' ||
          lower === phrase + '؟' ||
          lower === phrase + '?'
        );
      })
    ) {
      return {
        allowed: false,
        reason: 'not_worthy',
        category,
        details: 'Conversational filler, greeting, or polite pleasantry',
      };
    }

    // 3. Transient biological or physical fleeting states
    if (
      /(?:أنا|انا)\s+(?:الآن|دلوقتي|حالياً|حاسس اني)?\s*(?:جائع|جعان|عطشان|نعسان|تعبان)/i.test(
        text
      ) ||
      /(?:رايح|داخل)\s+(?:أنام|انام)/i.test(text) ||
      /\b(?:i\s*am|i'm)\s+(?:now\s+)?(?:hungry|thirsty|sleepy|tired)\b/i.test(text) ||
      /\bgoing\s+to\s+sleep\b/i.test(text)
    ) {
      return {
        allowed: false,
        reason: 'not_worthy',
        category,
        details: 'Transient physical/emotional state not worthy of long-term memory',
      };
    }

    return { allowed: true, reason: 'safe', category };
  }
}
