import { sprightly } from "sprightly";
import { SubscriptionCollectionLanguageType } from "../types/subscription";
import { PartialDrupalNodeType } from "../types/elasticproxy";

const dir = process.env.MAIL_TEMPLATE_PATH || 'dist/templates'
const baseUrl: string = process.env.BASE_URL || 'http://localhost:3000';
const removeUrl: string = process.env.REMOVE_CONFIRMATION_LINK || 'http://localhost:3000/subcription/delete';

/**
 * Sends a confirmation email in the specified language with the provided link.
 *
 * @param {SubscriptionCollectionLanguageType} lang - the language for the email
 * @param {{ link: string; }} data - an object containing the link for the email
 * @return {Promise<any>} a promise resolving to the result of sending the confirmation email
 */
export const confirmationEmail = async (lang: SubscriptionCollectionLanguageType, data: { link: string; }) => {
  try {
    return sprightly('dist/templates/' + dir + '/confirmation_' + lang + '.html', {
      lang: lang,
      link: data.link,
    });
  } catch (error) {
    throw error
  }
}

/**
 * Generates a new hits email content based on the provided language and data.
 *
 * @param {SubscriptionCollectionLanguageType} lang - The language of the subscription collection
 * @param {Object} data - An object containing hits, search description, search link, remove link, created date, and number of hits
 * @return {Promise<any>} The generated new hits email content
 */
export const newHitsEmail = async (lang: SubscriptionCollectionLanguageType, data: {
  hits: PartialDrupalNodeType[], 
  search_description: string,
  search_link: string,
  remove_link: string,
  created_date: string,
  num_hits: number }) => {
  try {
    const hitsContent = data.hits.map(item => sprightly('dist/templates/link_text.html', {
      link: baseUrl + item.url,
      content: item.title,
    })).join('')

    return sprightly(`dist/templates/${dir}/newhits_${lang}.html`, {
      lang: lang,
      hits: hitsContent,
      search_link: baseUrl + data.search_link,
      remove_link: removeUrl + data.remove_link,
      search_description: data.search_description,
      created_date: data.created_date
    })
  } catch (error) {
    console.error(error)
    throw error
  }
}
