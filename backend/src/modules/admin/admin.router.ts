import { Router } from 'express';
import { AdminOverviewController } from './controllers/admin_overview.controller';
import { AdminObservabilityController } from './controllers/admin_observability.controller';
import { AdminUsersController } from './controllers/admin_users.controller';
import { AdminConversationsController } from './controllers/admin_conversations.controller';
import { AdminMemoryController } from './controllers/admin_memory.controller';
import { AdminRemindersController } from './controllers/admin_reminders.controller';
import { AdminKnowledgeController } from './controllers/admin_knowledge.controller';
import { AdminAgentRunsController } from './controllers/admin_agent_runs.controller';
import { AdminToolCallsController } from './controllers/admin_tool_calls.controller';
import { AdminToolsController } from './controllers/admin_tools.controller';
import { AdminProactiveController } from './controllers/admin_proactive.controller';
import { AdminSearchController } from './controllers/admin_search.controller';
import { AdminSettingsController } from './controllers/admin_settings.controller';
import { AdminAuditController } from './controllers/admin_audit.controller';
import { AdminEvaluationController } from './controllers/admin_evaluation.controller';
import { AdminFaqController } from './controllers/admin_faq.controller';
import { CandidateReviewController } from '../cache/learning/candidate_review.controller';
import { AnalyticsController } from '../analytics/analytics.controller';
import { requireAdminRole } from '../../middleware/admin_auth.middleware';

export function createAdminRouter(): Router {
  const router = Router();

  const overviewController = new AdminOverviewController();
  const observabilityController = new AdminObservabilityController();
  const usersController = new AdminUsersController();
  const conversationsController = new AdminConversationsController();
  const memoryController = new AdminMemoryController();
  const remindersController = new AdminRemindersController();
  const knowledgeController = new AdminKnowledgeController();
  const agentRunsController = new AdminAgentRunsController();
  const toolCallsController = new AdminToolCallsController();
  const legacyToolsController = new AdminToolsController();
  const proactiveController = new AdminProactiveController();
  const searchController = new AdminSearchController();
  const settingsController = new AdminSettingsController();
  const auditController = new AdminAuditController();
  const legacyFaqController = new AdminFaqController();
  const candidateReviewController = new CandidateReviewController();
  const legacyAnalyticsController = new AnalyticsController();
  const evaluationController = new AdminEvaluationController();

  // Mutation roles: owner, admin, operator
  const mutationGuard = requireAdminRole('owner', 'admin', 'operator');
  // Evaluation execution: owner, admin only
  const evaluationMutationGuard = requireAdminRole('owner', 'admin');

  // ==========================================
  // 1. Overview & Platform Metrics
  // ==========================================
  router.get('/overview', overviewController.getOverview);
  router.get('/analytics', overviewController.getOverview); // Backward-compatible alias

  // ==========================================
  // 2. Observability & System Health
  // ==========================================
  router.get('/observability/health', observabilityController.getHealth);
  router.get('/observability/metrics', observabilityController.getMetrics);

  // ==========================================
  // 3. User Operations (Control Plane)
  // ==========================================
  router.get('/users', usersController.getUsers);
  router.get('/users/:id/details', usersController.getUserDetails);
  router.post('/users/:id/toggle-vip', mutationGuard, usersController.toggleUserVip);
  router.post('/users/:id/ban', mutationGuard, usersController.banUser);
  router.post('/users/:id/unban', mutationGuard, usersController.unbanUser);

  // ==========================================
  // 4. Conversation Inspector Operations
  // ==========================================
  router.get('/conversations', conversationsController.getConversations);
  router.get('/conversations/:id/messages', conversationsController.getConversationTranscript);
  router.get('/conversations/:id/transcript', conversationsController.getConversationTranscript);
  router.post('/conversations/:id/archive', mutationGuard, conversationsController.archiveConversation);

  // ==========================================
  // 5. Memory Operations (Confirmed & Candidates)
  // ==========================================
  router.get('/memory', memoryController.getMemoryItems);
  router.get('/memory/candidates', memoryController.getEvidenceCandidates);
  router.get('/memory/candidates/:id', memoryController.getEvidenceCandidateDetails);
  router.post('/memory/candidates/:id/approve', mutationGuard, memoryController.approveEvidenceCandidate);
  router.post('/memory/candidates/:id/reject', mutationGuard, memoryController.rejectEvidenceCandidate);
  router.post('/memory/purge', mutationGuard, memoryController.purgeUserMemories);
  router.get('/memory/:id', memoryController.getMemoryDetails);
  router.put('/memory/:id', mutationGuard, memoryController.updateMemoryItem);
  router.delete('/memory/:id', mutationGuard, memoryController.deleteMemoryItem);

  // ==========================================
  // 6. Reminder Operations (Full Lifecycle)
  // ==========================================
  router.get('/reminders', remindersController.getReminders);
  router.get('/reminders/:id', remindersController.getReminderDetails);
  router.post('/reminders/:id/cancel', mutationGuard, remindersController.cancelReminder);
  router.post('/reminders/:id/retry', mutationGuard, remindersController.retryReminder);

  // ==========================================
  // 7. Knowledge & Semantic Cache Operations
  // ==========================================
  router.get('/knowledge/faq', knowledgeController.getFaqs);
  router.post('/knowledge/faq', mutationGuard, knowledgeController.createFaq);
  router.put('/knowledge/faq/:id', mutationGuard, knowledgeController.updateFaq);
  router.delete('/knowledge/faq/:id', mutationGuard, knowledgeController.deleteFaq);
  router.get('/knowledge/cache/candidates', knowledgeController.listCandidates);
  router.get('/knowledge/cache/candidates/:id', knowledgeController.getCandidate);
  router.post('/knowledge/cache/candidates/:id/validate', mutationGuard, knowledgeController.validateCandidate);
  router.post('/knowledge/cache/candidates/:id/reject', mutationGuard, knowledgeController.rejectCandidate);
  router.post('/knowledge/cache/candidates/:id/promote', mutationGuard, knowledgeController.promoteCandidate);
  router.get('/knowledge/cache/metrics', knowledgeController.getCacheMetrics);

  // Backward-compatible Knowledge / Cache Aliases
  router.get('/faq', legacyFaqController.getFaqs);
  router.post('/faq', mutationGuard, legacyFaqController.createFaq);
  router.put('/faq/:id', mutationGuard, legacyFaqController.updateFaq);
  router.delete('/faq/:id', mutationGuard, legacyFaqController.deleteFaq);
  router.get('/semantic-cache/dashboard', legacyAnalyticsController.getSemanticCacheDashboard);
  router.get('/cache/candidates', candidateReviewController.listCandidates);
  router.get('/cache/candidates/:id', candidateReviewController.getCandidate);
  router.post('/cache/candidates/:id/validate', mutationGuard, candidateReviewController.validateCandidate);
  router.post('/cache/candidates/:id/reject', mutationGuard, candidateReviewController.rejectCandidate);
  router.post('/cache/candidates/:id/promote', mutationGuard, candidateReviewController.promoteCandidate);
  router.get('/cache/stats', candidateReviewController.getCacheStats);
  router.get('/cache/learning-stats', candidateReviewController.getLearningStats);
  router.post('/cache/feedback/incorrect', mutationGuard, candidateReviewController.markIncorrect);

  // ==========================================
  // 8. Agent Runs Observability (Zero Hidden Thoughts)
  // ==========================================
  router.get('/agent-runs', agentRunsController.getAgentRuns);
  router.get('/agent-runs/:id', agentRunsController.getAgentRunDetails);

  // ==========================================
  // 9. Tool Calls Operations (Sanitized I/O)
  // ==========================================
  router.get('/tool-calls', toolCallsController.getToolCalls);
  router.get('/tool-calls/:id', toolCallsController.getToolCallDetails);
  router.get('/tools-stats', legacyToolsController.getToolsStats); // Backward-compatible tool analytics

  // ==========================================
  // 10. Proactive Operations
  // ==========================================
  router.get('/proactive/actions', proactiveController.getActions);
  router.get('/proactive/actions/:id', proactiveController.getActionDetails);
  router.post('/proactive/actions/:id/cancel', mutationGuard, proactiveController.cancelAction);
  router.post('/proactive/actions/:id/retry', mutationGuard, proactiveController.retryAction);
  router.get('/proactive/dispatch-log', proactiveController.getDispatchLogs);
  router.get('/proactive/engagement', proactiveController.getEngagement);

  // ==========================================
  // 11. Search Intelligence
  // ==========================================
  router.get('/search/recent', searchController.getRecentSearches);
  router.post('/search/diagnostic', searchController.runDiagnostic);

  // ==========================================
  // 12. Runtime Settings & Platform Config
  // ==========================================
  router.get('/settings', settingsController.getSettings);
  router.put('/settings', mutationGuard, settingsController.updateSettings);

  // ==========================================
  // 13. Audit Trail Inspection
  // ==========================================
  router.get('/audit', auditController.getAuditLogs);

  // ==========================================
  // 14. AI Quality & Evaluation Center (Phase 12.6 Intelligence 2.0)
  // ==========================================
  router.get('/evaluation/overview', evaluationController.getOverview);
  router.get('/evaluation/intelligence', evaluationController.getIntelligenceOverview);
  router.get('/evaluation/trends', evaluationController.getTrends);
  router.get('/evaluation/degradation', evaluationController.getDegradation);
  router.get('/evaluation/dimensions', evaluationController.getDimensionsIntelligence);
  router.get('/evaluation/performance', evaluationController.getPerformance);
  router.get('/evaluation/providers', evaluationController.getProvidersDiagnostics);
  router.get('/evaluation/confidence', evaluationController.getMeasurementConfidence);
  router.get('/evaluation/dataset', evaluationController.getDatasetMetadata);
  router.get('/evaluation/quality', evaluationController.getQualityOverview);
  router.get('/evaluation/release-quality', evaluationController.getReleaseQualityHistory);
  router.get('/evaluation/failures', evaluationController.getFailures);
  router.get('/evaluation/compare', evaluationController.compareRuns);
  router.get('/evaluation/runs/compare', evaluationController.compareRuns);
  router.get('/evaluation/cases/best', evaluationController.getBestCases);
  router.get('/evaluation/cases/worst', evaluationController.getWorstCases);
  router.get('/evaluation/cases/flaky', evaluationController.getFlakyCases);
  router.get('/evaluation/cases', evaluationController.getCases);
  router.get('/evaluation/cases/:id/history', evaluationController.getCaseHistory);
  router.get('/evaluation/cases/:id', evaluationController.getCaseDetails);
  router.get('/evaluation/runs', evaluationController.getRuns);
  router.get('/evaluation/runs/:id/progress', evaluationController.getRunProgress);
  router.get('/evaluation/runs/:id/quality-gate', evaluationController.getRunQualityGate);
  router.get('/evaluation/runs/:id/release-quality', evaluationController.getRunReleaseQuality);
  router.get('/evaluation/runs/:id/snapshot', evaluationController.getRunSnapshot);
  router.post('/evaluation/runs/:id/cancel', evaluationMutationGuard, evaluationController.cancelRun);
  router.get('/evaluation/runs/:id', evaluationController.getRunDetails);
  router.get('/evaluation/runs/:id/results', evaluationController.getRunResults);
  router.get('/evaluation/regressions', evaluationController.getRegressions);
  router.post('/evaluation/runs', evaluationMutationGuard, evaluationController.triggerRun);

  return router;
}

export const adminRouter = createAdminRouter();
