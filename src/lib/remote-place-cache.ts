import NodeCache from 'node-cache';

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

export type RemotePlace = {
  id: string;
  name: IPropertyValue;
  lineage: string[];
  ambiguities?: RemotePlace[];

  // sadly, sometimes invalid or uncreated objects "pretend" to be remote
  // should reconsider this naming
  type: 'remote' | 'local' | 'invalid';
};

export default class RemotePlaceCache {
  private static cache: NodeCache;

  public static async getPlacesWithType(chtApi: ChtApi, contactType: ContactType, hierarchyLevel: HierarchyConstraint)
    : Promise<RemotePlace[]> {
      const { domain } = chtApi.chtSession.authInfo;
      const placeType = hierarchyLevel.contact_type;
      const cacheKey = this.getCacheKey(domain, placeType);
  
      let places = this.getCache().get<RemotePlace[]>(cacheKey);
      if (!places) {
        places = await this.fetchRemotePlaces(chtApi, contactType, hierarchyLevel);
        this.getCache().set(cacheKey, places);
      }
      return places;
  }

  private static getCache(): NodeCache {
    if (!this.cache) {
      this.cache = new NodeCache({ 
        stdTTL: 3600,
        checkperiod: 120 
      });
    }
    return this.cache;
  }

  private static getCacheKey(domain: string, placeType?: string): string {
    return placeType ? `${domain}:${placeType}` : domain;
  }

  public static add(place: Place, chtApi: ChtApi): void {
    const { domain } = chtApi.chtSession.authInfo;
    const placeType = place.type.name;
    const cacheKey = this.getCacheKey(domain, placeType);
    
    const places = this.getCache().get<RemotePlace[]>(cacheKey);
    if (places) {
      places.push(place.asRemotePlace());
      this.getCache().set(cacheKey, places);
    }
  }

  public static clear(chtApi: ChtApi, contactTypeName?: string): void {
    const domain = chtApi?.chtSession?.authInfo?.domain;
    if (!domain) {
      this.getCache().flushAll();
    } else {
      const cacheKey = this.getCacheKey(domain, contactTypeName);
      this.getCache().del(cacheKey);
    }
  }

  private static async fetchRemotePlaces(chtApi: ChtApi, contactType: ContactType, hierarchyLevel: HierarchyConstraint): Promise<RemotePlace[]> {
    function extractLineage(doc: any): string[] {
      if (doc?.parent) {
        return [doc.parent._id, ...extractLineage(doc.parent)];
      }
    
      return [];
    }

    const docs = await chtApi.getPlacesWithType(hierarchyLevel.contact_type);
    return docs.map((doc: any): RemotePlace => ({
      id: doc._id,
      name: new NamePropertyValue(doc.name, hierarchyLevel),
      lineage: extractLineage(doc),
      type: 'remote',
    }));
  }
}
