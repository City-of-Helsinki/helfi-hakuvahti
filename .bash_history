npm run 
npm run hav:init-mongodb
npm run hav:init-mongodb
n√pm run
npm run
npm run hav:populate-email-queue
npm run hav:populate-email-queue
npm run hav:populate-email-queue
npm run hav:populate-email-queue
npm run hav:populate-email-queue
exit
npm run test
npm run test
npm run 
npm run hav:populate-email-queue && npm run hav:send-emails-in-queue
npm run hav:populate-email-queue && npm run hav:send-emails-in-queue
npm run hav:populate-email-queue && npm run hav:send-emails-in-queue
npm audit
npm audit fix
exit
npm run 
npm run hav:populate-email-queue && npm run hav:send-emails-in-queue
npm audit
npm run hav:migrate-site-id rekry
npm run hav:migrate-site-id rekry
npm run hav:update-schema
npm run hav:update-schema
npm run hav:migrate-site-id rekry
npm run hav:populate-email-queue && npm run hav:send-emails-in-queue
npm run hav:populate-email-queue && npm run hav:send-emails-in-queue
npm run hav:populate-email-queue && npm run hav:send-emails-in-queue
npm run hav:populate-email-queue && npm run hav:send-emails-in-queue
npm run hav:populate-email-queue && npm run hav:send-emails-in-queue
npm run hav:populate-email-queue && npm run hav:send-emails-in-queue
npm run build
npm run 
npm run build:ts
npm run hav:populate-email-queue && npm run hav:send-emails-in-queue
npm run build:ts
npm run hav:populate-email-queue && npm run hav:send-emails-in-queue
npm run hav:populate-email-queue && npm run hav:send-emails-in-queue
npm run hav:populate-email-queue && npm run hav:send-emails-in-queue
exit
npm run
npm run hav:populate-email-queue
npm run hav:populate-email-queue
npm run hav:populate-email-queue
curl -X POST "https://elastic-helfi-rekry.docker.so/job_listings/_search" -H "Content-Type: application/json" -d '{
  "aggs": {
    "field_jobs": {
      "sum": {
        "field": "field_jobs",
        "missing": 1
      }
    },
    "total_count": {
      "cardinality": {
        "field": "field_recruitment_id.keyword"
      }
    }
  },
  "collapse": {
    "field": "field_recruitment_id.keyword",
    "inner_hits": {
      "name": "translations",
      "size": 3
    }
  },
  "from": 0,
  "query": {
    "bool": {
      "filter": [
        {
          "term": {
            "entity_type": "node"
          }
        }
      ],
      "must": [
        {
          "bool": {
            "must_not": {
              "term": {
                "field_promoted": true
              }
            }
          }
        },
        {
          "bool": {
            "should": [
              {
                "match_phrase_prefix": {
                  "field_recruitment_id": "ruotsi"
                }
              },
              {
                "combined_fields": {
                  "query": "ruotsi",
                  "fields": [
                    "title^2",
                    "field_organization^1.5",
                    "field_organization_name",
                    "field_employment"
                  ]
                }
              },
              {
                "wildcard": {
                  "title.keyword": "*ruotsi*"
                }
              }
            ]
          }
        }
      ]
    }
  },
  "sort": [
    {
      "field_publication_starts": {
        "order": "desc"
      }
    },
    "_score"
  ],
  "size": 30
}'
curl -X POST "https://elastic-helfi-rekry.docker.so/job_listings/_search" -H "Content-Type: application/json" -d '{
  "aggs": {
    "field_jobs": {
      "sum": {
        "field": "field_jobs",
        "missing": 1
      }
    },
    "total_count": {
      "cardinality": {
        "field": "field_recruitment_id.keyword"
      }
    }
  },
  "collapse": {
    "field": "field_recruitment_id.keyword",
    "inner_hits": {
      "name": "translations",
      "size": 3
    }
  },
  "from": 0,
  "query": {
    "bool": {
      "filter": [
        {
          "term": {
            "entity_type": "node"
          }
        }
      ],
      "must": [
        {
          "bool": {
            "must_not": {
              "term": {
                "field_promoted": true
              }
            }
          }
        },
        {
          "bool": {
            "should": [
              {
                "match_phrase_prefix": {
                  "field_recruitment_id": "ruotsi"
                }
              },
              {
                "combined_fields": {
                  "query": "ruotsi",
                  "fields": [
                    "title^2",
                    "field_organization^1.5",
                    "field_organization_name",
                    "field_employment"
                  ]
                }
              },
              {
                "wildcard": {
                  "title.keyword": "*ruotsi*"
                }
              }
            ]
          }
        }
      ]
    }
  },
  "sort": [
    {
      "field_publication_starts": {
        "order": "desc"
      }
    },
    "_score"
  ],
  "size": 30
}' --ignore-ssl
curl --help
curl -k -X POST "https://elastic-helfi-rekry.docker.so/job_listings/_search" -H 'Content-Type: application/json' -d '{"aggs":{"field_jobs":{"sum":{"field":"field_jobs","missing":1}},"total_count":{"cardinality":{"field":"field_recruitment_id.keyword"}}},"collapse":{"field":"field_recruitment_id.keyword","inner_hits":{"name":"translations","size":3}},"from":0,"query":{"bool":{"filter":[{"term":{"entity_type":"node"}}],"must":[{"bool":{"must_not":{"term":{"field_promoted":true}}}},{"bool":{"should":[{"match_phrase_prefix":{"field_recruitment_id":"ruotsi"}},{"combined_fields":{"query":"ruotsi","fields":["title^2","field_organization^1.5","field_organization_name","field_employment"]}},{"wildcard":{"title.keyword":"*ruotsi*"}}]}}]}},"sort":[{"field_publication_starts":{"order":"desc"}},"_score"],"size":30}'
curl -k -X POST "https://elastic-helfi-rekry.docker.so/job_listings/_search" -H 'Content-Type: application/json' -d '{"aggs":{"field_jobs":{"sum":{"field":"field_jobs","missing":1}},"total_count":{"cardinality":{"field":"field_recruitment_id.keyword"}}},"collapse":{"field":"field_recruitment_id.keyword","inner_hits":{"name":"translations","size":3}},"from":0,"query":{"bool":{"filter":[{"term":{"entity_type":"node"}}],"must":[{"bool":{"must_not":{"term":{"field_promoted":true}}}},{"bool":{"should":[{"match_phrase_prefix":{"field_recruitment_id":"ruotsi"}},{"combined_fields":{"query":"ruotsi","fields":["title^2","field_organization^1.5","field_organization_name","field_employment"]}},{"wildcard":{"title.keyword":"*ruotsi*"}}]}}]}},"sort":[{"field_publication_starts":{"order":"desc"}},"_score"],"size":30}'
 
curl -k -X POST "https://elastic-helfi-rekry.docker.so/job_listings/_search" -H 'Content-Type: application/json' -d '{"aggs":{"field_jobs":{"sum":{"field":"field_jobs","missing":1}},"total_count":{"cardinality":{"field":"field_recruitment_id.keyword"}}},"collapse":{"field":"field_recruitment_id.keyword","inner_hits":{"name":"translations","size":3}},"from":0,"query":{"bool":{"filter":[{"term":{"entity_type":"node"}}],"must":[{"bool":{"must_not":{"term":{"field_promoted":true}}}},{"bool":{"should":[{"match_phrase_prefix":{"field_recruitment_id":"ruotsi"}},{"combined_fields":{"query":"ruotsi","fields":["title^2","field_organization^1.5","field_organization_name","field_employment"]}},{"wildcard":{"title.keyword":"*ruotsi*"}}]}}]}},"sort":[{"field_publication_starts":{"order":"desc"}},"_score"],"size":30}'
exit
curl -k -X POST "https://elastic-helfi-rekry.docker.so/job_listings/_search" -H 'Content-Type: application/json' -d '{"aggs":{"field_jobs":{"sum":{"field":"field_jobs","missing":1}},"total_count":{"cardinality":{"field":"field_recruitment_id.keyword"}}},"collapse":{"field":"field_recruitment_id.keyword","inner_hits":{"name":"translations","size":3}},"from":0,"query":{"bool":{"filter":[{"term":{"entity_type":"node"}}],"must":[{"bool":{"must_not":{"term":{"field_promoted":true}}}},{"bool":{"should":[{"match_phrase_prefix":{"field_recruitment_id":"ruotsi"}},{"combined_fields":{"query":"ruotsi","fields":["title^2","field_organization^1.5","field_organization_name","field_employment"]}},{"wildcard":{"title.keyword":"*ruotsi*"}}]}}]}},"sort":[{"field_publication_starts":{"order":"desc"}},"_score"],"size":30}'
npm run
npm run hav:populate-email-queue
npm run hav:populate-email-queue
npm run hav:send-emails-in-queue
npm run
npm run hav:populate-email-queue && npm run hav:send-emails-in-queue
npm run hav:populate-email-queue && npm run hav:send-emails-in-queue
npm run hav:populate-email-queue && npm run hav:send-emails-in-queue
curl -k -X POST "https://elastic-helfi-rekry.docker.so/job_listings/_search" -H 'Content-Type: application/json' -d '{"aggs":{"field_jobs":{"sum":{"field":"field_jobs","missing":1}},"total_count":{"cardinality":{"field":"field_recruitment_id.keyword"}}},"collapse":{"field":"field_recruitment_id.keyword","inner_hits":{"name":"translations","size":3}},"from":0,"query":{"bool":{"filter":[{"term":{"entity_type":"node"}}],"must":[{"bool":{"must_not":{"term":{"field_promoted":true}}}},{"bool":{"should":[{"match_phrase_prefix":{"field_recruitment_id":"ruotsi"}},{"combined_fields":{"query":"ruotsi","fields":["title^2","field_organization^1.5","field_organization_name","field_employment"]}},{"wildcard":{"title.keyword":"*ruotsi*"}}]}}]}},"sort":[{"field_publication_starts":{"order":"desc"}},"_score"],"size":30}'
curl -k -X POST "https://elastic-helfi-rekry.docker.so/job_listings/_search" -H 'Content-Type: application/json' -d '{"aggs":{"field_jobs":{"sum":{"field":"field_jobs","missing":1}},"total_count":{"cardinality":{"field":"field_recruitment_id.keyword"}}},"collapse":{"field":"field_recruitment_id.keyword","inner_hits":{"name":"translations","size":3}},"from":0,"query":{"bool":{"filter":[{"term":{"entity_type":"node"}}],"must":[{"bool":{"must_not":{"term":{"field_promoted":true}}}},{"bool":{"should":[{"match_phrase_prefix":{"field_recruitment_id":"ruotsi"}},{"combined_fields":{"query":"ruotsi","fields":["title^2","field_organization^1.5","field_organization_name","field_employment"]}},{"wildcard":{"title.keyword":"*ruotsi*"}}]}}]}},"sort":[{"field_publication_starts":{"order":"desc"}},"_score"],"size":30}'
npm run hav:populate-email-queue && npm run hav:send-emails-in-queue
npm run hav:populate-email-queue && npm run hav:send-emails-in-queue
npm run hav:populate-email-queue && npm run hav:send-emails-in-queue
npm run hav:populate-email-queue && npm run hav:send-emails-in-queue
npm run build:ts
npm run hav:populate-email-queue && npm run hav:send-emails-in-queue
npm run hav:populate-email-queue && npm run hav:send-emails-in-queue
npm run build:ts
npm run hav:populate-email-queue && npm run hav:send-emails-in-queue
npm run build:ts
npm run hav:populate-email-queue && npm run hav:send-emails-in-queue
npm run build:ts
npm run hav:populate-email-queue && npm run hav:send-emails-in-queue
npm run hav:populate-email-queue && npm run hav:send-emails-in-queue
npm run
exit
npm run 
npm run hav:populate-email-queue
exit
make
npm run
npm run hav:populate-email-queue && hav:send-emails-in-queue
npm run hav:populate-email-queue && npm run hav:send-emails-in-queue
npm run hav:populate-email-queue && npm run hav:send-emails-in-queue
npm run hav:populate-email-queue && npm run hav:send-emails-in-queue
npm run hav:populate-email-queue && npm run hav:send-emails-in-queue
npm run build:ts
npm run hav:populate-email-queue && npm run hav:send-emails-in-queue
npm run hav:populate-email-queue && npm run hav:send-emails-in-queue
npm run hav:populate-email-queue && npm run hav:send-emails-in-queue
npm run build:ts
npm run hav:populate-email-queue && npm run hav:send-emails-in-queue
npm run build:ts
npm run hav:populate-email-queue && npm run hav:send-emails-in-queue
npm run hav:populate-email-queue && npm run hav:send-emails-in-queue
npm run build:ts
npm run hav:populate-email-queue && npm run hav:send-emails-in-queue
npm run hav:populate-email-queue && npm run hav:send-emails-in-queue
exit
npm run
npm run hav:populate-email-queue
npm run hav:send-emails-in-queue
npm run build:ts
npm run hav:populate-email-queue
npm run hav:send-emails-in-queue
npm run hav:populate-email-queue
npm run hav:send-emails-in-queue
npm run hav:populate-email-queue
npm run hav:populate-email-queue
npm run hav:send-emails-in-queue
npm run hav:populate-email-queue
npm run hav:send-emails-in-queue
npm run hav:populate-email-queue
npm run hav:send-emails-in-queue
npm run build:ts
npm run hav:populate-email-queue
npm run hav:send-emails-in-queue
npm run hav:populate-email-queue
npm run hav:populate-email-queue
npm run hav:send-emails-in-queue
npm run hav:populate-email-queue
npm run hav:send-emails-in-queue
npm run hav:send-emails-in-queue
npm run hav:populate-email-queue
npm run hav:send-emails-in-queue
npm run hav:populate-email-queue
npm run hav:send-emails-in-queue
npm run hav:populate-email-queue
npm run hav:send-emails-in-queue
exit
npm run build:ts
npm run hav:populate-email-queue
npm run hav:send-emails-in-queue
npm run hav:populate-email-queue
npm run hav:send-emails-in-queue
npm run hav:populate-email-queue
npm run hav:send-emails-in-queue
npm run build:ts
npm run hav:populate-email-queue
npm run hav:populate-email-queue
npm run hav:populate-email-queue
npm run build:ts
npm run hav:populate-email-queue
npm run build:ts
npm run hav:populate-email-queue
npm run hav:send-emails-in-queue
npm run hav:populate-email-queue
npm run hav:send-emails-in-queue
exit
npm run lint:check
npm run lint
git status
npm run build:ts
git add biome.json
git commit .
exit
npm run
npm run hav:populate-email-queue && npm run hav:send-emails-in-queue
npm run
exit
