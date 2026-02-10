import axios, { type AxiosResponse } from 'axios';
import type { FastifyRequest as FastifyRequestType } from 'fastify';
import fp from 'fastify-plugin';
import type { AtvDocumentBatchType, AtvDocumentType, AtvResponseType } from '../types/atv';
import type { SubscriptionRequestType } from '../types/subscription';

export type AtvPluginOptions = Record<string, never>;

/**
 * Fetches content by document id from the ATV API.
 *
 * @param atvDocumentId - The id of the ATV document
 * @return The content of the document
 */
const atvFetchContentById = async (atvDocumentId: string): Promise<Partial<AtvDocumentType>> => {
  try {
    const response: AxiosResponse<Partial<AtvDocumentType>> = await axios.get(
      `${process.env.ATV_API_URL}/v1/documents/${atvDocumentId}`,
      {
        headers: {
          'x-api-key': process.env.ATV_API_KEY,
        },
      },
    );

    if (response.data?.content) {
      return response.data.content;
    }
    throw new Error('Empty content returned from API');
  } catch (error: unknown) {
    console.error(error);

    throw new Error('Error fetching Document by id');
  }
};

/**
 * Create a document with the given content, return a partial AtvDocumentType.
 *
 * @param content - the content object to be included in the document
 * @param tosFunctionId - the TOS function ID for the document
 * @return the created document
 */
const atvCreateDocument = async (content: object, tosFunctionId: string): Promise<Partial<AtvDocumentType>> => {
  try {
    const timestamp = Math.floor(Date.now() / 1000).toString();

    // ATV automatically deletes the document after deleteAfter date has passed
    const deleteAfter = new Date();
    const maxAge: number = Number(process.env.SUBSCRIPTION_MAX_AGE) || 90; // Default: 90 days
    deleteAfter.setDate(deleteAfter.getDate() + maxAge);

    // Minimal document required by ATV
    const documentObject: Partial<AtvDocumentType> = {
      draft: 'false',
      tos_function_id: tosFunctionId,
      tos_record_id: timestamp,
      delete_after: deleteAfter.toISOString().substring(0, 10),
      content: JSON.stringify(content),
    };

    const response: AxiosResponse<Partial<AtvDocumentType>> = await axios.post(
      `${process.env.ATV_API_URL}/v1/documents/`,
      documentObject,
      {
        headers: {
          'Content-Type': 'multipart/form-data',
          'X-Api-Key': process.env.ATV_API_KEY,
        },
      },
    );

    return response.data;
  } catch (error: unknown) {
    console.error(error);

    throw new Error('Failed to create document. See error log.');
  }
};

/**
 * Updates the delete_after timestamp for an ATV document.
 * Fetches the existing document first to preserve all content and required fields.
 *
 * @param atvDocumentId - The id of the ATV document to update
 * @param maxAge - The number of days until deletion (defaults to SUBSCRIPTION_MAX_AGE env var or 90)
 * @param fromDate - The date to calculate deletion from (defaults to current date)
 * @return The updated document
 */
const atvUpdateDocumentDeleteAfter = async (
  atvDocumentId: string,
  maxAge?: number,
  fromDate?: Date,
): Promise<Partial<AtvDocumentType>> => {
  try {
    // First, fetch the existing document to preserve all content
    const existingDocResponse: AxiosResponse<Partial<AtvDocumentType>> = await axios.get(
      `${process.env.ATV_API_URL}/v1/documents/${atvDocumentId}`,
      {
        headers: {
          'x-api-key': process.env.ATV_API_KEY,
        },
      },
    );

    // Calculate new delete_after date
    const deleteAfter = fromDate ? new Date(fromDate) : new Date();
    const daysUntilDeletion: number = maxAge || Number(process.env.SUBSCRIPTION_MAX_AGE) || 90;
    deleteAfter.setDate(deleteAfter.getDate() + daysUntilDeletion);

    const existingDoc = existingDocResponse.data;

    const updateObject: Partial<AtvDocumentType> = {
      tos_function_id: existingDoc.tos_function_id,
      tos_record_id: existingDoc.tos_record_id,
      content: existingDoc.content,
      draft: existingDoc.draft,
      delete_after: deleteAfter.toISOString().substring(0, 10),
    };

    const response: AxiosResponse<Partial<AtvDocumentType>> = await axios.patch(
      `${process.env.ATV_API_URL}/v1/documents/${atvDocumentId}`,
      updateObject,
      {
        headers: {
          'Content-Type': 'application/json',
          'X-Api-Key': process.env.ATV_API_KEY,
        },
      },
    );

    return response.data;
  } catch (error: unknown) {
    console.error(error);

    throw new Error('Failed to update ATV document. See error log.');
  }
};

/**
 * Retrieves a batch of documents for the given emails.
 *
 * @param emails - The array of document ids for which to retrieve documents
 * @return A promise that resolves with a partial array of AtvDocumentType objects
 */
const atvGetDocumentBatch = async (emails: string[]): Promise<Partial<AtvDocumentType[]>> => {
  try {
    const documentObject: AtvDocumentBatchType = {
      document_ids: emails,
    };

    const response: AxiosResponse<Partial<AtvDocumentType[]>> = await axios.post(
      `${process.env.ATV_API_URL}/v1/documents/batch-list/`,
      documentObject,
      {
        headers: {
          'Content-Type': 'application/json',
          'X-Api-Key': process.env.ATV_API_KEY,
        },
      },
    );

    return response.data;
  } catch (_error: unknown) {
    throw new Error('Failed to fetch document. See error log.');
  }
};

/**
 * Request email hook function.
 * This is a pure storage layer - validation should happen in route handlers.
 *
 * @param request - the request object
 */
const requestEmailHook = async (request: FastifyRequestType) => {
  try {
    // @fixme this should not affect all post requests.
    // Hook only runs on POST requests
    if (request.method !== 'POST') {
      return;
    }

    // If the POST request has 'email' variable, automatically create ATV document
    // and store email and optional SMS there. Only the ATV document Id gets saved in HAV database.
    const body: Partial<SubscriptionRequestType> = request.body as Partial<SubscriptionRequestType>;
    const email: string = (body.email as string)?.trim();
    const sms: string | undefined = body.sms?.trim();

    const atvDocument: Partial<AtvDocumentType> = await atvCreateDocument(
      {
        email: email,
        ...(sms && { sms: sms }),
      },
      'atvCreateDocumentWithEmail',
    );
    const atvDocumentId: string | undefined = atvDocument.id;

    if (atvDocumentId) {
      request.atvResponse = {
        atvDocumentId,
        hasSms: !!sms,
      };
    }

    // Remove SMS from request body after ATV storage (it shouldn't go to MongoDB)
    if (body.sms) {
      delete body.sms;
    }
  } catch (error) {
    console.error('An error occurred:', error);
    throw new Error('Could not create document to ATV. Cannot subscribe.');
  }
};

// @todo: Exposing separate functions that handle ATV
// communication is not the best approach. We should
// create ATV class in src/lib that abstract the API,
// and expose the class as a plugin.
export default fp(async (fastify, _opts) => {
  // Hook handler automatically creates ATV document for the email
  // and sets the returned documentId to atvResponse.email variable
  fastify.addHook('preHandler', requestEmailHook);

  // Expose atvGetDocument function to global scope
  fastify.decorate('atvGetDocument', async function atvGetDocument(atvDocumentId: string) {
    return atvFetchContentById(atvDocumentId);
  });

  // Expose atvCreateDocument function to global scope
  fastify.decorate(
    'atvCreateDocument',
    async function atvCreateDocumentHandler(content: object, tosFunctionId: string) {
      return atvCreateDocument(content, tosFunctionId);
    },
  );

  // Expose atvGetDocumentBatch function to global scope
  fastify.decorate('atvGetDocumentBatch', async function atvGetDocumentBatchHandler(emails: string[]) {
    return atvGetDocumentBatch(emails);
  });

  // Expose atvUpdateDocumentDeleteAfter function to global scope
  fastify.decorate(
    'atvUpdateDocumentDeleteAfter',
    async function atvUpdateDocumentDeleteAfterHandler(atvDocumentId: string, maxAge?: number, fromDate?: Date) {
      return atvUpdateDocumentDeleteAfter(atvDocumentId, maxAge, fromDate);
    },
  );
});

declare module 'fastify' {
  export interface FastifyRequest {
    atvResponse?: AtvResponseType;
  }

  export interface FastifyInstance {
    atvGetDocument(email: string): Promise<Partial<AtvDocumentType>>;
    atvCreateDocument: (content: object, tosFunctionId: string) => Promise<Partial<AtvDocumentType>>;
    atvGetDocumentBatch: (emails: string[]) => Promise<Partial<AtvDocumentType[]>>;
    atvUpdateDocumentDeleteAfter: (
      atvDocumentId: string,
      maxAge?: number,
      fromDate?: Date,
    ) => Promise<Partial<AtvDocumentType>>;
  }
}
