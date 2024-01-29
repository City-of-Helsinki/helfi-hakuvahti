import { Static, Type } from '@sinclair/typebox'

export const Generic500Error = Type.Object({
    email: Type.String()
})

export type Generic500ErrorType = Static<typeof Generic500Error>
