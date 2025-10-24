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
   * @param destination - Recipient phone number in E.164 format (e.g., "+358501234567")
   * @param text - SMS message content
   * @returns Promise with Dialogi API response
   */
  sendSms(destination: string, text: string): Promise<DialogiSmsResponseType>;
}

export default fp(async function dialogiPlugin(fastify: FastifyInstance) {
  // Validate required environment variables
  if (!process.env.DIALOGI_API_URL) {
    fastify.log.warn('DIALOGI_API_URL not configured - SMS sending will be disabled');
  }

  if (!process.env.DIALOGI_API_KEY) {
    fastify.log.warn('DIALOGI_API_KEY not configured - SMS sending will be disabled');
  }

  if (!process.env.DIALOGI_SENDER) {
    fastify.log.warn('DIALOGI_SENDER not configured - SMS sending will be disabled');
  }

  const dialogiClient: DialogiClient = {
    async sendSms(destination: string, text: string): Promise<DialogiSmsResponseType> {
      // Check if Dialogi is configured
      if (!process.env.DIALOGI_API_URL || !process.env.DIALOGI_API_KEY || !process.env.DIALOGI_SENDER) {
        throw new Error(
          'Dialogi SMS service is not configured. Please set DIALOGI_API_URL, DIALOGI_API_KEY, and DIALOGI_SENDER',
        );
      }

      try {
        const requestBody: DialogiSmsRequestType = {
          sender: process.env.DIALOGI_SENDER,
          destination,
          text,
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

        // Extract message ID from response
        const messageId =
          response.data.messages?.[0]?.[destination]?.messageid ||
          Object.values(response.data.messages?.[0] || {})[0]?.messageid ||
          'unknown';

        fastify.log.info({ messageId }, 'SMS sent to Dialogi');

        return response.data;
      } catch (error) {
        if (axios.isAxiosError(error)) {
          const errorMessage = error.response?.data?.message || error.message;
          fastify.log.error(
            {
              destination,
              error: errorMessage,
              status: error.response?.status,
              statusText: error.response?.statusText,
            },
            'Failed to send SMS via Dialogi',
          );
          throw new Error(`Dialogi SMS API error: ${errorMessage}`);
        }

        fastify.log.error({ error }, 'Unexpected error sending SMS via Dialogi');
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
