import {
  MemoryCategory,
  MemorySource,
  isValidConfidence,
  MemoryImportance,
  LanguagePreference,
  PersonalityPreference,
  MemoryItem,
} from '../src/modules/memory/types';
import { MemoryItemEntity } from '../src/database/repositories/types';

describe('Phase 4.2: Memory Data Model & Types', () => {
  describe('MemoryCategory taxonomy', () => {
    it('supports all core typed categories', () => {
      const coreCategories: MemoryCategory[] = [
        'identity',
        'preference',
        'language_preference',
        'personality_preference',
        'technical_context',
        'stable_fact',
        'ephemeral_context',
      ];
      expect(coreCategories.length).toBe(7);
      expect(coreCategories).toContain('identity');
      expect(coreCategories).toContain('language_preference');
      expect(coreCategories).toContain('personality_preference');
      expect(coreCategories).toContain('technical_context');
      expect(coreCategories).toContain('stable_fact');
      expect(coreCategories).toContain('ephemeral_context');
    });

    it('maintains backward compatibility with legacy categories', () => {
      const legacyCategories: MemoryCategory[] = [
        'general',
        'profession',
        'interests',
      ];
      expect(legacyCategories.length).toBe(3);
      expect(legacyCategories).toContain('general');
      expect(legacyCategories).toContain('profession');
      expect(legacyCategories).toContain('interests');
    });
  });

  describe('MemorySource origin tracking', () => {
    it('supports all valid origin sources', () => {
      const sources: MemorySource[] = [
        'user_explicit',
        'agent_tool',
        'automatic_extraction',
        'system_derived',
      ];
      expect(sources).toContain('user_explicit');
      expect(sources).toContain('agent_tool');
      expect(sources).toContain('automatic_extraction');
      expect(sources).toContain('system_derived');
    });
  });

  describe('Confidence contract (0.0 to 1.0)', () => {
    it('validates scores within [0.0, 1.0]', () => {
      expect(isValidConfidence(0.0)).toBe(true);
      expect(isValidConfidence(0.5)).toBe(true);
      expect(isValidConfidence(1.0)).toBe(true);
      expect(isValidConfidence(0.75)).toBe(true);
    });

    it('rejects scores outside [0.0, 1.0] and invalid numbers', () => {
      expect(isValidConfidence(-0.01)).toBe(false);
      expect(isValidConfidence(1.01)).toBe(false);
      expect(isValidConfidence(NaN)).toBe(false);
      expect(isValidConfidence(Infinity)).toBe(false);
      expect(isValidConfidence('0.5' as any)).toBe(false);
    });
  });

  describe('MemoryImportance levels', () => {
    it('supports all importance levels', () => {
      const levels: MemoryImportance[] = ['low', 'normal', 'high', 'critical'];
      expect(levels).toEqual(['low', 'normal', 'high', 'critical']);
    });
  });

  describe('Temporal validity & Ephemeral vs Permanent facts', () => {
    it('represents permanent memory with undefined/null validUntil', () => {
      const permanentItem: MemoryItem = {
        id: 'mem-1',
        userId: 'user-1',
        factText: 'المستخدم يعمل كمهندس برمجيات',
        category: 'stable_fact',
        source: 'user_explicit',
        confidence: 1.0,
        importance: 'high',
        validUntil: null,
        createdAt: new Date('2026-09-01T00:00:00Z'),
        updatedAt: new Date('2026-09-01T00:00:00Z'),
      };
      expect(permanentItem.validUntil).toBeNull();
      expect(permanentItem.createdAt).toBeInstanceOf(Date);
      expect(permanentItem.updatedAt).toBeInstanceOf(Date);
    });

    it('represents ephemeral memory with future expiration date', () => {
      const expiresAt = new Date('2026-10-01T00:00:00Z');
      const ephemeralItem: MemoryItem = {
        id: 'mem-2',
        userId: 'user-1',
        factText: 'المستخدم مسافر إلى الإسكندرية هذا الأسبوع',
        category: 'ephemeral_context',
        source: 'agent_tool',
        confidence: 0.9,
        importance: 'normal',
        validUntil: expiresAt,
        createdAt: new Date('2026-09-26T00:00:00Z'),
        updatedAt: new Date('2026-09-26T00:00:00Z'),
      };
      expect(ephemeralItem.validUntil).toEqual(expiresAt);
      expect(ephemeralItem.category).toBe('ephemeral_context');
    });
  });

  describe('Structured Preferences Separation', () => {
    it('creates pure LanguagePreference without personality traits', () => {
      const langPref: LanguagePreference = {
        language: 'ar',
        dialect: 'egyptian',
        script: 'arabic',
        confidence: 0.95,
        updatedAt: new Date(),
      };

      expect(langPref.language).toBe('ar');
      expect(langPref.dialect).toBe('egyptian');
      expect((langPref as any).tone).toBeUndefined();
      expect((langPref as any).formality).toBeUndefined();
    });

    it('creates pure PersonalityPreference without language or dialect', () => {
      const persPref: PersonalityPreference = {
        tone: ['warm', 'professional', 'direct'],
        formality: 'consultative',
        verbosity: 'balanced',
        addressingStyle: 'none',
        emojiPolicy: 'minimal',
        confidence: 0.9,
        updatedAt: new Date(),
      };

      expect(persPref.formality).toBe('consultative');
      expect(persPref.tone).toContain('warm');
      expect((persPref as any).language).toBeUndefined();
      expect((persPref as any).dialect).toBeUndefined();
    });
  });

  describe('MemoryItemEntity backward compatibility', () => {
    it('accepts legacy entity format with only id, userId, factText, category, createdAt', () => {
      const legacy: MemoryItemEntity = {
        id: 'legacy-1',
        userId: 'u-1',
        factText: 'User lives in Cairo',
        category: 'general',
        createdAt: new Date(),
      };

      expect(legacy.id).toBe('legacy-1');
      expect(legacy.category).toBe('general');
      expect(legacy.source).toBeUndefined();
      expect(legacy.confidence).toBeUndefined();
    });

    it('accepts enhanced entity format with new optional fields', () => {
      const enhanced: MemoryItemEntity = {
        id: 'enh-1',
        userId: 'u-2',
        factText: 'اسم المستخدم: يوسف',
        category: 'identity',
        source: 'automatic_extraction',
        confidence: 0.85,
        importance: 'high',
        validUntil: null,
        metadata: { channel: 'whatsapp', verified: true },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      expect(enhanced.category).toBe('identity');
      expect(enhanced.source).toBe('automatic_extraction');
      expect(enhanced.confidence).toBe(0.85);
      expect(enhanced.importance).toBe('high');
      expect(enhanced.metadata?.channel).toBe('whatsapp');
    });
  });
});
