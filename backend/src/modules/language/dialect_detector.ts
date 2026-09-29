import { ArabicDialect, DialectSignal } from './types';

/**
 * Normalizes Arabic text for dialect marker matching:
 * - strips tashkeel diacritics and tatweel
 * - normalizes alef variants (أ, إ, آ -> ا)
 * - normalizes taa marbouta (ة -> ه)
 * - normalizes alef maqsoura (ى -> ي)
 * - collapses punctuation and whitespace
 */
function normalizeForDialect(text: string): string {
  if (!text) return '';
  return text
    .toLowerCase()
    .replace(/[\u064B-\u065F\u0670]/g, '') // tashkeel
    .replace(/\u0640/g, '')               // tatweel
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/[.,/#!$%^&*;:{}=\-_`~()?"'؟،!«»]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

interface DialectRule {
  weight: number;
  tag: string;
  pattern: RegExp | string; // string token or boundary-safe regex
}

// 1. Egyptian Arabic Rules
const EGYPTIAN_RULES: DialectRule[] = [
  // High-confidence composite phrases (weight 2.5)
  { pattern: 'بص كده', weight: 2.5, tag: 'eg_phrase_buss_keda' },
  { pattern: 'بص فهمني', weight: 2.5, tag: 'eg_phrase_buss_fahemny' },
  { pattern: 'عايز اعرف', weight: 2.5, tag: 'eg_phrase_aayez_aaaraf' },
  { pattern: 'عاوز اعرف', weight: 2.5, tag: 'eg_phrase_aawez_aaaraf' },
  { pattern: 'فهمني دي', weight: 2.5, tag: 'eg_phrase_fahemny_di' },
  { pattern: 'يعني ايه', weight: 2.0, tag: 'eg_phrase_yaani_eh' },
  { pattern: 'ايه ده', weight: 2.0, tag: 'eg_phrase_eh_dah' },
  { pattern: 'مش كده', weight: 2.0, tag: 'eg_phrase_mosh_keda' },
  { pattern: 'مش فاهم', weight: 2.0, tag: 'eg_phrase_mosh_fahem' },
  { pattern: 'مش عارف', weight: 2.0, tag: 'eg_phrase_mosh_aaref' },
  { pattern: 'عامل ايه', weight: 2.0, tag: 'eg_phrase_aamel_eh' },
  { pattern: 'عاملين ايه', weight: 2.0, tag: 'eg_phrase_aamleen_eh' },
  { pattern: 'ولا يهمك', weight: 2.0, tag: 'eg_phrase_wala_yhemmak' },
  { pattern: 'زي الفل', weight: 2.0, tag: 'eg_phrase_zay_elfol' },
  { pattern: 'كويس كده', weight: 2.0, tag: 'eg_phrase_kwayes_keda' },
  { pattern: 'يا باشا', weight: 2.0, tag: 'eg_phrase_ya_basha' },
  { pattern: 'يا هندسه', weight: 2.0, tag: 'eg_phrase_ya_handasa' },
  { pattern: 'يا عم', weight: 1.5, tag: 'eg_phrase_ya_amm' },

  // Distinct Egyptian lexical markers (weight 1.2 - 2.0)
  { pattern: 'بص', weight: 1.5, tag: 'eg_lex_buss' },
  { pattern: 'عايز', weight: 1.5, tag: 'eg_lex_aayez' },
  { pattern: 'عاوز', weight: 1.5, tag: 'eg_lex_aawez' },
  { pattern: 'دلوقتي', weight: 2.0, tag: 'eg_lex_delwaqty' },
  { pattern: 'كده', weight: 1.5, tag: 'eg_lex_keda' },
  { pattern: 'مفيش', weight: 2.0, tag: 'eg_lex_mafeesh' },
  { pattern: 'ازاي', weight: 2.0, tag: 'eg_lex_ezzay' },
  { pattern: 'لسه', weight: 1.5, tag: 'eg_lex_lessa' },
  { pattern: 'علشان', weight: 1.5, tag: 'eg_lex_aashan' },
  { pattern: 'عشان', weight: 1.5, tag: 'eg_lex_aashan' },
  { pattern: 'معلش', weight: 2.0, tag: 'eg_lex_maaalesh' },
  { pattern: 'بتاع', weight: 1.5, tag: 'eg_lex_betaa' },
  { pattern: 'بتاعه', weight: 1.5, tag: 'eg_lex_betaaa' },
  { pattern: 'بتاعت', weight: 1.5, tag: 'eg_lex_betaat' },
  { pattern: 'برضه', weight: 1.5, tag: 'eg_lex_bardo' },
  { pattern: 'بردو', weight: 1.5, tag: 'eg_lex_bardo' },
  { pattern: 'خالص', weight: 1.2, tag: 'eg_lex_khales' },
  { pattern: 'النهارده', weight: 1.5, tag: 'eg_lex_enaharda' },
  { pattern: 'انهارده', weight: 1.5, tag: 'eg_lex_enaharda' },
  { pattern: 'فكرني', weight: 1.5, tag: 'eg_lex_fakarny' },
  { pattern: 'شويه', weight: 1.0, tag: 'eg_lex_shewaya' },
  { pattern: 'دول', weight: 1.0, tag: 'eg_lex_dool' },
  { pattern: 'فينك', weight: 1.2, tag: 'eg_lex_feenak' },
  { pattern: 'حاجه', weight: 0.8, tag: 'eg_lex_haga' },

  // Conversational follow-ups and Egyptian imperative/comparative markers (weight 1.5 - 2.5)
  { pattern: 'قارنلي', weight: 2.0, tag: 'eg_followup_qarenly' },
  { pattern: 'وريني', weight: 2.0, tag: 'eg_followup_wareeny' },
  { pattern: 'هاتلي', weight: 2.0, tag: 'eg_followup_hatly' },
  { pattern: 'قولي', weight: 1.5, tag: 'eg_followup_ouly' },
  { pattern: 'اختصرهولي', weight: 2.5, tag: 'eg_followup_ekhtaserhouly' },
  { pattern: 'لخصهولي', weight: 2.5, tag: 'eg_followup_lakhashouly' },
  { pattern: 'فهمهالي', weight: 2.5, tag: 'eg_followup_fahemhaly' },
  { pattern: 'اشرحهالي', weight: 2.5, tag: 'eg_followup_eshrahhaly' },
  { pattern: 'اعملها', weight: 1.5, tag: 'eg_followup_eaamelha' },
  { pattern: 'اعمليها', weight: 1.5, tag: 'eg_followup_eaameliha' },
  { pattern: 'كملها', weight: 1.5, tag: 'eg_followup_kamelha' },
  { pattern: 'خليها', weight: 1.5, tag: 'eg_followup_khaleeha' },
  { pattern: 'خليلي', weight: 1.5, tag: 'eg_followup_khaleely' },
  { pattern: 'ممكن كده', weight: 2.0, tag: 'eg_phrase_momken_keda' },
  { pattern: 'طيب كده', weight: 2.0, tag: 'eg_phrase_tayeb_keda' },
  { pattern: 'ايه رايك', weight: 2.0, tag: 'eg_phrase_eh_raayak' },
  { pattern: 'ايه الفرق', weight: 2.0, tag: 'eg_phrase_eh_elfarq' },
  { pattern: 'انهي', weight: 1.5, tag: 'eg_lex_anhy' },
  { pattern: 'بتفرق', weight: 1.5, tag: 'eg_morph_betefreq' },
  { pattern: 'ينفع', weight: 1.5, tag: 'eg_lex_yenfaa' },
  { pattern: 'فاهمني', weight: 1.5, tag: 'eg_lex_fahemny' },

  // Morphological future prefix هـ (e.g. هعمل, هنشوف, هروح)
  { pattern: /(?:^|\s)ه(?:عمل|نعمل|شوف|نشوف|روح|نروح|قول|نقول|كتب|نكتب|فهم|نفهم|بعت|نبعت)(?:\s|$)/, weight: 2.0, tag: 'eg_morph_future_ha' },

  // Morphological progressive prefix بـ (e.g. بيعمل, بنعمل, بيقول)
  { pattern: /(?:^|\s)(?:بيعمل|بنعمل|بيقول|بنقول|بيشوف|بنشوف)(?:\s|$)/, weight: 1.5, tag: 'eg_morph_prog_be' },

  // Negation pattern مـ...ـش (e.g. مبيعملش, معنديش, ماعرفش, معرفش)
  { pattern: /(?:^|\s)(?:مبيعملش|معنديش|ماعرفش|معرفش|مشوفتش|مقلتش)(?:\s|$)/, weight: 2.5, tag: 'eg_morph_neg_sheen' },
];

// 2. Gulf Arabic Rules
const GULF_RULES: DialectRule[] = [
  { pattern: 'شلونك', weight: 2.0, tag: 'gulf_lex_shlonak' },
  { pattern: 'شلونكم', weight: 2.0, tag: 'gulf_lex_shlonkom' },
  { pattern: 'وشلونك', weight: 2.0, tag: 'gulf_lex_wesh_lonak' },
  { pattern: 'ايش فيك', weight: 2.0, tag: 'gulf_phrase_aysh_feek' },
  { pattern: 'وش فيك', weight: 2.0, tag: 'gulf_phrase_wesh_feek' },
  { pattern: 'وينك', weight: 1.5, tag: 'gulf_lex_waynak' },
  { pattern: 'ابي', weight: 1.5, tag: 'gulf_lex_aby' },
  { pattern: 'ابغي', weight: 1.5, tag: 'gulf_lex_abgha' },
  { pattern: 'ابغى', weight: 1.5, tag: 'gulf_lex_abgha' },
  { pattern: 'شنو', weight: 1.5, tag: 'gulf_lex_sheno' },
  { pattern: 'وايد', weight: 2.0, tag: 'gulf_lex_wayed' },
  { pattern: 'الحين', weight: 2.0, tag: 'gulf_lex_alheen' },
  { pattern: 'تكفي', weight: 1.5, tag: 'gulf_lex_takfa' },
  { pattern: 'تكفى', weight: 1.5, tag: 'gulf_lex_takfa' },
  { pattern: 'عساك بخير', weight: 2.5, tag: 'gulf_phrase_asaak_bekhair' },
  { pattern: 'يا الغالي', weight: 1.5, tag: 'gulf_phrase_ya_alghali' },
  { pattern: 'شصار', weight: 2.0, tag: 'gulf_lex_shesar' },
  { pattern: 'وش صار', weight: 2.0, tag: 'gulf_phrase_wesh_sar' },
];

// 3. Levantine Arabic Rules
const LEVANTINE_RULES: DialectRule[] = [
  { pattern: 'كيفك', weight: 2.0, tag: 'lev_lex_keefak' },
  { pattern: 'كيفكن', weight: 2.0, tag: 'lev_lex_keefkon' },
  { pattern: 'شو في', weight: 2.0, tag: 'lev_phrase_sho_fee' },
  { pattern: 'شو الاخبار', weight: 2.0, tag: 'lev_phrase_sho_akhbar' },
  { pattern: 'شو اخبارك', weight: 2.0, tag: 'lev_phrase_sho_akhbarak' },
  { pattern: 'شو بدك', weight: 2.5, tag: 'lev_phrase_sho_beddak' },
  { pattern: 'بدي', weight: 2.0, tag: 'lev_lex_beddi' },
  { pattern: 'هيك', weight: 2.0, tag: 'lev_lex_heik' },
  { pattern: 'هلق', weight: 2.0, tag: 'lev_lex_hallaq' },
  { pattern: 'منيح', weight: 2.0, tag: 'lev_lex_mneeh' },
  { pattern: 'منيحه', weight: 2.0, tag: 'lev_lex_mneeha' },
  { pattern: 'كتير', weight: 2.0, tag: 'lev_lex_kteer' },
  { pattern: 'عم احكي', weight: 2.0, tag: 'lev_phrase_aam_ehki' },
  { pattern: 'يا زلمه', weight: 2.5, tag: 'lev_phrase_ya_zalameh' },
  { pattern: 'هاد', weight: 1.5, tag: 'lev_lex_had' },
  { pattern: 'هيدا', weight: 1.5, tag: 'lev_lex_haida' },
  { pattern: 'هيدي', weight: 1.5, tag: 'lev_lex_haidi' },
];

// 4. Maghrebi Arabic Rules
const MAGHREBI_RULES: DialectRule[] = [
  { pattern: 'واش راك', weight: 2.5, tag: 'magh_phrase_wash_rak' },
  { pattern: 'واش', weight: 1.5, tag: 'magh_lex_wash' },
  { pattern: 'لاباس', weight: 2.0, tag: 'magh_lex_labas' },
  { pattern: 'بزاف', weight: 2.5, tag: 'magh_lex_bzaf' },
  { pattern: 'دابا', weight: 2.5, tag: 'magh_lex_daba' },
  { pattern: 'برشا', weight: 2.5, tag: 'magh_lex_barcha' },
  { pattern: 'شنو كاين', weight: 2.5, tag: 'magh_phrase_sno_kayen' },
  { pattern: 'مزيان', weight: 2.0, tag: 'magh_lex_mzyan' },
  { pattern: 'صافي', weight: 1.5, tag: 'magh_lex_safi' },
  { pattern: 'علاش', weight: 2.0, tag: 'magh_lex_aalesh' },
  { pattern: 'ديال', weight: 2.0, tag: 'magh_lex_dyal' },
];

// 5. Iraqi Arabic Rules
const IRAQI_RULES: DialectRule[] = [
  { pattern: 'شكو ماكو', weight: 3.0, tag: 'irq_phrase_shako_mako' },
  { pattern: 'خوش', weight: 2.0, tag: 'irq_lex_khosh' },
  { pattern: 'هسه', weight: 2.0, tag: 'irq_lex_hassa' },
  { pattern: 'فد شي', weight: 2.5, tag: 'irq_phrase_fad_shi' },
  { pattern: 'دكول', weight: 2.0, tag: 'irq_lex_dgool' },
  { pattern: 'هواي', weight: 2.0, tag: 'irq_lex_hway' },
  { pattern: 'شبيك', weight: 2.0, tag: 'irq_lex_shbeek' },
];

// 6. Sudanese Arabic Rules
const SUDANESE_RULES: DialectRule[] = [
  { pattern: 'كيفنك', weight: 2.5, tag: 'sud_lex_keefanak' },
  { pattern: 'يا زول', weight: 2.5, tag: 'sud_phrase_ya_zool' },
  { pattern: 'زول', weight: 2.0, tag: 'sud_lex_zool' },
  { pattern: 'داير', weight: 1.8, tag: 'sud_lex_dayer' },
  { pattern: 'هسع', weight: 2.0, tag: 'sud_lex_hasa' },
  { pattern: 'شديد', weight: 1.2, tag: 'sud_lex_shadeed' },
];

// 7. Modern Standard Arabic (MSA) Rules
const MSA_RULES: DialectRule[] = [
  { pattern: 'لماذا', weight: 1.5, tag: 'msa_lex_limatha' },
  { pattern: 'كيف حالك', weight: 2.0, tag: 'msa_phrase_kayfa_haluk' },
  { pattern: 'هل يمكنك', weight: 1.5, tag: 'msa_phrase_hal_yomkinuk' },
  { pattern: 'اريد ان', weight: 1.5, tag: 'msa_phrase_ureed_an' },
  { pattern: 'سوف', weight: 1.5, tag: 'msa_lex_sawfa' },
  { pattern: 'بالتاكيد', weight: 1.2, tag: 'msa_lex_bittaakeed' },
  { pattern: 'في الواقع', weight: 1.5, tag: 'msa_phrase_fil_waqea' },
  { pattern: 'فيما يتعلق', weight: 1.5, tag: 'msa_phrase_feema_yataalaq' },
  { pattern: 'برجاء', weight: 1.2, tag: 'msa_lex_borjaa' },
  { pattern: 'يرجى', weight: 1.2, tag: 'msa_lex_yorjaa' },
  { pattern: 'علاوه علي ذلك', weight: 2.0, tag: 'msa_phrase_elawa_ala_zalek' },
];

export class DialectDetector {
  /**
   * Evaluates linguistic markers on the text to determine Arabic dialect,
   * confidence score, confidence bucket, and privacy-safe evidence tags.
   * 
   * Strict Safety Rule: Dialect is NEVER inferred from user metadata (name, phone,
   * nationality, or location). It is strictly derived from the message tokens.
   */
  public static detect(text: string): DialectSignal {
    if (!text || !text.trim()) {
      return {
        dialect: 'unknown',
        confidence: 0,
        confidenceBucket: 'low',
        evidenceTags: [],
      };
    }

    const normalized = normalizeForDialect(text);
    if (!normalized) {
      return {
        dialect: 'unknown',
        confidence: 0,
        confidenceBucket: 'low',
        evidenceTags: [],
      };
    }

    // Check if text has Arabic alphabetic characters
    const hasArabicChars = /[\u0600-\u06FF]/.test(text);
    if (!hasArabicChars) {
      return {
        dialect: 'unknown',
        confidence: 0,
        confidenceBucket: 'low',
        evidenceTags: [],
      };
    }

    const padded = ` ${normalized} `;

    // Evaluate each dialect cluster
    const candidates: Array<{
      dialect: ArabicDialect;
      score: number;
      tags: string[];
    }> = [
      this.evaluateRules('egyptian', EGYPTIAN_RULES, normalized, padded),
      this.evaluateRules('gulf', GULF_RULES, normalized, padded),
      this.evaluateRules('levantine', LEVANTINE_RULES, normalized, padded),
      this.evaluateRules('maghrebi', MAGHREBI_RULES, normalized, padded),
      this.evaluateRules('iraqi', IRAQI_RULES, normalized, padded),
      this.evaluateRules('sudanese', SUDANESE_RULES, normalized, padded),
      this.evaluateRules('msa', MSA_RULES, normalized, padded),
    ];

    // Sort by highest score
    candidates.sort((a, b) => b.score - a.score);
    const best = candidates[0];

    // If no dialect rules matched at all
    if (best.score === 0) {
      return {
        dialect: 'unknown',
        confidence: 0.30,
        confidenceBucket: 'low',
        evidenceTags: [],
      };
    }

    // Calculate confidence based on score and relative margin
    let confidence: number;
    let confidenceBucket: 'high' | 'medium' | 'low';

    // Check score threshold
    if (best.score >= 2.0) {
      // Strong evidence: >= 2.0 points (e.g. 2 markers or 1 composite phrase)
      confidence = Math.min(0.95, 0.75 + (best.score - 2.0) * 0.05);
      confidenceBucket = 'high';
    } else if (best.score >= 1.0) {
      // Moderate evidence: single marker (1.0 to 1.9 points)
      confidence = 0.65;
      confidenceBucket = 'medium';
    } else {
      // Weak evidence (< 1.0 point)
      confidence = 0.45;
      confidenceBucket = 'low';
    }

    // Threshold mapping per requirements:
    // confidence >= 0.75 -> adaptation allowed
    // 0.50 - 0.74 -> soft adaptation
    // < 0.50 -> neutral Arabic / unknown
    if (confidence < 0.50) {
      return {
        dialect: 'unknown',
        confidence: Number(confidence.toFixed(2)),
        confidenceBucket: 'low',
        evidenceTags: best.tags,
      };
    }

    return {
      dialect: best.dialect,
      confidence: Number(confidence.toFixed(2)),
      confidenceBucket,
      evidenceTags: best.tags,
    };
  }

  private static evaluateRules(
    dialect: ArabicDialect,
    rules: DialectRule[],
    normalized: string,
    padded: string
  ): { dialect: ArabicDialect; score: number; tags: string[] } {
    let score = 0;
    const tags: string[] = [];

    for (const rule of rules) {
      let matched = false;
      if (typeof rule.pattern === 'string') {
        if (padded.includes(` ${rule.pattern} `)) {
          matched = true;
        }
      } else {
        if (rule.pattern.test(padded) || rule.pattern.test(normalized)) {
          matched = true;
        }
      }

      if (matched) {
        score += rule.weight;
        tags.push(rule.tag);
      }
    }

    return { dialect, score, tags };
  }
}
