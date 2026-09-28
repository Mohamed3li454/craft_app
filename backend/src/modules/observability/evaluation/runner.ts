/**
 * Evaluation Harness Runner (Phase 8.5)
 *
 * Coordinates execution across the golden evaluation dataset, calculates
 * pass rates and latencies, and generates an engineering evaluation report.
 */

import { GOLDEN_EVALUATION_DATASET } from './dataset';
import { EvaluationEvaluator } from './evaluator';
import { EvaluationCategory, EvaluationReport, EvaluationResult } from './types';

export interface RunOptions {
  category?: EvaluationCategory;
  tag?: string;
  caseIds?: string[];
}

export class EvaluationRunner {
  private evaluator: EvaluationEvaluator = EvaluationEvaluator.getInstance();

  /**
   * Runs evaluation cases matching the provided filter options.
   */
  public async run(options?: RunOptions): Promise<EvaluationReport> {
    const startTime = Date.now();
    let casesToRun = [...GOLDEN_EVALUATION_DATASET];

    if (options?.category) {
      casesToRun = casesToRun.filter((c) => c.category === options.category);
    }
    if (options?.tag) {
      casesToRun = casesToRun.filter((c) => c.tags?.includes(options.tag!));
    }
    if (options?.caseIds && options.caseIds.length > 0) {
      casesToRun = casesToRun.filter((c) => options.caseIds!.includes(c.id));
    }

    const results: EvaluationResult[] = [];
    const categories: EvaluationCategory[] = [
      'memory',
      'conversation',
      'personalization',
      'adaptive_response',
      'agent',
      'provider',
      'proactive',
    ];

    const categoryBreakdown: Record<
      EvaluationCategory,
      { total: number; passed: number; failed: number; passRate: number }
    > = {
      memory: { total: 0, passed: 0, failed: 0, passRate: 0 },
      conversation: { total: 0, passed: 0, failed: 0, passRate: 0 },
      personalization: { total: 0, passed: 0, failed: 0, passRate: 0 },
      adaptive_response: { total: 0, passed: 0, failed: 0, passRate: 0 },
      agent: { total: 0, passed: 0, failed: 0, passRate: 0 },
      provider: { total: 0, passed: 0, failed: 0, passRate: 0 },
      proactive: { total: 0, passed: 0, failed: 0, passRate: 0 },
    };

    const failures: Array<{
      caseId: string;
      category: EvaluationCategory;
      errors: string[];
      replayBundle: any;
    }> = [];

    for (const c of casesToRun) {
      const res = await this.evaluator.evaluate(c);
      results.push(res);

      categoryBreakdown[c.category].total++;
      if (res.passed) {
        categoryBreakdown[c.category].passed++;
      } else {
        categoryBreakdown[c.category].failed++;
        failures.push({
          caseId: c.id,
          category: c.category,
          errors: res.errors,
          replayBundle: res.replayBundle,
        });
      }
    }

    // Calculate pass rates
    for (const cat of categories) {
      const b = categoryBreakdown[cat];
      b.passRate = b.total > 0 ? Math.round((b.passed / b.total) * 1000) / 10 : 100;
    }

    const passedCount = results.filter((r) => r.passed).length;
    const totalCases = results.length;
    const passRate = totalCases > 0 ? Math.round((passedCount / totalCases) * 1000) / 10 : 100;

    return {
      timestamp: new Date().toISOString(),
      totalCases,
      passed: passedCount,
      failed: totalCases - passedCount,
      skipped: GOLDEN_EVALUATION_DATASET.length - totalCases,
      passRate,
      durationMs: Date.now() - startTime,
      categoryBreakdown,
      failures,
    };
  }
}
