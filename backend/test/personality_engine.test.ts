import {
  PersonalityEngine,
  DEFAULT_CRAFT_PERSONALITY,
  PersonalityContext,
} from '../src/modules/personality';

describe('Phase 3.1: PersonalityEngine Core Tests', () => {
  let engine: PersonalityEngine;

  beforeEach(() => {
    engine = PersonalityEngine.getInstance();
  });

  describe('1. Default Baseline Craft Personality', () => {
    it('should return exact default baseline when called with no arguments', () => {
      const context = engine.resolve();

      expect(context).toBeDefined();
      expect(context.tone).toEqual(['warm', 'professional', 'direct']);
      expect(context.formality).toBe('consultative');
      expect(context.verbosity).toBe('balanced');
      expect(context.addressingStyle).toBe('none');
      expect(context.emojiPolicy).toBe('minimal');
      expect(context.humorLevel).toBe('none');
      expect(context.proactivity).toBe('direct_answer');
    });

    it('should return default baseline when called with empty options or empty preference object', () => {
      expect(engine.resolve({})).toBe(DEFAULT_CRAFT_PERSONALITY);
      expect(engine.resolve({ explicitPreference: {} })).toBe(DEFAULT_CRAFT_PERSONALITY);
      expect(engine.resolve('some text', {})).toBe(DEFAULT_CRAFT_PERSONALITY);
      expect(engine.resolve('some text', { explicitPreference: {} })).toBe(DEFAULT_CRAFT_PERSONALITY);
    });

    it('should expose getDefaultPersonality() matching DEFAULT_CRAFT_PERSONALITY', () => {
      const def = engine.getDefaultPersonality();
      expect(def).toBe(DEFAULT_CRAFT_PERSONALITY);
      expect(def.tone).toEqual(['warm', 'professional', 'direct']);
      expect(def.formality).toBe('consultative');
    });
  });

  describe('2. Explicit Preference Overrides', () => {
    it('should override verbosity to concise when explicitly requested', () => {
      const context = engine.resolve({
        explicitPreference: { verbosity: 'concise' },
      });

      expect(context.verbosity).toBe('concise');
      // All other fields remain defaults
      expect(context.tone).toEqual(['warm', 'professional', 'direct']);
      expect(context.formality).toBe('consultative');
      expect(context.addressingStyle).toBe('none');
      expect(context.emojiPolicy).toBe('minimal');
      expect(context.humorLevel).toBe('none');
      expect(context.proactivity).toBe('direct_answer');
    });

    it('should override verbosity to comprehensive when explicitly requested', () => {
      const context = engine.resolve({
        explicitPreference: { verbosity: 'comprehensive' },
      });

      expect(context.verbosity).toBe('comprehensive');
      expect(context.formality).toBe('consultative');
    });

    it('should override formality to formal when explicitly requested', () => {
      const context = engine.resolve({
        explicitPreference: { formality: 'formal' },
      });

      expect(context.formality).toBe('formal');
      expect(context.verbosity).toBe('balanced');
      expect(context.tone).toEqual(['warm', 'professional', 'direct']);
    });

    it('should override formality to casual when explicitly requested', () => {
      const context = engine.resolve({
        explicitPreference: { formality: 'casual' },
      });

      expect(context.formality).toBe('casual');
      expect(context.tone).toEqual(['warm', 'professional', 'direct']);
    });

    it('should override emojiPolicy to none when explicitly requested', () => {
      const context = engine.resolve({
        explicitPreference: { emojiPolicy: 'none' },
      });

      expect(context.emojiPolicy).toBe('none');
      expect(context.verbosity).toBe('balanced');
    });

    it('should override emojiPolicy to expressive when explicitly requested', () => {
      const context = engine.resolve({
        explicitPreference: { emojiPolicy: 'expressive' },
      });

      expect(context.emojiPolicy).toBe('expressive');
    });

    it('should override addressingStyle to respectful when explicitly requested', () => {
      const context = engine.resolve({
        explicitPreference: { addressingStyle: 'respectful' },
      });

      expect(context.addressingStyle).toBe('respectful');
      expect(context.formality).toBe('consultative');
    });

    it('should override addressingStyle to first_name when explicitly requested', () => {
      const context = engine.resolve({
        explicitPreference: { addressingStyle: 'first_name' },
      });

      expect(context.addressingStyle).toBe('first_name');
    });

    it('should override tone when single tone attribute is provided', () => {
      const context = engine.resolve({
        explicitPreference: { tone: 'empathetic' },
      });

      expect(context.tone).toEqual(['empathetic']);
      expect(context.formality).toBe('consultative');
    });

    it('should override tone when array of tone attributes is provided', () => {
      const context = engine.resolve({
        explicitPreference: { tone: ['warm', 'empathetic'] },
      });

      expect(context.tone).toEqual(['warm', 'empathetic']);
      expect(context.formality).toBe('consultative');
    });

    it('should override humorLevel to subtle when explicitly requested', () => {
      const context = engine.resolve({
        explicitPreference: { humorLevel: 'subtle' },
      });

      expect(context.humorLevel).toBe('subtle');
      expect(context.formality).toBe('consultative');
    });

    it('should override proactivity to suggest_next_step when explicitly requested', () => {
      const context = engine.resolve({
        explicitPreference: { proactivity: 'suggest_next_step' },
      });

      expect(context.proactivity).toBe('suggest_next_step');
    });
  });

  describe('3. Multiple Explicit Preferences Merging', () => {
    it('should merge multiple explicit preferences without mutating untouched defaults', () => {
      const context = engine.resolve({
        explicitPreference: {
          verbosity: 'concise',
          emojiPolicy: 'none',
        },
      });

      expect(context.verbosity).toBe('concise');
      expect(context.emojiPolicy).toBe('none');

      // Untouched fields strictly retain default Craft baseline
      expect(context.tone).toEqual(['warm', 'professional', 'direct']);
      expect(context.formality).toBe('consultative');
      expect(context.addressingStyle).toBe('none');
      expect(context.humorLevel).toBe('none');
      expect(context.proactivity).toBe('direct_answer');
    });

    it('should handle fully specified explicit preferences', () => {
      const context = engine.resolve({
        explicitPreference: {
          tone: ['empathetic', 'direct'],
          formality: 'formal',
          verbosity: 'comprehensive',
          addressingStyle: 'respectful',
          emojiPolicy: 'expressive',
          humorLevel: 'subtle',
          proactivity: 'suggest_next_step',
        },
      });

      expect(context.tone).toEqual(['empathetic', 'direct']);
      expect(context.formality).toBe('formal');
      expect(context.verbosity).toBe('comprehensive');
      expect(context.addressingStyle).toBe('respectful');
      expect(context.emojiPolicy).toBe('expressive');
      expect(context.humorLevel).toBe('subtle');
      expect(context.proactivity).toBe('suggest_next_step');
    });
  });

  describe('4. Strict Decoupling: No Heuristics or Language/Content Inference', () => {
    it('should NOT alter personality based on English input text', () => {
      const context = engine.resolve('Hello! Can you help me write some code today?');
      expect(context).toBe(DEFAULT_CRAFT_PERSONALITY);
      expect(context.addressingStyle).toBe('none');
      expect(context.formality).toBe('consultative');
      expect(context.verbosity).toBe('balanced');
    });

    it('should NOT alter personality based on Modern Standard Arabic input text', () => {
      const context = engine.resolve('السلام عليكم ورحمة الله وبركاته، ما هي حالة الطقس في القاهرة؟');
      expect(context).toBe(DEFAULT_CRAFT_PERSONALITY);
      expect(context.addressingStyle).toBe('none');
      expect(context.formality).toBe('consultative');
      expect(context.verbosity).toBe('balanced');
    });

    it('should NOT infer casual formality or slang addressing from Egyptian dialect input', () => {
      const context = engine.resolve('يا باشا لو سمحت والنبي قولي بكام الايفون دلوقتي يا غالي');
      expect(context).toBe(DEFAULT_CRAFT_PERSONALITY);
      // Even with "يا باشا" in user text, addressingStyle remains 'none'
      expect(context.addressingStyle).toBe('none');
      expect(context.formality).toBe('consultative');
      expect(context.verbosity).toBe('balanced');
    });

    it('should NOT infer casual formality from Gulf dialect input', () => {
      const context = engine.resolve('تكفى يا الغالي شنو أفضل لابتوب الحين؟');
      expect(context).toBe(DEFAULT_CRAFT_PERSONALITY);
      expect(context.addressingStyle).toBe('none');
      expect(context.formality).toBe('consultative');
    });

    it('should NOT alter personality based on French or other languages', () => {
      const context = engine.resolve("Bonjour ! Est-ce que vous pouvez m'aider s'il vous plaît ?");
      expect(context).toBe(DEFAULT_CRAFT_PERSONALITY);
    });

    it('should NOT infer concise verbosity from short messages', () => {
      const shortMessages = ['ok', 'yes', 'تمام', 'أه', 'no', 'شكرا', 'hi'];
      for (const msg of shortMessages) {
        const context = engine.resolve(msg);
        expect(context.verbosity).toBe('balanced');
      }
    });

    it('should NOT infer expressive emojiPolicy from user messages containing emojis', () => {
      const emojiMessages = [
        'شكراً جزيلاً! 😍🚀✨',
        'ممكن تساعدني؟ 🙏🙏🙏',
        'صباح الفل 🌸🌺🌷',
        '🔥🔥🔥',
      ];
      for (const msg of emojiMessages) {
        const context = engine.resolve(msg);
        expect(context.emojiPolicy).toBe('minimal');
      }
    });

    it('should NOT infer tone or proactivity from hurried user phrases', () => {
      const hurriedMessages = ['بسرعة بسرعة', 'urgent', 'مستعجل جداً'];
      for (const msg of hurriedMessages) {
        const context = engine.resolve(msg);
        expect(context.tone).toEqual(['warm', 'professional', 'direct']);
        expect(context.proactivity).toBe('direct_answer');
      }
    });
  });

  describe('5. Determinism & Stability', () => {
    it('should produce identical results over 100 consecutive invocations without explicit preferences', () => {
      const first = engine.resolve();
      for (let i = 0; i < 100; i++) {
        const current = engine.resolve();
        expect(current).toBe(first);
      }
    });

    it('should produce identical results over 100 consecutive invocations with explicit preferences', () => {
      const options = { explicitPreference: { verbosity: 'concise' as const, emojiPolicy: 'none' as const } };
      const expected = engine.resolve(options);

      for (let i = 0; i < 100; i++) {
        const current = engine.resolve(options);
        expect(current).toEqual(expected);
      }
    });
  });

  describe('6. Immutability & Safety', () => {
    it('should return frozen objects preventing caller mutation', () => {
      const context = engine.resolve();
      expect(Object.isFrozen(context)).toBe(true);
      expect(Object.isFrozen(context.tone)).toBe(true);

      // Attempting mutation in strict mode should throw
      expect(() => {
        (context as any).formality = 'casual';
      }).toThrow();

      expect(() => {
        (context.tone as any).push('empathetic');
      }).toThrow();
    });

    it('should return frozen objects when explicit preferences are applied', () => {
      const context = engine.resolve({
        explicitPreference: {
          verbosity: 'concise',
          tone: ['empathetic'],
        },
      });

      expect(Object.isFrozen(context)).toBe(true);
      expect(Object.isFrozen(context.tone)).toBe(true);

      expect(() => {
        (context as any).verbosity = 'comprehensive';
      }).toThrow();

      expect(() => {
        (context.tone as any).push('warm');
      }).toThrow();
    });

    it('should not allow external array mutation to affect resolved context', () => {
      const externalToneArray = ['empathetic'] as any;
      const context = engine.resolve({
        explicitPreference: { tone: externalToneArray },
      });

      externalToneArray.push('casual');
      expect(context.tone).toEqual(['empathetic']);
    });
  });
});
