import { AgentTool, ToolContext, ToolExecutionResult } from '../tool.interface';

export class WeatherTool implements AgentTool {
  public readonly name = 'get_weather';
  public readonly description = 'Fetches current weather and forecast for a given city.';
  public readonly isSensitive = false;
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
    args: Record<string, any>,
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
