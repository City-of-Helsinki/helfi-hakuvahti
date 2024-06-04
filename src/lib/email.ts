import { sprightly } from "sprightly";
import { SubscriptionCollectionLanguageType } from "../types/subscription"
import { PartialDrupalNodeType } from "../types/elasticproxy"
import dotenv from 'dotenv'

dotenv.config()

// Base dir for email templates
const dir = process.env.MAIL_TEMPLATE_PATH || 'dist/templates'

// Base url for the website (not HAV)
const baseUrl: string = process.env.BASE_URL || 'http://localhost:3000'

// Subscription confirmation email
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

// Notification before subscription expires
export const expiryEmail = async (lang: SubscriptionCollectionLanguageType, data: { 
  link: string, 
  search_description: string,
  removal_date: string,
  remove_link: string }) => {
  try {
    return sprightly('dist/templates/' + dir + '/expiry_notification_' + lang + '.html', {
      lang: lang,
      link: data.link,
      search_description: data.search_description,
      remove_link: data.remove_link,
      removal_date: data.removal_date
    });
  } catch (error) {
    throw error
  }
}

// Email with list of new search monitor hits
export const newHitsEmail = async (lang: SubscriptionCollectionLanguageType, data: {
  hits: PartialDrupalNodeType[], 
  search_description: string,
  search_link: string,
  remove_link: string,
  localized_base_url: string,
  created_date: string }) => {
  try {
    const hitsContent = data.hits.map(item => sprightly('dist/templates/link_text.html', {
      link: baseUrl + item.url,
      content: item.title,
    })).join('')

    return sprightly(`dist/templates/${dir}/newhits_${lang}.html`, {
      lang: lang,
      hits: hitsContent,
      search_link: data.localized_base_url + data.search_link,
      remove_link: data.remove_link,
      search_description: data.search_description,
      created_date: data.created_date
    })
  } catch (error) {
    console.error(error)
    throw error
  }
}
