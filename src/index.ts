import express from 'express';
import { createDailyBriefWorkflow } from './workflows/daily-brief-workflow';
import { config } from './utils/config';
import { logger } from './utils/logger';
import { DatabaseService } from './db/database';
import { parseInputDate } from './utils/date';
import { serializeBrief, serializeDeliveryLog, serializeWorkflowRun } from './api/serializers';
import type { DeliveryLog } from './models/types';

function resolveLatestChannelStatus(
  deliveryLogs: DeliveryLog[],
  deliveryType: DeliveryLog['delivery_type'],
  fallbackStatus: string | null | undefined
): string | null {
  const latest = deliveryLogs.find(log => log.delivery_type === deliveryType);
  return latest?.status || fallbackStatus || null;
}

function mapTwilioMessageStatus(status: unknown): DeliveryLog['status'] {
  switch (String(status || '').toLowerCase()) {
    case 'delivered':
    case 'sent':
      return 'sent';
    case 'failed':
    case 'undelivered':
      return 'failed';
    default:
      return 'pending';
  }
}

export function createApp() {
  const app = express();
  app.use(express.urlencoded({ extended: false }));
  app.use(express.json());

  app.get('/health', (_req, res): void => {
    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      timezone: config.TIMEZONE,
    });
  });

  app.post('/webhook/daily-brief', async (req, res): Promise<void> => {
    const workflow = createDailyBriefWorkflow();

    try {
      if (config.WEBHOOK_SECRET) {
        const providedSecret = req.headers['x-webhook-secret'];
        if (providedSecret !== config.WEBHOOK_SECRET) {
          logger.warn('Invalid webhook secret provided');
          res.status(401).json({ error: 'Unauthorized' });
          return;
        }
      }

      logger.info('Webhook triggered for daily brief generation');
      const trigger = typeof req.body?.trigger === 'string'
        ? `webhook:${req.body.trigger}`
        : 'webhook';

      const { brief, deliveryResults } = await workflow.execute({
        dryRun: config.DRY_RUN_MODE,
        enableVoice: config.ENABLE_VOICE_CALLS,
        trigger,
      });

      res.json({
        success: true,
        briefId: brief.id,
        date: serializeBrief(brief).date,
        priorityScore: brief.priority_score,
        isHighPriority: brief.is_high_priority,
        deliveryResults: deliveryResults.map(d => ({
          type: d.delivery_type,
          status: d.status,
          error: d.error_message,
        })),
      });
    } catch (error: any) {
      logger.error('Webhook handler failed', { error: error.message });
      res.status(500).json({
        success: false,
        error: error.message,
      });
    } finally {
      workflow.close();
    }
  });

  app.post('/webhook/twilio/message-status', async (req, res): Promise<void> => {
    const db = new DatabaseService();

    try {
      const messageSid = typeof req.body?.MessageSid === 'string' ? req.body.MessageSid : '';
      const messageStatus = typeof req.body?.MessageStatus === 'string' ? req.body.MessageStatus : '';
      const errorCode = typeof req.body?.ErrorCode === 'string' ? req.body.ErrorCode : '';
      const errorMessage = typeof req.body?.ErrorMessage === 'string' ? req.body.ErrorMessage : '';

      if (!messageSid || !messageStatus) {
        logger.warn('Twilio SMS status callback missing required fields', {
          hasMessageSid: Boolean(messageSid),
          hasMessageStatus: Boolean(messageStatus),
        });
        res.status(400).json({ error: 'MessageSid and MessageStatus are required' });
        return;
      }

      const status = mapTwilioMessageStatus(messageStatus);
      const updatedLog = db.updateDeliveryLogByProviderMessageId({
        providerMessageId: messageSid,
        deliveryType: 'sms',
        status,
        errorMessage: errorMessage || null,
        metadata: {
          providerStatus: messageStatus,
          providerErrorCode: errorCode || null,
          providerErrorMessage: errorMessage || null,
          finalDeliveryPending: status === 'pending',
          callbackReceivedAt: new Date().toISOString(),
        },
      });

      if (!updatedLog) {
        logger.warn('Twilio SMS status callback did not match any delivery log', {
          messageSid,
          messageStatus,
        });
        res.status(202).json({ updated: false });
        return;
      }

      logger.info('Twilio SMS status callback processed', {
        messageSid,
        messageStatus,
        mappedStatus: status,
        deliveryLogId: updatedLog.id,
      });

      res.status(204).send();
    } catch (error: any) {
      logger.error('Twilio SMS status callback failed', { error: error.message });
      res.status(500).json({ error: error.message });
    } finally {
      db.close();
    }
  });

  app.post('/api/generate-brief', async (req, res): Promise<void> => {
    const workflow = createDailyBriefWorkflow();

    try {
      const { date, dryRun, skipDelivery, forceRegenerate, enableVoice, forceVoice, forceDelivery } = req.body;
      const parsedDate = typeof date === 'string' ? parseInputDate(date) : undefined;

      if (date && typeof date === 'string' && !parsedDate) {
        res.status(400).json({ success: false, error: 'Invalid date format' });
        return;
      }

      const { brief, deliveryResults } = await workflow.execute({
        date: parsedDate ?? (date instanceof Date ? date : undefined),
        dryRun: dryRun ?? config.DRY_RUN_MODE,
        skipDelivery,
        forceRegenerate,
        enableVoice: enableVoice ?? config.ENABLE_VOICE_CALLS,
        forceVoice: forceVoice === true,
        forceDelivery: forceDelivery === true,
        trigger: 'api',
      });

      res.json({
        success: true,
        brief: serializeBrief(brief),
        deliveryResults: deliveryResults.map(serializeDeliveryLog),
      });
    } catch (error: any) {
      logger.error('API brief generation failed', { error: error.message });
      res.status(500).json({
        success: false,
        error: error.message,
      });
    } finally {
      workflow.close();
    }
  });

  app.get('/api/brief/latest', async (_req, res): Promise<void> => {
    const db = new DatabaseService();

    try {
      const brief = db.getLatestBrief();

      if (!brief) {
        res.status(404).json({ error: 'No brief found' });
        return;
      }

      const deliveryLogs = db.getDeliveryLogsForBrief(brief.id!);
      res.json({
        brief: serializeBrief(brief),
        deliveryLogs: deliveryLogs.map(serializeDeliveryLog),
      });
    } catch (error: any) {
      logger.error('Failed to get latest brief', { error: error.message });
      res.status(500).json({ error: error.message });
    } finally {
      db.close();
    }
  });

  app.get('/api/brief/:date', async (req, res): Promise<void> => {
    const date = parseInputDate(req.params.date);
    if (!date) {
      res.status(400).json({ error: 'Invalid date format' });
      return;
    }

    const db = new DatabaseService();

    try {
      const brief = db.getBriefByDate(date);

      if (!brief) {
        res.status(404).json({ error: 'No brief found for this date' });
        return;
      }

      const deliveryLogs = db.getDeliveryLogsForBrief(brief.id!);
      res.json({
        brief: serializeBrief(brief),
        deliveryLogs: deliveryLogs.map(serializeDeliveryLog),
      });
    } catch (error: any) {
      logger.error('Failed to get brief by date', { error: error.message });
      res.status(500).json({ error: error.message });
    } finally {
      db.close();
    }
  });

  app.get('/api/status/latest', async (_req, res): Promise<void> => {
    const db = new DatabaseService();

    try {
      const latestRun = db.getLatestWorkflowRun();
      if (!latestRun) {
        res.status(404).json({ error: 'No workflow runs found' });
        return;
      }

      const brief = latestRun.brief_id ? db.getBrief(latestRun.brief_id) : null;
      const deliveryLogs = brief?.id ? db.getDeliveryLogsForBrief(brief.id) : [];
      const channelStatus = {
        sms: resolveLatestChannelStatus(deliveryLogs, 'sms', latestRun.sms_status),
        voice: resolveLatestChannelStatus(deliveryLogs, 'voice', latestRun.voice_status),
      };

      res.json({
        run: serializeWorkflowRun(latestRun),
        channelStatus,
        brief: brief ? serializeBrief(brief) : null,
        deliveryLogs: deliveryLogs.map(serializeDeliveryLog),
      });
    } catch (error: any) {
      logger.error('Failed to get latest workflow status', { error: error.message });
      res.status(500).json({ error: error.message });
    } finally {
      db.close();
    }
  });

  return app;
}

export function startServer() {
  const app = createApp();
  const port = config.PORT;

  return app.listen(port, () => {
    logger.info(`Server running on port ${port}`);
    console.log(`
🚀 Founder Daily Brief Server Started

   Port: ${port}
   Environment: ${config.NODE_ENV}
   Timezone: ${config.TIMEZONE}

   Endpoints:
   - Health: http://localhost:${port}/health
   - Webhook: http://localhost:${port}/webhook/daily-brief
   - Twilio SMS Callback: http://localhost:${port}/webhook/twilio/message-status
   - Generate: POST http://localhost:${port}/api/generate-brief
   - Latest: GET http://localhost:${port}/api/brief/latest
   - By Date: GET http://localhost:${port}/api/brief/YYYY-MM-DD
   - Status: GET http://localhost:${port}/api/status/latest

   Ready to generate daily briefs!
  `);
  });
}

if (require.main === module) {
  startServer();
}

export default createApp();
