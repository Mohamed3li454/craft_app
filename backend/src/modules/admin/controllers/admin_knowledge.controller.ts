import { Request, Response } from 'express';
import { AdminFaqController } from './admin_faq.controller';
import { CandidateReviewController } from '../../cache/learning/candidate_review.controller';
import { CacheObservability } from '../../cache/cache_observability';
import { sendAdminSuccess, sendAdminError } from '../admin.types';
import { logger } from '../../../core/logger';

export class AdminKnowledgeController {
  private faqController = new AdminFaqController();
  private candidateController = new CandidateReviewController();
  private observability = CacheObservability.getInstance();

  // FAQ Delegations
  public getFaqs = (req: Request, res: Response) => this.faqController.getFaqs(req, res);
  public createFaq = (req: Request, res: Response) => this.faqController.createFaq(req, res);
  public updateFaq = (req: Request, res: Response) => this.faqController.updateFaq(req, res);
  public deleteFaq = (req: Request, res: Response) => this.faqController.deleteFaq(req, res);

  // Cache Candidates Delegations
  public listCandidates = (req: Request, res: Response) => this.candidateController.listCandidates(req, res);
  public getCandidate = (req: Request, res: Response) => this.candidateController.getCandidate(req, res);
  public validateCandidate = (req: Request, res: Response) => this.candidateController.validateCandidate(req, res);
  public rejectCandidate = (req: Request, res: Response) => this.candidateController.rejectCandidate(req, res);
  public promoteCandidate = (req: Request, res: Response) => this.candidateController.promoteCandidate(req, res);

  // Cache Metrics & Stats
  public getCacheMetrics = async (req: Request, res: Response): Promise<void> => {
    try {
      const filter = {
        from: req.query.from as string,
        to: req.query.to as string,
      };
      const [stats, learningStats, candidateStats, promotionStats] = await Promise.all([
        this.observability.getCacheStats(filter),
        this.observability.getLearningStats(filter),
        this.observability.getCandidateStats(filter),
        this.observability.getPromotionStats(filter),
      ]);

      sendAdminSuccess(res, {
        stats,
        learning: {
          ...learningStats,
          candidateDistribution: candidateStats,
          conversionRates: promotionStats,
        },
      });
    } catch (err: any) {
      logger.error('[Admin Knowledge] Failed to get cache metrics', { error: err.message });
      sendAdminError(res, 500, 'ADMIN_INTERNAL_ERROR', 'Failed to retrieve cache metrics');
    }
  };
}
