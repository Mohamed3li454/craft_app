/**
 * Topic Tracker & Switch Detector (Phase 5)
 *
 * Deterministically tracks active conversational topics, identifies technical entities,
 * and accurately detects explicit and implicit topic shifts.
 */

import { TopicRecord } from './types';

export interface TopicDetectionResult {
  readonly activeTopic: string | null;
  readonly isTopicSwitch: boolean;
  readonly previousTopic: string | null;
  readonly topicHistory: readonly TopicRecord[];
  readonly sessionEntities: readonly string[];
}

function normalize(text: string): string {
  if (!text) return '';
  return text
    .toLowerCase()
    .replace(/[\u064B-\u065F\u0670]/g, '')
    .replace(/\u0640/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .trim();
}

export class TopicTracker {
  private static readonly EXPLICIT_SWITCH_PATTERNS = [
    /بالمناسبه/i,
    /سؤال\s+تاني/i,
    /سؤال\s+اخر/i,
    /موضوع\s+تاني/i,
    /موضوع\s+جديد/i,
    /حاجه\s+تانيه/i,
    /على\s+جنب\s+كده/i,
    /بعيدا\s+عن\s+ده/i,
    /\bby\s+the\s+way\b/i,
    /\bon\s+another\s+note\b/i,
    /\bdifferent\s+topic\b/i,
    /\bunrelated\b/i,
    /\bchanging\s+the\s+subject\b/i,
    /\bnew\s+question\b/i,
  ];

  private static readonly KNOWN_ENTITIES: Record<string, { label: string; domain: 'technical' | 'general' | 'transactional' }> = {
    // Mobile & Frontend
    flutter: { label: 'Flutter', domain: 'technical' },
    dart: { label: 'Dart', domain: 'technical' },
    react: { label: 'React', domain: 'technical' },
    'react native': { label: 'React Native', domain: 'technical' },
    vue: { label: 'Vue.js', domain: 'technical' },
    angular: { label: 'Angular', domain: 'technical' },
    nextjs: { label: 'Next.js', domain: 'technical' },
    // Backend & Languages
    python: { label: 'Python', domain: 'technical' },
    fastapi: { label: 'FastAPI', domain: 'technical' },
    django: { label: 'Django', domain: 'technical' },
    nodejs: { label: 'Node.js', domain: 'technical' },
    express: { label: 'Express', domain: 'technical' },
    nestjs: { label: 'NestJS', domain: 'technical' },
    golang: { label: 'Go (Golang)', domain: 'technical' },
    go: { label: 'Go (Golang)', domain: 'technical' },
    java: { label: 'Java', domain: 'technical' },
    spring: { label: 'Spring Boot', domain: 'technical' },
    dotnet: { label: '.NET / C#', domain: 'technical' },
    csharp: { label: 'C#', domain: 'technical' },
    rust: { label: 'Rust', domain: 'technical' },
    // Databases & Cache
    database: { label: 'Databases', domain: 'technical' },
    databases: { label: 'Databases', domain: 'technical' },
    sql: { label: 'Databases', domain: 'technical' },
    nosql: { label: 'Databases', domain: 'technical' },
    postgres: { label: 'PostgreSQL', domain: 'technical' },
    postgresql: { label: 'PostgreSQL', domain: 'technical' },
    mysql: { label: 'MySQL', domain: 'technical' },
    sqlite: { label: 'SQLite', domain: 'technical' },
    mongodb: { label: 'MongoDB', domain: 'technical' },
    redis: { label: 'Redis', domain: 'technical' },
    prisma: { label: 'Prisma', domain: 'technical' },
    caching: { label: 'Caching', domain: 'technical' },
    cache: { label: 'Caching', domain: 'technical' },
    sharding: { label: 'Database Sharding', domain: 'technical' },
    // Architecture & Concepts
    architecture: { label: 'Software Architecture', domain: 'technical' },
    'state management': { label: 'State Management', domain: 'technical' },
    bloc: { label: 'BLoC Pattern', domain: 'technical' },
    provider: { label: 'Provider Pattern', domain: 'technical' },
    webhook: { label: 'Webhooks', domain: 'technical' },
    webhooks: { label: 'Webhooks', domain: 'technical' },
    websocket: { label: 'WebSockets', domain: 'technical' },
    docker: { label: 'Docker', domain: 'technical' },
    kubernetes: { label: 'Kubernetes', domain: 'technical' },
    auth: { label: 'Authentication & Security', domain: 'technical' },
    jwt: { label: 'JWT Authentication', domain: 'technical' },
    encryption: { label: 'Cryptography & Encryption', domain: 'technical' },
    // General & Transactional
    weather: { label: 'Weather Forecast', domain: 'transactional' },
    reminder: { label: 'Reminders & Tasks', domain: 'transactional' },
    task: { label: 'Reminders & Tasks', domain: 'transactional' },
    price: { label: 'Product Pricing', domain: 'general' },
    pricing: { label: 'Product Pricing', domain: 'general' },
    iphone: { label: 'Product Pricing', domain: 'general' },
    cooking: { label: 'Cooking & Recipes', domain: 'general' },
    food: { label: 'Cooking & Recipes', domain: 'general' },
  };

  /**
   * Tracks and resolves the active topic across turns.
   */
  public static trackTopic(
    query: string,
    existingTopicHistory: readonly TopicRecord[] = [],
    previousActiveTopic: string | null = null,
    turnIndex = 0,
    isCasualQuery = false
  ): TopicDetectionResult {
    const norm = normalize(query);
    const explicitSwitch = this.EXPLICIT_SWITCH_PATTERNS.some((p) => p.test(norm));
    const extractedEntity = this.extractPrimaryEntity(norm);

    let activeTopic = previousActiveTopic;
    let isTopicSwitch = false;
    let previousTopic = previousActiveTopic;

    if (explicitSwitch) {
      isTopicSwitch = true;
      if (extractedEntity) {
        activeTopic = extractedEntity.label;
      } else {
        activeTopic = this.deriveGenericTopic(query) || 'General Inquiry';
      }
    } else if (extractedEntity) {
      if (previousActiveTopic && previousActiveTopic !== extractedEntity.label) {
        const hasContinuationSignal = this.hasContinuationSignals(norm);
        if (!hasContinuationSignal) {
          isTopicSwitch = true;
          activeTopic = extractedEntity.label;
        }
      } else if (!previousActiveTopic) {
        activeTopic = extractedEntity.label;
      }
    } else if (!previousActiveTopic && !isCasualQuery) {
      activeTopic = this.deriveGenericTopic(query);
    }

    // Build updated topic history (avoid recording casual greetings)
    const topicHistory = [...existingTopicHistory];
    if (activeTopic && !isCasualQuery) {
      const existingIdx = topicHistory.findIndex((t) => t.topic.toLowerCase() === activeTopic!.toLowerCase());
      const domain = extractedEntity ? extractedEntity.domain : 'general';
      if (existingIdx >= 0) {
        const item = topicHistory[existingIdx];
        topicHistory[existingIdx] = {
          ...item,
          lastSeenAtTurnIndex: turnIndex,
        };
      } else {
        topicHistory.push({
          topic: activeTopic,
          domain,
          startedAtTurnIndex: turnIndex,
          lastSeenAtTurnIndex: turnIndex,
        });
      }
    }

    const sessionEntities = Array.from(new Set(topicHistory.map((t) => t.topic)));

    return {
      activeTopic,
      isTopicSwitch,
      previousTopic: isTopicSwitch ? previousTopic : null,
      topicHistory: Object.freeze(topicHistory),
      sessionEntities: Object.freeze(sessionEntities),
    };
  }

  private static extractPrimaryEntity(norm: string): { label: string; domain: 'technical' | 'general' | 'transactional' } | null {
    // Specific Arabic matches
    if (norm.includes('فلاتر') || norm.includes('flutter')) return this.KNOWN_ENTITIES['flutter'];
    if (norm.includes('دارت') || norm.includes('dart')) return this.KNOWN_ENTITIES['dart'];
    if (norm.includes('رياكت نيتف') || norm.includes('react native')) return this.KNOWN_ENTITIES['react native'];
    if (norm.includes('رياكت') || norm.includes('react')) return this.KNOWN_ENTITIES['react'];
    if (norm.includes('بايثون') || norm.includes('python')) return this.KNOWN_ENTITIES['python'];
    if (norm.includes('postgres') || norm.includes('postgresql') || norm.includes('بوستجرس')) return this.KNOWN_ENTITIES['postgresql'];
    if (norm.includes('داتابيز') || norm.includes('قواعد بيانات') || norm.includes('قواعد البيانات') || norm.includes('database') || norm.includes('sql') || norm.includes('nosql')) {
      return this.KNOWN_ENTITIES['database'];
    }
    if (norm.includes('كاشينج') || norm.includes('كاش') || norm.includes('caching') || norm.includes('redis')) return this.KNOWN_ENTITIES['redis'];
    if (norm.includes('بريزما') || norm.includes('prisma')) return this.KNOWN_ENTITIES['prisma'];
    if (norm.includes('ويب هوك') || norm.includes('webhook')) return this.KNOWN_ENTITIES['webhook'];
    if (norm.includes('دوكر') || norm.includes('docker')) return this.KNOWN_ENTITIES['docker'];
    if (norm.includes('كيك') || norm.includes('شوكولات') || norm.includes('طبخ') || norm.includes('طريقه عمل')) return this.KNOWN_ENTITIES['cooking'];
    if (norm.includes('طقس') || norm.includes('الجو') || norm.includes('weather')) return this.KNOWN_ENTITIES['weather'];
    if (norm.includes('تذكير') || norm.includes('فكرني') || norm.includes('ذكرني') || norm.includes('reminder')) return this.KNOWN_ENTITIES['reminder'];
    if (norm.includes('تشفير') || norm.includes('encryption')) return this.KNOWN_ENTITIES['encryption'];
    if (norm.includes('معماريه') || norm.includes('معمارية') || norm.includes('هيكله') || norm.includes('architecture') || norm.includes('microservices')) {
      return this.KNOWN_ENTITIES['architecture'];
    }
    if (norm.includes('ايفون') || norm.includes('iphone') || norm.includes('سعر') || norm.includes('price')) return this.KNOWN_ENTITIES['price'];

    for (const [key, val] of Object.entries(this.KNOWN_ENTITIES)) {
      const pattern = new RegExp(`(?:^|\\s|[.,!؟()_\\-])${key}(?:$|\\s|[.,!؟()_\\-])`, 'i');
      if (pattern.test(norm)) {
        return val;
      }
    }
    return null;
  }

  private static hasContinuationSignals(norm: string): boolean {
    const signals = [
      'ده', 'وده', 'دي', 'ودي', 'فيه', 'وفيه', 'معاه', 'ومعاه', 'معاها', 'عنده', 'بيها', 'منه', 'منها',
      'لسه', 'نفس', 'كمان', 'ايضا', 'وبالنسبه', 'طب و', 'وعلى',
      'this', 'that', 'it', 'them', 'still', 'also', 'and', 'with it',
    ];
    return signals.some((s) => {
      const pattern = new RegExp(`(?:^|\\s|[.,!؟()_\\-])${s}(?:$|\\s|[.,!؟()_\\-])`, 'i');
      return pattern.test(norm);
    });
  }

  private static deriveGenericTopic(query: string): string | null {
    if (!query) return null;
    const clean = query.trim().replace(/[؟?!.]/g, '');
    if (clean.length < 5) return null;
    if (clean.length <= 40) return clean;
    return clean.slice(0, 40) + '...';
  }
}
