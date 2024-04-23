import _ from 'lodash';
import { Config } from '../config';
import Place from '../services/place';
import { ChtApi } from './cht-api';

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
  name: string;
  lineage: string[];
  uniqueKeys: UniqueKeys;
  ambiguities?: RemotePlace[];

  // sadly, sometimes invalid or uncreated objects "pretend" to be remote
  // should reconsider this naming
  type: 'remote' | 'local' | 'invalid';
};

export default class RemotePlaceCache {
  private static cache: RemotePlaceDatastore = {};

  public static async getPlacesWithType(chtApi: ChtApi, placeType: string)
    : Promise<RemotePlace[]> {
    const domainStore = await RemotePlaceCache.getDomainStore(chtApi, placeType);
    return domainStore;
  }

  public static extractUniqueKeys(placeType: string, doc: any): UniqueKeys {
    const uniqueProperties = Config.getUniqueProperties(placeType);
    const toPick = uniqueProperties.map(prop => prop.property_name);
    return _.pick(doc, toPick);
  }

  public static async add(place: Place, chtApi: ChtApi): Promise<void> {
    const domainStore = await RemotePlaceCache.getDomainStore(chtApi, place.type.name);
    domainStore.push(place.asRemotePlace());
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

  private static async getDomainStore(chtApi: ChtApi, placeType: string)
    : Promise<RemotePlace[]> {
    const { domain } = chtApi.chtSession.authInfo;
    const { cache: domainCache } = RemotePlaceCache;

    const places = domainCache[domain]?.[placeType];
    if (!places) {
      const fetchPlacesWithType = RemotePlaceCache.getRemotePlacesWithType(chtApi, placeType);
      domainCache[domain] = {
        ...domainCache[domain],
        [placeType]: await fetchPlacesWithType,
      };
    }

    return domainCache[domain][placeType];
  }

  private static async getRemotePlacesWithType(chtApi: ChtApi, placeType: string): Promise<RemotePlace[]> {
    function extractLineage(doc: any): string[] {
      if (doc?.parent) {
        return [doc.parent._id, ...extractLineage(doc.parent)];
      }
    
      return [];
    }

    const docs = await chtApi.getPlacesWithType(placeType);
    return docs.map((doc: any): RemotePlace => ({
      id: doc._id,
      name: doc.name?.toLowerCase(),
      lineage: extractLineage(doc),
      uniqueKeys: RemotePlaceCache.extractUniqueKeys(placeType, doc),
      type: 'remote',
    }));
  }
}
