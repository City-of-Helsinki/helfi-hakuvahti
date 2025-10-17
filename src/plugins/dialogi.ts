import axios, { type AxiosResponse } from 'axios';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import type { DialogiSmsRequestType, DialogiSmsResponseType } from '../types/dialogi';

/**
 * Elisa Dialogi SMS Plugin
 *
 * Provides SMS sending functionality via Elisa Dialogi API
 * https://docs.dialogi.elisa.fi/docs/dialogi/send-sms/operations/create-a
 */

export interface DialogiClient {
  /**
   * Send an SMS message
   * @param to - Recipient phone number in E.164 format (e.g., "+358501234567")
   * @param message - SMS message content
   * @returns Promise with Dialogi API response
   */
  sendSms(to: string, message: string): Promise<DialogiSmsResponseType>;
}

export default fp(async function dialogiPlugin(fastify: FastifyInstance) {
  // Validate required environment variables
  if (!process.env.DIALOGI_API_URL) {
    fastify.log.warn('DIALOGI_API_URL not configured - SMS sending will be disabled');
  }

  if (!process.env.DIALOGI_API_KEY) {
    fastify.log.warn('DIALOGI_API_KEY not configured - SMS sending will be disabled');
  }

  const dialogiClient: DialogiClient = {
    async sendSms(to: string, message: string): Promise<DialogiSmsResponseType> {
      // Check if Dialogi is configured
      if (!process.env.DIALOGI_API_URL || !process.env.DIALOGI_API_KEY) {
        throw new Error('Dialogi SMS service is not configured. Please set DIALOGI_API_URL and DIALOGI_API_KEY');
      }

      try {
        const requestBody: DialogiSmsRequestType = {
          to,
          message,
        };

        const response: AxiosResponse<DialogiSmsResponseType> = await axios.post(
          process.env.DIALOGI_API_URL,
          requestBody,
          {
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${process.env.DIALOGI_API_KEY}`,
            },
            timeout: 10000, // 10 second timeout
          },
        );

        fastify.log.info({ to, messageId: response.data.id }, 'SMS sent successfully via Dialogi');

        return response.data;
      } catch (error) {
        if (axios.isAxiosError(error)) {
          const errorMessage = error.response?.data?.message || error.message;
          fastify.log.error(
            {
              to,
              error: errorMessage,
              status: error.response?.status,
              statusText: error.response?.statusText,
            },
            'Failed to send SMS via Dialogi',
          );
          throw new Error(`Dialogi SMS API error: ${errorMessage}`);
        }

        fastify.log.error({ to, error }, 'Unexpected error sending SMS via Dialogi');
        throw error;
      }
    },
  };

  // Decorate Fastify instance with Dialogi client
  fastify.decorate('dialogi', dialogiClient);
});

declare module 'fastify' {
  interface FastifyInstance {
    dialogi: DialogiClient;
  }
}
