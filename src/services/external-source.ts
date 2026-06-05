import { ExternalSourceConfig, ExternalSource } from '../config';
import axios from 'axios';
import _ from 'lodash';


export type ExternalSourceSearchResult = {
  id: string;
  propertyValues: Array<{
    propertyName: string;
    propertyType: 'place' | 'contact' | 'hierarchy';
    externalSourceField: string;
    value: string;
  }>;
};

export default class ExternalSourceService {
  public static async search(config: ExternalSourceConfig, searchParams: Record<string, string>):
    Promise<ExternalSourceSearchResult[] | { error: string }> {
    const paramResult = ExternalSourceService.generateRequestParams(searchParams, config.other_filters, config.mapping);
    try {
      const response = await axios.get(`${config.url}/${config.api_endpoint}`,
        {
          auth: { username: 'admin', password: 'secret' },
          params: paramResult,
          timeout: 10 * 1000,
        });
      const apiResult = _.get(response.data, config.resultKey, []);
      const mappedResult = ExternalSourceService.mapAPIResult(apiResult, config.mapping);
      if (mappedResult.length === 0) {
        return { error: 'No results found' };
      }
      return mappedResult;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        console.error('Axios error:', {
          message: error.message,
          response: error.response?.data,
        });
        if (error.response?.status === 404) {
          return { error: 'No results found' };
        }
        return { error: `Failed to get results from ${config.friendly_name}`};
      }
      
      console.error('Unexpected error:', error);
      return { error: `An error occurred while searching ${config.friendly_name}` };
    }
  }

  static mapAPIResult(apiResult: unknown, mapping: ExternalSourceConfig['mapping']): Array<ExternalSourceSearchResult> {
    const result: ExternalSourceSearchResult[] = [];
    if (!Array.isArray(apiResult)) {
      throw new Error(`Expected result to be an array, but got: ${apiResult}`);
    }
    for (const item of apiResult) {
      const id = item.id || item.uuid || 'unknown_id';
      const propertyValues = mapping.map(prop => ({
        propertyName: prop.propertyName,
        propertyType: prop.propertyType,
        externalSourceField: prop.externalSourceField,
        value: _.get(item, prop.path || prop.externalSourceField, '')
      }));
      result.push({ id, propertyValues });
    }

    return result;
  }

  static generateRequestParams(
    params: Record<string, string>,
    otherFilters: ExternalSource['other_filters'],
    mapping: ExternalSourceConfig['mapping']
  ): Record<string, string> {
    if (!mapping || mapping.length === 0) {
      throw new Error('mapping configuration is required to generate query parameters');
    }
    const queryParams = { ...otherFilters };

    for (const [key, value] of Object.entries(params)) {
      const [propertyType, ...propertyNameParts] = key.split('_');
      const propertyName = propertyNameParts.join('_');
      const mappingEntry = mapping.find(
        (m) => m.propertyName === propertyName && m.propertyType === propertyType && m.isFilter
      );
      const payloadKey = mappingEntry?.externalSourceField.split('.').pop();

      if (payloadKey) {
        queryParams[payloadKey] = value;
      } else {
        console.warn(`No mapping found for key: ${key}`);
      }
    }
    return queryParams;
  }
}
