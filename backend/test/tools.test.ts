import { ToolRegistry } from '../src/modules/tools/registry';
import { CurrentTimeTool } from '../src/modules/tools/builtins/time.tool';
import { WeatherTool } from '../src/modules/tools/builtins/weather.tool';
import { CreateReminderTool } from '../src/modules/tools/builtins/reminder.tool';

describe('ToolRegistry and Builtin Tools', () => {
  let registry: ToolRegistry;

  beforeEach(() => {
    registry = ToolRegistry.getInstance();
  });

  test('registry loads default tools correctly', () => {
    expect(registry.getTool('get_current_time')).toBeDefined();
    expect(registry.getTool('echo_message')).toBeDefined();
    expect(registry.getTool('get_weather')).toBeDefined();
    expect(registry.getTool('web_search')).toBeDefined();
    expect(registry.getTool('create_reminder')).toBeDefined();
  });

  test('CurrentTimeTool returns ISO date and formatted string', async () => {
    const tool = new CurrentTimeTool();
    const result = await tool.execute({}, { userId: '1', conversationId: 'c1', channel: 'flutter' });

    expect(result.success).toBe(true);
    expect(result.output.iso).toBeDefined();
    expect(result.output.formatted).toBeDefined();
  });

  test('WeatherTool returns forecast for city', async () => {
    const tool = new WeatherTool();
    const result = await tool.execute({ city: 'Alexandria' }, { userId: '1', conversationId: 'c1', channel: 'flutter' });

    expect(result.success).toBe(true);
    expect(result.output.city).toBe('Alexandria');
    expect(result.output.temperatureC).toBeDefined();
  });

  test('CreateReminderTool is marked as sensitive and requires confirmation', async () => {
    const tool = new CreateReminderTool();
    expect(tool.isSensitive).toBe(true);

    const result = await tool.execute(
      { title: 'Project Review', time: 'tomorrow 10am' },
      { userId: '1', conversationId: 'c1', channel: 'flutter' }
    );

    expect(result.isSensitive).toBe(true);
    expect(result.confirmationDescription).toContain('Project Review');
  });

  test('generates valid Gemini function declarations', () => {
    const declarations = registry.getGeminiFunctionDeclarations();
    expect(declarations.length).toBeGreaterThanOrEqual(5);

    const timeDecl = declarations.find((d) => d.name === 'get_current_time');
    expect(timeDecl).toBeDefined();
    expect(timeDecl.parameters.type).toBe('OBJECT');
  });
});
