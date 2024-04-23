import { sprightly } from "sprightly";
import { SubscriptionCollectionLanguageType } from "../types/subscription"
import { PartialDrupalNodeType } from "../types/elasticproxy"
import dotenv from 'dotenv'

dotenv.config()

// Base dir for email templates
const dir = process.env.MAIL_TEMPLATE_PATH || 'dist/templates'
console.log(dir)

// Base url for the website (not HAV)
const baseUrl: string = process.env.BASE_URL || 'http://localhost:3000'

// Link to the website to remove subscription
const removeUrl: string = process.env.REMOVE_CONFIRMATION_LINK || 'http://localhost:3000/subcription/delete'

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
      link: baseUrl + data.link,
      search_description: data.search_description,
      remove_link: removeUrl + data.remove_link,
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
