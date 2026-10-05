/**
 * Degradation Detection & Health Engine (Phase 12.6)
 *
 * Implements deterministic detection of quality, reliability, performance,
 * and regression acceleration degradation signals across evaluation runs.
 * Computes authoritative Quality Health Status: HEALTHY, WATCH, DEGRADED, CRITICAL, INSUFFICIENT_DATA.
 *
 * Strict Invariant: Zero LLM judgment. All thresholds are deterministic, explicit, and configurable.
 */

import { RunTrendSummary } from './trend_intelligence';
import { DimensionHealth } from './quality_intelligence';
import { EvaluationCategory } from './types';

export type QualityHealthStatus = 'HEALTHY' | 'WATCH' | 'DEGRADED' | 'CRITICAL' | 'INSUFFICIENT_DATA';
export type DegradationSeverity = 'info' | 'warning' | 'critical';
export type DegradationCategory = 'quality' | 'reliability' | 'performance' | 'regression_acceleration';

export interface DegradationSignal {
  id: string;
  category: DegradationCategory;
  severity: DegradationSeverity;
  dimension?: string;
  metric: string;
  title: string;
  message: string;
  previousValue: number | string;
  currentValue: number | string;
  thresholdBreached: string;
  timestamp: string;
}

export interface DegradationDetectionResult {
  healthStatus: QualityHealthStatus;
  statusReason: string;
  signalsCount: number;
  criticalSignalsCount: number;
  warningSignalsCount: number;
  signals: DegradationSignal[];
  regressionAcceleration: {
    detected: boolean;
    streakLength: number;
    consecutiveRegressions: number[];
  };
}

export interface DegradationThresholds {
  scoreDropWarning: number; // e.g. 3.0 points
  scoreDropCritical: number; // e.g. 10.0 points
  passRateDropWarning: number; // e.g. 5.0 pp
  passRateDropCritical: number; // e.g. 15.0 pp
  latencyIncreaseWarningPct: number; // e.g. 25%
  latencyIncreaseCriticalPct: number; // e.g. 50%
  tokenIncreaseWarningPct: number; // e.g. 30%
  dimensionScoreDropWarning: number; // e.g. 5.0 points
  maxRegressionsHealthy: number; // 0
  maxRegressionsWatch: number; // 2
  maxRegressionsDegraded: number; // 4
}

export const DEFAULT_DEGRADATION_THRESHOLDS: DegradationThresholds = {
  scoreDropWarning: 3.0,
  scoreDropCritical: 10.0,
  passRateDropWarning: 5.0,
  passRateDropCritical: 15.0,
  latencyIncreaseWarningPct: 25,
  latencyIncreaseCriticalPct: 50,
  tokenIncreaseWarningPct: 30,
  dimensionScoreDropWarning: 5.0,
  maxRegressionsHealthy: 0,
  maxRegressionsWatch: 2,
  maxRegressionsDegraded: 4,
};

/**
 * Checks for regression acceleration across recent consecutive runs.
 * Detected when regressions strictly increase across at least 3 consecutive runs (e.g. 1 -> 3 -> 5).
 */
export function detectRegressionAcceleration(runs: RunTrendSummary[]): {
  detected: boolean;
  streakLength: number;
  consecutiveRegressions: number[];
} {
  if (runs.length < 3) {
    return { detected: false, streakLength: 0, consecutiveRegressions: [] };
  }

  // runs[0] is newest, runs[1] is older, runs[2] is older still.
  // Acceleration means: runs[0].reg > runs[1].reg > runs[2].reg > 0
  const series = runs.slice(0, 5).map((r) => r.regressionCount);
  let streak = 0;

  for (let i = 0; i < series.length - 1; i++) {
    if (series[i] > series[i + 1] && series[i] > 0) {
      streak++;
    } else {
      break;
    }
  }

  // A streak of at least 2 transitions (covering 3 runs) indicates acceleration
  const detected = streak >= 2;
  return {
    detected,
    streakLength: streak + 1,
    consecutiveRegressions: series.slice(0, streak + 1).reverse(),
  };
}

/**
 * Detects degradation signals by comparing current run against previous run and thresholds.
 */
export function detectDegradation(
  runs: RunTrendSummary[],
  dimensionHealthMap?: Record<EvaluationCategory, DimensionHealth>,
  thresholds: DegradationThresholds = DEFAULT_DEGRADATION_THRESHOLDS
): DegradationDetectionResult {
  if (runs.length === 0) {
    return {
      healthStatus: 'INSUFFICIENT_DATA',
      statusReason: 'No historical evaluation runs available for quality assessment',
      signalsCount: 0,
      criticalSignalsCount: 0,
      warningSignalsCount: 0,
      signals: [],
      regressionAcceleration: { detected: false, streakLength: 0, consecutiveRegressions: [] },
    };
  }

  const current = runs[0];
  const previous = runs.length > 1 ? runs[1] : null;
  const signals: DegradationSignal[] = [];
  const now = new Date().toISOString();

  // 1. Regressions Count Degradation
  if (current.regressionCount > thresholds.maxRegressionsDegraded) {
    signals.push({
      id: 'deg-reg-crit',
      category: 'quality',
      severity: 'critical',
      metric: 'regressionCount',
      title: 'High Regression Count',
      message: `Current run introduced ${current.regressionCount} regressions (critical threshold: >${thresholds.maxRegressionsDegraded})`,
      previousValue: previous?.regressionCount ?? 'N/A',
      currentValue: current.regressionCount,
      thresholdBreached: `>${thresholds.maxRegressionsDegraded}`,
      timestamp: now,
    });
  } else if (current.regressionCount > thresholds.maxRegressionsHealthy) {
    signals.push({
      id: 'deg-reg-warn',
      category: 'quality',
      severity: 'warning',
      metric: 'regressionCount',
      title: 'Active Regressions Detected',
      message: `Current run contains ${current.regressionCount} active regressions`,
      previousValue: previous?.regressionCount ?? 'N/A',
      currentValue: current.regressionCount,
      thresholdBreached: `>${thresholds.maxRegressionsHealthy}`,
      timestamp: now,
    });
  }

  // 2. Score Drop Degradation
  if (previous) {
    const scoreDrop = Math.round((previous.overallScore - current.overallScore) * 10) / 10;
    if (scoreDrop >= thresholds.scoreDropCritical) {
      signals.push({
        id: 'deg-score-crit',
        category: 'quality',
        severity: 'critical',
        metric: 'overallScore',
        title: 'Critical Score Drop',
        message: `Evaluation score dropped by ${scoreDrop} points (from ${previous.overallScore} to ${current.overallScore})`,
        previousValue: previous.overallScore,
        currentValue: current.overallScore,
        thresholdBreached: `Drop >= ${thresholds.scoreDropCritical}`,
        timestamp: now,
      });
    } else if (scoreDrop >= thresholds.scoreDropWarning) {
      signals.push({
        id: 'deg-score-warn',
        category: 'quality',
        severity: 'warning',
        metric: 'overallScore',
        title: 'Measurable Score Drop',
        message: `Evaluation score dropped by ${scoreDrop} points (from ${previous.overallScore} to ${current.overallScore})`,
        previousValue: previous.overallScore,
        currentValue: current.overallScore,
        thresholdBreached: `Drop >= ${thresholds.scoreDropWarning}`,
        timestamp: now,
      });
    }

    // 3. Pass Rate Drop Degradation
    const passRateDrop = Math.round((previous.passRate - current.passRate) * 10) / 10;
    if (passRateDrop >= thresholds.passRateDropCritical) {
      signals.push({
        id: 'deg-passrate-crit',
        category: 'quality',
        severity: 'critical',
        metric: 'passRate',
        title: 'Severe Pass Rate Drop',
        message: `Pass rate dropped by ${passRateDrop}% (from ${previous.passRate}% to ${current.passRate}%)`,
        previousValue: `${previous.passRate}%`,
        currentValue: `${current.passRate}%`,
        thresholdBreached: `Drop >= ${thresholds.passRateDropCritical}%`,
        timestamp: now,
      });
    } else if (passRateDrop >= thresholds.passRateDropWarning) {
      signals.push({
        id: 'deg-passrate-warn',
        category: 'quality',
        severity: 'warning',
        metric: 'passRate',
        title: 'Pass Rate Degradation',
        message: `Pass rate dropped by ${passRateDrop}% (from ${previous.passRate}% to ${current.passRate}%)`,
        previousValue: `${previous.passRate}%`,
        currentValue: `${current.passRate}%`,
        thresholdBreached: `Drop >= ${thresholds.passRateDropWarning}%`,
        timestamp: now,
      });
    }

    // 4. Performance Degradation: Latency Spike
    if (previous.averageLatencyMs > 0 && current.averageLatencyMs > 0) {
      const latencyIncreasePct = Math.round(((current.averageLatencyMs - previous.averageLatencyMs) / previous.averageLatencyMs) * 100);
      if (latencyIncreasePct >= thresholds.latencyIncreaseCriticalPct) {
        signals.push({
          id: 'deg-lat-crit',
          category: 'performance',
          severity: 'critical',
          metric: 'averageLatencyMs',
          title: 'Critical Latency Spike',
          message: `Average latency increased by +${latencyIncreasePct}% (${previous.averageLatencyMs}ms → ${current.averageLatencyMs}ms)`,
          previousValue: `${previous.averageLatencyMs}ms`,
          currentValue: `${current.averageLatencyMs}ms`,
          thresholdBreached: `Increase >= +${thresholds.latencyIncreaseCriticalPct}%`,
          timestamp: now,
        });
      } else if (latencyIncreasePct >= thresholds.latencyIncreaseWarningPct) {
        signals.push({
          id: 'deg-lat-warn',
          category: 'performance',
          severity: 'warning',
          metric: 'averageLatencyMs',
          title: 'Elevated Latency Observed',
          message: `Average latency increased by +${latencyIncreasePct}% (${previous.averageLatencyMs}ms → ${current.averageLatencyMs}ms)`,
          previousValue: `${previous.averageLatencyMs}ms`,
          currentValue: `${current.averageLatencyMs}ms`,
          thresholdBreached: `Increase >= +${thresholds.latencyIncreaseWarningPct}%`,
          timestamp: now,
        });
      }
    }

    // 5. Performance Degradation: Token Spike
    if (previous.averageTokens > 0 && current.averageTokens > 0) {
      const tokenIncreasePct = Math.round(((current.averageTokens - previous.averageTokens) / previous.averageTokens) * 100);
      if (tokenIncreasePct >= thresholds.tokenIncreaseWarningPct) {
        signals.push({
          id: 'deg-token-warn',
          category: 'performance',
          severity: 'warning',
          metric: 'averageTokens',
          title: 'Elevated Token Consumption',
          message: `Average tokens per case increased by +${tokenIncreasePct}% (${previous.averageTokens} → ${current.averageTokens})`,
          previousValue: previous.averageTokens,
          currentValue: current.averageTokens,
          thresholdBreached: `Increase >= +${thresholds.tokenIncreaseWarningPct}%`,
          timestamp: now,
        });
      }
    }
  }

  // 6. Regression Acceleration
  const regAccel = detectRegressionAcceleration(runs);
  if (regAccel.detected) {
    signals.push({
      id: 'deg-reg-accel',
      category: 'regression_acceleration',
      severity: 'critical',
      metric: 'regressionStreak',
      title: 'Regression Acceleration Detected',
      message: `Regressions are continuously accelerating across ${regAccel.streakLength} consecutive runs (${regAccel.consecutiveRegressions.join(' → ')})`,
      previousValue: regAccel.consecutiveRegressions[0],
      currentValue: regAccel.consecutiveRegressions[regAccel.consecutiveRegressions.length - 1],
      thresholdBreached: 'Strictly increasing regressions across >= 3 runs',
      timestamp: now,
    });
  }

  // 7. Dimension Score Drops
  if (dimensionHealthMap) {
    for (const [dim, health] of Object.entries(dimensionHealthMap)) {
      if (health.regressionsCount > 0) {
        signals.push({
          id: `deg-dim-reg-${dim}`,
          category: 'quality',
          severity: health.regressionsCount >= 2 ? 'critical' : 'warning',
          dimension: dim,
          metric: 'dimensionRegressions',
          title: `Regressions in ${dim}`,
          message: `Dimension '${dim}' has ${health.regressionsCount} active regressions (pass rate: ${health.passRate}%)`,
          previousValue: '0',
          currentValue: health.regressionsCount,
          thresholdBreached: '>0 regressions in dimension',
          timestamp: now,
        });
      }
    }
  }

  // Classify Quality Health Status deterministically
  const criticalCount = signals.filter((s) => s.severity === 'critical').length;
  const warningCount = signals.filter((s) => s.severity === 'warning').length;

  let healthStatus: QualityHealthStatus = 'HEALTHY';
  let statusReason = 'Quality metrics are stable; no degradation signals detected';

  if (criticalCount > 0 || current.overallScore < 70 || current.regressionCount >= 5 || regAccel.detected) {
    healthStatus = 'CRITICAL';
    statusReason = `Critical degradation: ${criticalCount} critical alert(s)${regAccel.detected ? ', regression acceleration detected' : ''}`;
  } else if (current.overallScore < 80 || current.regressionCount > thresholds.maxRegressionsWatch || warningCount >= 3) {
    healthStatus = 'DEGRADED';
    statusReason = `Degraded state: ${warningCount} degradation alert(s), score ${current.overallScore}%, ${current.regressionCount} regressions`;
  } else if (warningCount > 0 || current.regressionCount > 0 || current.overallScore < 90) {
    healthStatus = 'WATCH';
    statusReason = `Watch state: ${warningCount} warning signal(s) observed, score ${current.overallScore}%`;
  }

  return {
    healthStatus,
    statusReason,
    signalsCount: signals.length,
    criticalSignalsCount: criticalCount,
    warningSignalsCount: warningCount,
    signals,
    regressionAcceleration: regAccel,
  };
}
