import _ from 'lodash';

import Place, { FormattedPropertyCollection } from '../services/place';
import { ChtApi } from './cht-api';
import { IPropertyValue, RemotePlacePropertyValue } from '../property-value';
import { Config, ContactProperty, ContactType, HierarchyConstraint } from '../config';

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
  contactId: string;
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
  private static cache: RemotePlaceDatastore = {};

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

    const places = this.cache[domain]?.[placeType];
    // if there is no cache existing, discard the value
    // it will be fetched if needed when the cache is built
    if (places) {
      places.push(place.asRemotePlace());
    }
  }

  public static clear(chtApi: ChtApi, contactTypeName?: string): void {
    const domain = chtApi?.chtSession?.authInfo?.domain;
    if (!domain) {
      this.cache = {};
    } else if (!contactTypeName) {
      delete this.cache[domain];
    } else if (this.cache[domain]) {
      delete this.cache[domain][contactTypeName];
    }
  }

  // check if places are known and if they aren't, fetch via api
  private static async fetchCachedOrRemotePlaces(chtApi: ChtApi, hierarchyLevel: HierarchyConstraint)
    : Promise<RemotePlace[]> {
    const { domain } = chtApi.chtSession.authInfo;
    const placeType = hierarchyLevel.contact_type;
    const { cache: domainCache } = RemotePlaceCache;
    const places = domainCache[domain]?.[placeType];
    if (!places) {
      const fetchPlacesWithType = this.fetchRemotePlacesAtLevel(chtApi, hierarchyLevel);
      if (!domainCache[domain]) {
        domainCache[domain] = {};
      }
      domainCache[domain][placeType] = await fetchPlacesWithType;
    }

    return domainCache[domain][placeType];
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
      contactId: doc.contact?._id || doc.contact,
    };
  }

  private static extractLineage(doc: any): string[] {
    if (doc?.parent) {
      return [doc.parent._id, ...this.extractLineage(doc.parent)];
    }

    return [];
  }
}
