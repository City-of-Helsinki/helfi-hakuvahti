import fp from 'fastify-plugin'
import axios, { AxiosResponse } from 'axios';
import { AtvDocumentType } from '../types/atv';

import { 
  SubscriptionRequestType, 
} from "../types/subscription";

import { FastifyRequest } from 'fastify/types/request';

export interface AtvPluginOptions {
}

interface AtvResponse {
  email: string;
}

/**
 * Fetches content by ID from the ATV API.
 * 
 * @param atvDocumentId The ID of the ATV document to fetch.
 * @returns A promise that resolves with the fetched ATV document data.
 */
const atvFetchContentById = async (atvDocumentId: string): Promise<Partial<AtvDocumentType>> => {
  try {
    const response: AxiosResponse<Partial<AtvDocumentType>> = await axios.get(`${process.env.ATV_API_URL}/v1/documents/${atvDocumentId}`, {
      headers: {
        'x-api-key': process.env.ATV_API_KEY
      }
    });
    return response.data;
  } catch (error: unknown) {
    console.log(error);

    throw new Error('Error fetching content by ID');
  }
}

/**
 * Creates a document with the provided email.
 * @param email - The email to associate with the document.
 * @returns A promise that resolves with the created document.
 */
const atvCreateDocumentWithEmail = async (email: string): Promise<Partial<AtvDocumentType>> => {
    const timestamp = Math.floor(Date.now() / 1000).toString()
    const documentObject: Partial<AtvDocumentType> = {
      'draft': 'false',
      'tos_function_id': 'atvCreateDocumentWithEmail', 
      'tos_record_id': timestamp,
      'content': JSON.stringify({
        'email': email
      })
    }

    // TODO: set expiry date for the document

    try {
      const response: AxiosResponse<Partial<AtvDocumentType>> = await axios.post(
        `${process.env.ATV_API_URL}/v1/documents/`, 
        documentObject, 
        {
          headers: {
          'Content-Type': 'multipart/form-data',
            'X-Api-Key': process.env.ATV_API_KEY
          }
        }
      );

      return response.data;
    } catch (error: unknown) {
      console.log(error)

      throw new Error('Failed to create document. See error log.')
    }
}

const requestEmailHook = async (request: FastifyRequest) => {
  try {
    const body: Partial<SubscriptionRequestType> = <any>request.body
    const email = body.email

    if (!email) {
      return;
    }

    const atvDocument = await atvCreateDocumentWithEmail(email);
    const atvDocumentId = atvDocument.id;

    // If we created the document successfully, set the documentId in the request
    if (atvDocumentId) {
      request.atvResponse = {
        email: atvDocumentId,
      }
    }
  } catch (error) {
    console.error('An error occurred:', error);

    throw new Error('Could not create document to ATV. Cannot subscribe.')
  }
}

export default fp(async (fastify, opts) => {
  // Hook handler automatically creates ATV document for the email
  // and sets the returned documentId to atvResponse.email variable
  fastify.addHook('preHandler', requestEmailHook)

  // Expose atvQueryEmail function to global scope
  fastify.decorate('atvQueryEmail', async function (atvDocumentId: string) {
    return atvFetchContentById(atvDocumentId)
  })

  // Expose atvCreateDocumentWithEmail function to global scope
  fastify.decorate('atvCreateDocumentWithEmail', async function (email: string) {
    return atvCreateDocumentWithEmail(email)
  })

})

declare module 'fastify' {
  export interface FastifyRequest {
    atvResponse?: AtvResponse;
  }

  export interface FastifyInstance {
    atvQueryEmail(email: string): Promise<Partial<AtvDocumentType>>;
    atvCreateDocumentWithEmail: (email: string) => Promise<Partial<AtvDocumentType>>;
  }  
}
