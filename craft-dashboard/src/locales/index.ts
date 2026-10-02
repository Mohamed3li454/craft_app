import { en } from './en';
import { ar } from './ar';
import { TranslationSchema } from './types';

export type Language = 'en' | 'ar';
export type Direction = 'ltr' | 'rtl';

export const dictionaries: Record<Language, TranslationSchema> = {
  en,
  ar,
};

export { en, ar };
export * from './types';
