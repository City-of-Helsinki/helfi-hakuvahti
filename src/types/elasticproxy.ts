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

export const ElasticProxyResponse = Type.Object({
    took: Type.Number(),
    responses: Type.Array(ElasticProxyResponseItem),
})
export type ElasticProxyResponseType = Static<typeof ElasticProxyResponse>

