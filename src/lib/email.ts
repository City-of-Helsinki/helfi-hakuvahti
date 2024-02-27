import { sprightly } from "sprightly";
import { SubscriptionCollectionLanguageType } from "../types/subscription";

// Confirm subscription email:

// TODO: move these to template dir in env

const confirmationEmailTexts_fi = {
	title: 'Vahvista hakuvahdin tilaus sivustolta hel.fi',
	confirmation_link: 'Vahvista hakuvahti'
}
const confirmationEmailTexts_en = {
	title: 'Confirm a saved search on hel.fi',
	confirmation_link: 'Confirm saved search'
}
const confirmationEmailTexts_sv = {
	title: 'Bekräfta beställningen av en sökvakt på webbplatsen till hel.fi',
	confirmation_link: 'Bekräfta sökvakten'
}

type ConfirmationEmailTexts = typeof confirmationEmailTexts_fi

export const confirmationEmail = async (lang: SubscriptionCollectionLanguageType, data: any) => {
	const dir = process.env.MAIL_TEMPLATE_PATH || 'dist/templates'
	console.log(dir)

	let texts: ConfirmationEmailTexts = {
		title: "",
		confirmation_link: ""
	}

	switch (lang) {
		case 'en':
			texts = confirmationEmailTexts_en
			break;
		case 'sv':
			texts = confirmationEmailTexts_sv
			break;
		default:
			texts = confirmationEmailTexts_fi
			break;
	}

	const email = sprightly('dist/templates/' + dir + '/confirmation_'+ lang +'.html', {
		confirmation_link: sprightly('dist/templates/link_text.html', {
			content: texts.confirmation_link,
			link: data.confirmation_link
		})
	})

	return sprightly('dist/templates/index.html', { title: texts.title, content: email })
}
