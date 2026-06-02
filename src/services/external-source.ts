import { ExternalSourceConfig, ExternalSource } from '../config';
import axios from 'axios';
import _ from 'lodash';


export type ExternalSourceSearchResult = {
  id: string;
  propertyValues: Array<{
    propertyName: string;
    propertyType: 'place' | 'contact' | 'hierarchy';
    externalSourceField: string;
    value: unknown;
  }>;
};

export default class ExternalSourceService {
  public static async search(config: ExternalSourceConfig, searchParams: Record<string, string>):
    Promise<ExternalSourceSearchResult[] | { error: string }> {
    const paramResult = ExternalSourceService.generateRequestParams(searchParams, config.other_filters, config.mapping);
    try {
      //throw new Error('Simulated error for testing');
      const response = await axios.get(`${config.url}/${config.api_endpoint}`,
        {
          params: paramResult,
          timeout: 5000,
        });
      const apiResult = _.get(response.data, config.resultKey);
      return ExternalSourceService.mapAPIResult(apiResult, config.mapping);
    } catch (error) {
      if (axios.isAxiosError(error)) {
        console.error('Axios error:', {
          message: error.message,
          response: error.response?.data,
        });
      } else {
        console.error('Unexpected error:', error);
      }
      return { error: `An error occurred while searching ${config.friendly_name}` };
    }
  }

  static mapAPIResult(apiResult: unknown, mapping: ExternalSourceConfig['mapping']): Array<ExternalSourceSearchResult> {
    const result: ExternalSourceSearchResult[] = [];
    if (!Array.isArray(apiResult)) {
      console.warn('Expected result to be an array, but got:', apiResult);
      return result;
    }
    for (const item of apiResult) {
      const id = item.id || item.uuid || 'unknown_id';
      const propertyValues = mapping.map(prop => ({
        propertyName: prop.propertyName,
        propertyType: prop.propertyType,
        externalSourceField: prop.externalSourceField,
        value: _.get(item, prop.position || prop.externalSourceField)
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
      throw new Error('mapping configuration is required to generate payload');
    }
    const payload = { ...otherFilters };

    for (const [key, value] of Object.entries(params)) {
      const [propertyType, ...propertyNameParts] = key.split('_');
      const propertyName = propertyNameParts.join('_');
      const mappingEntry = mapping.find(
        (m) => m.propertyName === propertyName && m.propertyType === propertyType && m.isFilter
      );
      const payloadKey = mappingEntry?.externalSourceField.split('.').pop();

      if (payloadKey) {
        payload[payloadKey] = value;
      } else {
        console.warn(`No mapping found for key: ${key}`);
      }
    }
    return payload;
  }
}
