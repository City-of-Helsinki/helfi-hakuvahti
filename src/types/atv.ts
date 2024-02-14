import { Static, Type } from '@sinclair/typebox'

export const AtvDocument = Type.Object({
    id: Type.Optional(Type.String()),
    created_at: Type.Optional(Type.String()),
    updated_at: Type.Optional(Type.String()),

    // Status information given by the owning service. Could be e.g. some constant string.
    status: Type.String(),

    // Status display values/translations. It's recommended to use ISO 639-1 language codes as key values.
    status_display_values: Type.Optional(Type.String()),

    // Type information given by the owning service. Could be e.g. the type of the document.
    type: Type.String(),

    // Document type and translations for end user. It's recommended to use ISO 639-1 language codes as key values.
    human_readable_type: Type.Optional(Type.String()),

    // user_id
    user_id: Type.Optional(Type.String()),

    // Transaction identifier given by the owning service. Could be e.g. a UUID.
    transaction_id: Type.Optional(Type.String()),

    // The business ID of the organization which owns this document.
    business_id: Type.Optional(Type.String()),

    // UUID without dashes. Should correspond with a Function instance (e.g. the id from https://api.hel.fi/helerm/v1/function/eb30af1d9d654ebc98287ca25f231bf6/) which is applied to the stored document when considering storage time.
    tos_function_id: Type.String(),

    // UUID without dashes. Should correspond to a record ID (e.g. records[].id from https://api.hel.fi/helerm/v1/function/eb30af1d9d654ebc98287ca25f231bf6/) within a Function instance which is applied to the stored document when considering storage time.
    tos_record_id: Type.String(),

    metadata: Type.Optional(Type.Any()),

    content: Type.Any(),

    // Is this document a draft or not. Drafts can be modified by a user.
    draft: Type.Boolean(),

    // Date and time after which this document cannot be modified, except for deleting. This field should be filled by the calling service if it knows e.g. that a certain application has a deadline.
    // string($date-time)
    locked_after: Type.Optional(Type.String()),

    // Is document deletable by user.
    deletable: Type.Optional(Type.Boolean()),

    // Date which after the document and related attachments are permanently deleted
    delete_after: Type.Optional(Type.String()),

    // ISO 639-1 Language code of document content if known
    document_language: Type.Optional(Type.String()),

    // Link to content schema if available
    content_schema_url: Type.Optional(Type.String()),

    // Attachments
    attachments: Type.Optional(Type.Array(Type.Any()))
})

export type AtvDocumentType = Static<typeof AtvDocument>
