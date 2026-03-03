import axios, {AxiosRequestConfig, type AxiosResponse} from 'axios';
import type { AtvDocumentBatchType, AtvDocumentType } from '../types/atv';

export interface AtvConfig {
  apiUrl: string;
  apiKey: string;
  defaultMaxAge?: number;
}

/**
 * ATV service.
 */
export class ATV {
  private readonly apiUrl: string;
  private readonly apiKey: string;
  private readonly defaultMaxAge: number;

  static getAtvId(subscription: { atv_id?: string; email?: string; [key: string]: unknown }): string {
    return subscription.atv_id || subscription.email || '';
  }

  constructor(config: AtvConfig) {
    this.apiUrl = config.apiUrl;
    this.apiKey = config.apiKey;
    this.defaultMaxAge = config.defaultMaxAge ?? 90;
  }

  /**
   * Updates the delete_after timestamp for an ATV document.
   * Fetches the existing document first to preserve all content and required fields.
   *
   * @param atvDocumentId - The id of the ATV document to update
   * @param maxAge - The number of days until deletion (defaults to defaultMaxAge from config)
   * @param fromDate - The date to calculate deletion from (defaults to current date)
   * @return The updated document
   */
  async updateDocumentDeleteAfter(
    atvDocumentId: string,
    maxAge?: number,
    fromDate?: Date,
  ): Promise<Partial<AtvDocumentType>> {
    // First, fetch the existing document to preserve all content
    const existingDoc: Partial<AtvDocumentType> = await this.makeRequest('get', `/v1/documents/${atvDocumentId}`)

    // Calculate new delete_after date
    const deleteAfter = fromDate ? new Date(fromDate) : new Date();
    const daysUntilDeletion: number = maxAge || this.defaultMaxAge;
    deleteAfter.setDate(deleteAfter.getDate() + daysUntilDeletion);

    const updateObject: Partial<AtvDocumentType> = {
      tos_function_id: existingDoc.tos_function_id,
      tos_record_id: existingDoc.tos_record_id,
      content: existingDoc.content,
      draft: existingDoc.draft,
      delete_after: deleteAfter.toISOString().substring(0, 10),
    };

    return await this.makeRequest('patch', `/v1/documents/${atvDocumentId}`, updateObject);
  }

  /**
   * Create a document with the given content, return a partial AtvDocumentType.
   *
   * @param content - the content object to be included in the document
   * @param tosFunctionId - the TOS function ID for the document
   * @return the created document
   */
  async createDocument(content: object, tosFunctionId: string): Promise<Partial<AtvDocumentType>> {
    const timestamp = Math.floor(Date.now() / 1000).toString();

    const deleteAfter = new Date();
    deleteAfter.setDate(deleteAfter.getDate() + this.defaultMaxAge);

    const documentObject: Partial<AtvDocumentType> = {
      draft: 'false',
      tos_function_id: tosFunctionId,
      tos_record_id: timestamp,
      delete_after: deleteAfter.toISOString().substring(0, 10),
      content: JSON.stringify(content),
    };

    return await this.makeRequest('post', '/v1/documents/', documentObject, 'multipart/form-data');
  }

  /**
   * Fetches content by document id from the ATV API.
   *
   * @param atvDocumentId - The id of the ATV document
   * @return The content of the document
   */
  async getDocument(atvDocumentId: string): Promise<Partial<AtvDocumentType>> {
    const doc: Partial<AtvDocumentType> = await this.makeRequest('get', `/v1/documents/${atvDocumentId}`);

    if (doc?.content) {
      return doc.content;
    }

    throw new Error('Empty content returned from API');
  }

  /**
   * Retrieves a batch of documents for the given document ids.
   *
   * @param documentIds - The array of document ids for which to retrieve documents
   * @return A promise that resolves with an array of AtvDocumentType objects
   */
  async getDocumentBatch(documentIds: string[]): Promise<Partial<AtvDocumentType[]>> {
    const body: AtvDocumentBatchType = { document_ids: documentIds };
    return await this.makeRequest('post', '/v1/documents/batch-list/', body);
  }

  /**
   * Make ATV request.
   *
   * @param method
   * @param endpoint
   * @param body
   * @param contentType
   * @private
   */
  private async makeRequest<Response, Body = unknown>(method: string, endpoint: string, body?: Body, contentType?: string) {
    const headers: AxiosRequestConfig['headers'] = {
      'X-Api-Key': this.apiKey,
    }

    if (body) {
      headers['Content-Type'] = contentType ?? 'application/json';
    }

    try {
      const response: AxiosResponse<Response> = await axios.request({
        method,
        url: this.apiUrl + endpoint,
        headers,
        data: body,
      });

      return response.data
    }
    catch (error: unknown) {
      throw new Error('ATV request failed', {
        cause: error,
      });
    }
  }

}
