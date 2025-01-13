import NodeCache from 'node-cache';
import _ from 'lodash';

import Place, { FormattedPropertyCollection } from '../services/place';
import { ChtApi } from './cht-api';
import { IPropertyValue, RemotePlacePropertyValue } from '../property-value';
import { Config, ContactProperty, ContactType, HierarchyConstraint } from '../config';

export type RemotePlace = {
  id: string;
  name: IPropertyValue;
  lineage: string[];
  ambiguities?: RemotePlace[];
  placeType: string;
  uniquePlaceValues: FormattedPropertyCollection;

  // these are expensive to fetch on remote places; but are available on staged places
  uniqueContactValues?: FormattedPropertyCollection;

  // sadly, sometimes invalid or uncreated objects "pretend" to be remote
  // should reconsider this naming
  type: 'remote' | 'local' | 'invalid';
  stagedPlace?: Place;
};

export default class RemotePlaceCache {
  private static cache: NodeCache;
  private static readonly CACHE_TTL = 3600;
  private static readonly CACHE_CHECK_PERIOD = 120;
  
  public static async getPlacesWithType(chtApi: ChtApi, contactType: ContactType, hierarchyLevel: HierarchyConstraint)
    : Promise<RemotePlace[]> {
    const { domain } = chtApi.chtSession.authInfo;
    const placeType = hierarchyLevel.contact_type;
    const cacheKey = this.getCacheKey(domain, placeType);
  
    let places = this.getCache().get<RemotePlace[]>(cacheKey);
    if (!places) {
      places = await this.getRemotePlaces(chtApi, contactType, hierarchyLevel);
      this.getCache().set(cacheKey, places);
    }
    return places;
  }

  private static getCache(): NodeCache {
    if (!this.cache) {
      this.cache = new NodeCache({ 
        stdTTL: this.CACHE_TTL,
        checkperiod: this.CACHE_CHECK_PERIOD 
      });
    }
    return this.cache;
  }

  private static getCacheKey(domain: string, placeType: string): string {
    return `${domain}:${placeType}`;
  }
  
  public static async getRemotePlaces(chtApi: ChtApi, contactType: ContactType, atHierarchyLevel?: HierarchyConstraint): Promise<RemotePlace[]> {
    const hierarchyLevels = Config.getHierarchyWithReplacement(contactType, 'desc');
    const fetchAll = hierarchyLevels.map(hierarchyLevel => this.fetchCachedOrRemotePlaces(chtApi, hierarchyLevel));
    const allRemotePlaces = _.flatten(await Promise.all(fetchAll));
    if (!atHierarchyLevel) {
      return allRemotePlaces;
    }

    return allRemotePlaces.filter(remotePlace => remotePlace.placeType === atHierarchyLevel.contact_type);
  }

  public static add(place: Place, chtApi: ChtApi): void {
    const { domain } = chtApi.chtSession.authInfo;
    const placeType = place.type.name;
    const cacheKey = this.getCacheKey(domain, placeType);
    
    const places = this.getCache().get<RemotePlace[]>(cacheKey) || [];
    
    if (places.length === 0) {
      places.push(place.asRemotePlace());
      this.getCache().set(cacheKey, places);
    }
  }

  public static clear(chtApi: ChtApi, contactTypeName?: string): void {
    const domain = chtApi?.chtSession?.authInfo?.domain;
    if (!domain) {
      this.getCache().flushAll();
      return;
    }

    if (!contactTypeName) {
      // Clear all keys matching domain prefix
      const keys = this.getCache().keys();
      const domainPrefix = `${domain}:`;
      keys.forEach(key => {
        if (key.startsWith(domainPrefix)) {
          this.getCache().del(key);
        }
      });
    } else {
      const cacheKey = this.getCacheKey(domain, contactTypeName);
      this.getCache().del(cacheKey);
    }
  }

  // check if places are known and if they aren't, fetch via api
  private static async fetchCachedOrRemotePlaces(chtApi: ChtApi, hierarchyLevel: HierarchyConstraint)
    : Promise<RemotePlace[]> {
    const { domain } = chtApi.chtSession.authInfo;
    const placeType = hierarchyLevel.contact_type;
    const cacheKey = this.getCacheKey(domain, placeType);
    
    const cacheData = this.getCache().get<RemotePlace[]>(cacheKey);
    if (!cacheData) {
      const fetchPlacesWithType = this.fetchRemotePlacesAtLevel(chtApi, hierarchyLevel);
      const places = await fetchPlacesWithType;
      this.getCache().set(cacheKey, places);
      return places;
    }
    return cacheData;
  }

  // fetch docs of type and convert to RemotePlace
  private static async fetchRemotePlacesAtLevel(chtApi: ChtApi, hierarchyLevel: HierarchyConstraint): Promise<RemotePlace[]> {
    const uniqueKeyProperties = Config.getUniqueProperties(hierarchyLevel.contact_type);
    const docs = await chtApi.getPlacesWithType(hierarchyLevel.contact_type);
    return docs.map((doc: any) => this.convertContactToRemotePlace(doc, uniqueKeyProperties, hierarchyLevel));
  }

  private static convertContactToRemotePlace(doc: any, uniqueKeyProperties: ContactProperty[], hierarchyLevel: HierarchyConstraint): RemotePlace {
    const uniqueKeyStringValues: FormattedPropertyCollection = {};
    for (const property of uniqueKeyProperties) {
      const value = doc[property.property_name];
      if (value) {
        uniqueKeyStringValues[property.property_name] = new RemotePlacePropertyValue(value, property);
      }
    }

    return {
      id: doc._id,
      name: new RemotePlacePropertyValue(doc.name, hierarchyLevel),
      placeType: hierarchyLevel.contact_type,
      lineage: this.extractLineage(doc),
      uniquePlaceValues: uniqueKeyStringValues,
      type: 'remote',
    };
  }

  private static extractLineage(doc: any): string[] {
    if (doc?.parent) {
      return [doc.parent._id, ...this.extractLineage(doc.parent)];
    }

    return [];
  }

  // For testing purposes
  public static hasData(domain: string, placeType: string): boolean {
    const cacheKey = this.getCacheKey(domain, placeType);
    
    return !!this.getCache().get(cacheKey);
  }
}
