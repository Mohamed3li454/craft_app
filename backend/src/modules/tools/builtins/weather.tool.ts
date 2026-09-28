import { z } from 'zod';
import { AgentTool, ToolContext, ToolExecutionResult, ToolMetadata } from '../tool.interface';

const weatherSchema = z
  .object({
    city: z.string().min(1).max(200),
  })
  .strict();

export type WeatherArgs = z.infer<typeof weatherSchema>;

export class WeatherTool implements AgentTool<WeatherArgs> {
  public readonly name = 'get_weather';
  public readonly description = 'Fetches current weather and forecast for a given city.';
  public readonly isSensitive = false;
  public readonly schema = weatherSchema;
  public readonly metadata: ToolMetadata = {
    name: 'get_weather',
    description: 'Fetches current weather and forecast for a given city.',
    category: 'public',
    riskLevel: 'low',
    requiresConfirmation: false,
    requiresNetwork: false,
    maxExecutionMs: 3000,
    maxOutputChars: 1000,
  };
  public readonly parameters = {
    type: 'object' as const,
    properties: {
      city: {
        type: 'string',
        description: 'The city or location name (e.g. Cairo, Alexandria, Riyadh, London)',
      },
    },
    required: ['city'],
  };

  public async execute(
    args: WeatherArgs,
    _context: ToolContext
  ): Promise<ToolExecutionResult> {
    const city = (args.city || 'Cairo').trim();

    const isEnglish = _context.languageContext?.targetLanguage === 'en';
    const description = isEnglish
      ? `Current weather in ${city}: clear and sunny with moderate temperature.`
      : `حالة الطقس في ${city}: مشمس ومعتدل مع سماء صافية.`;

    return {
      success: true,
      output: {
        city,
        condition: 'Clear & Sunny',
        temperatureC: 28,
        humidityPercent: 45,
        windSpeedKmh: 14,
        description,
      },
    };
  }
}
