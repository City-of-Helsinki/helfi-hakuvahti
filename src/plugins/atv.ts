import fp from 'fastify-plugin'
import axios, { AxiosResponse } from 'axios'
import { 
  AtvDocumentType,
  AtvResponse } from '../types/atv'
import { SubscriptionRequestType } from '../types/subscription'
import { FastifyRequest } from 'fastify/types/request'

export interface AtvPluginOptions {
}

/**
 * Fetches content by document id from the ATV API.
 *
 * @param {string} atvDocumentId - The id of the ATV document
 * @return {Promise<Partial<AtvDocumentType>>} The content of the document
 */
const atvFetchContentById = async (atvDocumentId: string): Promise<Partial<AtvDocumentType>> => {
  try {
    const response: AxiosResponse<Partial<AtvDocumentType>> = await axios.get(`${process.env.ATV_API_URL}/v1/documents/${atvDocumentId}`, {
      headers: {
        'x-api-key': process.env.ATV_API_KEY
      }
    })

    if (response.data && response.data.content) {
      return response.data.content
    } else {
      throw new Error('Empty content returned from API')
    }
  } catch (error: unknown) {
    console.log(error);

    throw new Error('Error fetching Document by id')
  }
}

/**
 * Creates a document with the provided email address.
 *
 * @param {string} email - The email address to associate with the document
 * @return {Promise<Partial<AtvDocumentType>>} The partially created AtvDocumentType object
 */
const atvCreateDocumentWithEmail = async (email: string): Promise<Partial<AtvDocumentType>> => {
  try {
    const timestamp = Math.floor(Date.now() / 1000).toString()

    // ATV automatically deleted the document after deleteAfter date has passed
    const deleteAfter = new Date()
    const maxAge: number = +process.env.SUBSCRIPTION_MAX_AGE!
    deleteAfter.setDate(deleteAfter.getDate() + maxAge)

    // Minimal document required by ATV
    const documentObject: Partial<AtvDocumentType> = {
      'draft': 'false',
      'tos_function_id': 'atvCreateDocumentWithEmail',
      'tos_record_id': timestamp,
      'delete_after': deleteAfter.toISOString().substring(0, 10),
      'content': JSON.stringify({
        'email': email
      })
    }

    const response: AxiosResponse<Partial<AtvDocumentType>> = await axios.post(
      `${process.env.ATV_API_URL}/v1/documents/`,
      documentObject,
      {
        headers: {
          'Content-Type': 'multipart/form-data',
          'X-Api-Key': process.env.ATV_API_KEY
        }
      }
    )

    return response.data;
  } catch (error: unknown) {
    console.log(error)

    throw new Error('Failed to create document. See error log.')
  }
}

/**
 * Asynchronously handles a request and creates a document with an email for ATV.
 *
 * @param {FastifyRequest} request - the request object
 * @return {Promise<void>} 
 */
const requestEmailHook = async (request: FastifyRequest) => {
  try {
    // Hook only runs on POST requests
    if (request.method !== 'POST') {
      return
    }

    // If the POST request has 'email' variable, automatically create ATV document
    // and store email there. Only the ATV document Id gets saved in HAV database.
    const body: Partial<SubscriptionRequestType> = request.body as Partial<SubscriptionRequestType>
    const email: string = body.email as string

    if (!email) {
      return
    }

    const atvDocument: Partial<AtvDocumentType> = await atvCreateDocumentWithEmail(email)
    const atvDocumentId: string | undefined = atvDocument.id

    if (atvDocumentId) {
      request.atvResponse = {
        atvDocumentId: atvDocumentId,
      }
    }
  } catch (error) {
    console.error('An error occurred:', error)
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
