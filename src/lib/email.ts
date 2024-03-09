import { sprightly } from "sprightly";
import { SubscriptionCollectionLanguageType } from "../types/subscription";

const dir = process.env.MAIL_TEMPLATE_PATH || 'dist/templates'

export const confirmationEmail = async (lang: SubscriptionCollectionLanguageType, data: any) => {
	return sprightly('dist/templates/' + dir + '/confirmation_'+ lang +'.html', {
		lang: lang,
		link: data.link,
	})
}
