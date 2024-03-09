import { sprightly } from "sprightly";
import { SubscriptionCollectionLanguageType } from "../types/subscription";
import { PartialDrupalNodeType } from "../types/elasticproxy";

const dir = process.env.MAIL_TEMPLATE_PATH || 'dist/templates'
const baseUrl: string = process.env.BASE_URL || 'http://localhost:3000';

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

export const newHitsEmail = async (lang: SubscriptionCollectionLanguageType, data: { hits: PartialDrupalNodeType[] }) => {
  try {
    const hitsContent = data.hits.map(item => sprightly('dist/templates/link_text.html', {
      link: baseUrl + item.url,
      content: item.title,
    })).join('')

    return sprightly(`dist/templates/${dir}/newhits_${lang}.html`, {
      lang,
      hits: hitsContent
    })
  } catch (error) {
    console.error(error)
    throw error
  }
}

