import _ from 'lodash';
import { Config, ContactType, HierarchyConstraint } from '../config';
import Place, { FormattedPropertyCollection } from '../services/place';
import { ChtApi } from './cht-api';
import { IPropertyValue } from '../property-value';

type RemotePlacesByType = {
  [key: string]: RemotePlace[];
};

type RemotePlaceDatastore = {
  [key: string]: RemotePlacesByType;
};

type UniqueKeys = {
  [key: string]: string;
};

export type RemotePlace = {
  id: string;
  name: IPropertyValue;
  lineage: string[];
  uniqueKeys: UniqueKeys;
  ambiguities?: RemotePlace[];

  // sadly, sometimes invalid or uncreated objects "pretend" to be remote
  // should reconsider this naming
  type: 'remote' | 'local' | 'invalid';
};

export default class RemotePlaceCache {
  private static cache: RemotePlaceDatastore = {};

  public static async getPlacesWithType(chtApi: ChtApi, contactType: ContactType, hierarchyLevel: HierarchyConstraint)
    : Promise<RemotePlace[]> {
    const domainStore = await RemotePlaceCache.getDomainStore(chtApi, contactType, hierarchyLevel);
    return domainStore;
  }

  public static add(place: Place, chtApi: ChtApi): void {
    const { domain } = chtApi.chtSession.authInfo;
    const placeType = place.type.name;

    const places = RemotePlaceCache.cache[domain]?.[placeType];
    // if there is no cache existing, discard the value
    // it will be fetched if needed when the cache is built
    if (places) {
      places.push(place.asRemotePlace());
    }
  }

  public static clear(chtApi: ChtApi, contactTypeName?: string): void {
    const domain = chtApi?.chtSession?.authInfo?.domain;
    if (!domain) {
      RemotePlaceCache.cache = {};
    } else if (!contactTypeName) {
      delete RemotePlaceCache.cache[domain];
    } else if (RemotePlaceCache.cache[domain]) {
      delete RemotePlaceCache.cache[domain][contactTypeName];
    }
  }

  private static async getDomainStore(chtApi: ChtApi, contactType: ContactType, hierarchyLevel: HierarchyConstraint)
    : Promise<RemotePlace[]> {
    const { domain } = chtApi.chtSession.authInfo;
    const placeType = hierarchyLevel.contact_type;
    const { cache: domainCache } = RemotePlaceCache;
    const places = domainCache[domain]?.[placeType];
    if (!places) {
      const fetchPlacesWithType = RemotePlaceCache.fetchRemotePlaces(chtApi, contactType, hierarchyLevel);
      domainCache[domain] = {
        ...domainCache[domain],
        [placeType]: await fetchPlacesWithType,
      };
    }

    return domainCache[domain][placeType];
  }

  private static async fetchRemotePlacesAtLevel(chtApi: ChtApi, hierarchyLevel: HierarchyConstraint): Promise<RemotePlace[]> {
    function extractLineage(doc: any): string[] {
      if (doc?.parent) {
        return [doc.parent._id, ...extractLineage(doc.parent)];
      }

      return [];
    }

    const uniqueKeyproperties = Config.getUniqueProperties(hierarchyLevel.contact_type);
    const docs = await chtApi.getPlacesWithType(hierarchyLevel.contact_type);
    return docs.map((doc: any): RemotePlace => {
      const uniqueKeyStringValues: FormattedPropertyCollection = {};
      for (const property of uniqueKeyproperties) {
        const value = doc[property.property_name];
        if (value) {
          uniqueKeyStringValues[property.property_name] = new RemotePlacePropertyValue(value, property);
        }
      }

      return {
        id: doc._id,
        name: new RemotePlacePropertyValue(doc.name, hierarchyLevel),
        lineage: extractLineage(doc),
        uniquePlaceValues: uniqueKeyStringValues,
        type: 'remote',
      };
    });
}
