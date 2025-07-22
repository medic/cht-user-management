import NodeCache from 'node-cache';
import _ from 'lodash';

import Place, { FormattedPropertyCollection } from '../services/place';
import { ChtApi } from './cht-api';
import { IPropertyValue, RemotePlacePropertyValue } from '../property-value';
import { Config, ContactProperty, ContactType, HierarchyConstraint } from '../config';
import { env } from 'process';

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

  private static getCacheTTL() {
    const CACHE_TTL = 60 * 60 * 12; // 12hrs
    return parseInt(env.CACHE_TTL ?? '') ?? CACHE_TTL;
  }

  private static readonly CACHE_CHECK_PERIOD = 120;
  private static cache: NodeCache = new NodeCache({
    stdTTL: this.getCacheTTL(),
    checkperiod: this.CACHE_CHECK_PERIOD
  });

  private static runningFetch: Map<string, Promise<RemotePlace[]>> = new Map();

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

    const places = this.cache.get<RemotePlace[]>(cacheKey);
    if (places) {
      const existingIndex = places.findIndex(p => p.id === place.id);
      if (existingIndex >= 0) {
        places[existingIndex] = place.asRemotePlace();
      } else {
        places.push(place.asRemotePlace());
      }
      this.cache.set(cacheKey, places);
    }
  }

  public static clear(chtApi: ChtApi, contactTypeName?: string): void {
    const domain = chtApi?.chtSession?.authInfo?.domain;
    if (!domain) {
      this.cache.flushAll();
      return;
    }

    if (!contactTypeName) {
      // Clear all keys matching domain prefix
      const keys = this.cache.keys();
      const domainPrefix = `${domain}:`;
      keys
        .filter(key => key.startsWith(domainPrefix))
        .forEach(key => this.cache.del(key));
    } else {
      const cacheKey = this.getCacheKey(domain, contactTypeName);
      this.cache.del(cacheKey);
    }
  }

  // check if places are known and if they aren't, fetch via api
  private static async fetchCachedOrRemotePlaces(chtApi: ChtApi, hierarchyLevel: HierarchyConstraint)
    : Promise<RemotePlace[]> {
    const { domain } = chtApi.chtSession.authInfo;
    const placeType = hierarchyLevel.contact_type;
    const cacheKey = this.getCacheKey(domain, placeType);

    // Check if data is already in cache
    const cacheData = this.cache.get<RemotePlace[]>(cacheKey);
    if (cacheData) {
      return cacheData;
    }

    // Check if a fetch is already in progress
    if (this.runningFetch.has(cacheKey)) {
      return this.runningFetch.get(cacheKey)!;
    }

    // Initiate fetch and store the promise
    const fetchPlaces = async () => {
      const places = await this.fetchRemotePlacesAtLevel(chtApi, hierarchyLevel);
      this.cache.set(cacheKey, places);
      return places;
    };
    const promiseToFetch = fetchPlaces();

    this.runningFetch.set(cacheKey, promiseToFetch);

    try {
      return await promiseToFetch;
    } finally {
      // Delete the promise from the map once resolved
      this.runningFetch.delete(cacheKey);
    }
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
      const value = doc[property.property_name]?.toString();
      if (value) {
        uniqueKeyStringValues[property.property_name] = new RemotePlacePropertyValue(value, property);
      }
    }

    return {
      id: doc._id,
      name: new RemotePlacePropertyValue(doc.name?.toString(), hierarchyLevel),
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
}
