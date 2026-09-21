import { WebSearchTool } from '../src/modules/tools/builtins/search.tool';

describe('WebSearchTool Suite', () => {
  let tool: WebSearchTool;

  beforeEach(() => {
    tool = new WebSearchTool();
  });

  test('returns error when query is empty', async () => {
    const result = await tool.execute({ query: '' }, { userId: 'u1', conversationId: 'c1', channel: 'whatsapp' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('Empty search query');
  });

  test('returns valid structure in mock mode', async () => {
    const result = await tool.execute(
      { query: 'iphone duo rumors' },
      { userId: 'u1', conversationId: 'c1', channel: 'whatsapp' }
    );
    expect(result.success).toBe(true);
    expect(result.output).toBeDefined();
    expect(result.output.query).toBe('iphone duo rumors');
    expect(result.output.results.length).toBeGreaterThan(0);
    expect(result.output.results[0].title).toBeDefined();
  });

  test('parseDuckDuckGoLiteHtml extracts titles and snippets accurately', () => {
    const sampleHtml = `
      <tr>
        <td>1.&nbsp;</td>
        <td>
          <a rel="nofollow" href="https://www.macrumors.com/roundup/iphone-duo/" class='result-link'>iPhone Duo: Everything We Know | MacRumors</a>
        </td>
      </tr>
      <tr>
        <td>&nbsp;</td>
        <td class='result-snippet'>
          Apple introduced its first foldable iPhone, dubbed iPhone Duo, at its September media event.
        </td>
      </tr>
      <tr>
        <td>2.&nbsp;</td>
        <td>
          <a rel="nofollow" href="https://www.theverge.com/iphone-fold" class='result-link'>Apple Foldable Phone Leaks</a>
        </td>
      </tr>
      <tr>
        <td>&nbsp;</td>
        <td class='result-snippet'>
          Everything we know so far about Apple's upcoming dual-screen and foldable devices.
        </td>
      </tr>
    `;

    const parsed = tool.parseDuckDuckGoLiteHtml(sampleHtml, 5);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].title).toBe('iPhone Duo: Everything We Know | MacRumors');
    expect(parsed[0].snippet).toContain('Apple introduced its first foldable iPhone');
    expect(parsed[0].url).toBe('https://www.macrumors.com/roundup/iphone-duo/');
    expect(parsed[1].title).toBe('Apple Foldable Phone Leaks');
  });
});
