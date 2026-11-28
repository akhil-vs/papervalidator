import type { Logger } from '../../application/ports.js';
import type { Mailer } from '../../application/auth-ports.js';

export function createLoggingMailer(logger: Logger): Mailer {
  return {
    async send(message) {
      logger.info('mail.queued', { subject: message.subject });
    },
  };
}
