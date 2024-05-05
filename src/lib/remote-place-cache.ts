import _ from 'lodash';

import Place from '../services/place';
import { ChtApi } from './cht-api';
import { IPropertyValue } from '../property-value';
import { ContactType, HierarchyConstraint } from '../config';
import { NamePropertyValue } from '../property-value/name-property-value';

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
  ambiguities?: RemotePlace[];
  uniqueKeys: UniqueKeys;

  // sadly, sometimes invalid or uncreated objects "pretend" to be remote
  // should reconsider this naming
  type: 'remote' | 'local' | 'invalid';
};

export default class RemotePlaceCache {
  private static cache: RemotePlaceDatastore = {};

  public static async getRemotePlacesAtLevel(chtApi: ChtApi, contactType: ContactType, hierarchyLevel: HierarchyConstraint)
    : Promise<RemotePlace[]> {
    const domainStore = await RemotePlaceCache.getDomainStore(chtApi, contactType, hierarchyLevel);
    return domainStore;
  }

  public static async getPlacesWithAllTypes(chtApi: ChtApi, contactType: ContactType) {

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

  private static async fetchRemotePlaces(chtApi: ChtApi, contactType: ContactType, hierarchyLevel: HierarchyConstraint): Promise<RemotePlace[]> {
    function extractLineage(doc: any): string[] {
      if (doc?.parent) {
        return [doc.parent._id, ...extractLineage(doc.parent)];
      }
    
      return [];
    }

    const uniqueKeys = contactType.place_properties
      .filter(prop => prop.unique)
      .map(prop => prop.property_name);

    const docs = await chtApi.getPlacesWithType(hierarchyLevel.contact_type);
    return docs.map((doc: any): RemotePlace => ({
      id: doc._id,
      name: new NamePropertyValue(doc.name, hierarchyLevel),
      lineage: extractLineage(doc),
      uniqueKeys: _.pick(doc, uniqueKeys),
      type: 'remote',
    }));
  }
}
