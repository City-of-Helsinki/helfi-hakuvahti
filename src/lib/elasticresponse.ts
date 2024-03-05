export const groupResponseAggs = (responses: any): any => {
    const [aggs, taskAreas, employmentOptions, languages, promoted] = responses;

    return {
      error: null,
      taskAreaOptions: taskAreas?.hits?.hits || [],
      taskAreas: aggs?.aggregations?.occupations?.buckets || [],
      employment: aggs?.aggregations?.employment?.buckets || [],
      employmentOptions: employmentOptions?.hits?.hits || [],
      employmentSearchIds: aggs?.aggregations?.employment_search_id?.buckets || [],
      employmentType: aggs?.aggregations?.employment_type?.buckets || [],
      languages: languages?.aggregations?.languages?.buckets || [],
      promoted: promoted?.aggregations?.promoted?.buckets || [],
    }   
}
