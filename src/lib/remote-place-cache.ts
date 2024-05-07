import _ from 'lodash';

import Place, { FormattedPropertyCollection } from '../services/place';
import { ChtApi } from './cht-api';
import { IPropertyValue, RemotePlacePropertyValue } from '../property-value';
import { Config, ContactType, HierarchyConstraint } from '../config';

type RemotePlacesByType = {
  [key: string]: RemotePlace[];
};

type RemotePlaceDatastore = {
  [key: string]: RemotePlacesByType;
};

export type RemotePlace = {
  id: string;
  name: IPropertyValue;
  lineage: string[];
  ambiguities?: RemotePlace[];
  placeType: string;
  uniqueKeys: FormattedPropertyCollection;

  // sadly, sometimes invalid or uncreated objects "pretend" to be remote
  // should reconsider this naming
  type: 'remote' | 'local' | 'invalid';
  stagedPlace?: Place;
};

export default class RemotePlaceCache {
  private static cache: RemotePlaceDatastore = {};

  public static async getRemotePlaces(chtApi: ChtApi, contactType: ContactType, atHierarchyLevel?: HierarchyConstraint): Promise<RemotePlace[]> {
    const hierarchyLevels = Config.getHierarchyWithReplacement(contactType, 'desc');
    const fetchAll = hierarchyLevels.map(hierarchyLevel => RemotePlaceCache.fetchAndCacheRemotePlaces(chtApi, hierarchyLevel));
    const allRemotePlaces = _.flatten(await Promise.all(fetchAll));
    if (!atHierarchyLevel) {
      return allRemotePlaces;
    }
    
    return allRemotePlaces.filter(remotePlace => remotePlace.placeType === atHierarchyLevel.contact_type);
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
    } else {
      delete RemotePlaceCache.cache[domain][contactTypeName];
    }
  }

  private static async fetchAndCacheRemotePlaces(chtApi: ChtApi, hierarchyLevel: HierarchyConstraint)
    : Promise<RemotePlace[]> {
    const { domain } = chtApi.chtSession.authInfo;
    const placeType = hierarchyLevel.contact_type;
    const { cache: domainCache } = RemotePlaceCache;
    const places = domainCache[domain]?.[placeType];
    if (!places) {
      const fetchPlacesWithType = RemotePlaceCache.fetchRemotePlacesAtLevel(chtApi, hierarchyLevel);
      if (!domainCache[domain]) {
        domainCache[domain] = {};
      }
      domainCache[domain][placeType] = await fetchPlacesWithType;
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
        placeType: hierarchyLevel.contact_type,
        lineage: extractLineage(doc),
        uniqueKeys: uniqueKeyStringValues,
        type: 'remote',
      };
    });
  }
}
