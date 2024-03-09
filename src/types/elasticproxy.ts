import { Static, Type } from '@sinclair/typebox'

export const ElasticProxyResponseItem = Type.Object({
    took: Type.Number(),
    timed_out: Type.Boolean(),
    _shards: Type.Object(Type.Unknown()),
    hits: Type.Object(Type.Unknown()),
    aggregations: Type.Object(Type.Unknown()),
    status: Type.Number()
})
export type ElasticProxyResponseItemType = Static<typeof ElasticProxyResponseItem>

export const ElasticProxyResponseHits = Type.Object({
    total: Type.Unknown(),
    max_score: Type.Unknown(),
    hits: Type.Array(ElasticProxyResponseItem),
})
export type ElasticProxyResponseHitsType = Static<typeof ElasticProxyResponseHits>

export const ElasticProxyJsonResponse = Type.Object({
    took: Type.Number(),
    responses: Type.Array(ElasticProxyResponseItem),
})
export type ElasticProxyJsonResponseType = Static<typeof ElasticProxyJsonResponse>

export const PartialDrupalNode = Type.Object({
    _language: Type.String(),
    entity_type: Type.Array(Type.String()),
    url: Type.Array(Type.String()),
    langcode: Type.Array(Type.String()),
    title: Type.String(),
    field_publication_starts: Type.Array(Type.Number())
})
export type PartialDrupalNodeType = Static<typeof PartialDrupalNode>
