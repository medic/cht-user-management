import NodeCache from 'node-cache';
import Place from '../services/place';
import {ChtApi, RemotePlace} from './cht-api';

const CACHE_KEY = 'CACHE_REMOTE_PLACE';

type RemotePlacesByType = {
  [key: string]: RemotePlace[];
};

type RemotePlaceDatastore = {
  [key: string]: RemotePlacesByType;
};

export default class RemotePlaceCache {
  // 60 min cache
  private static cache = new NodeCache({
    stdTTL: 60 * 60
  });

  public static async getPlacesWithType(chtApi: ChtApi, placeType: string)
    : Promise<RemotePlace[]> {
    return await RemotePlaceCache.getDomainStore(chtApi, placeType);
  }

  public static async add(place: Place, chtApi: ChtApi): Promise<void> {
    const domainStore = await RemotePlaceCache.getDomainStore(chtApi, place.type.name);
    domainStore.push(place.asRemotePlace());
  }

  public static clear(chtApi: ChtApi, contactTypeName?: string): void {
    const domain = chtApi?.chtSession?.authInfo?.domain;
    let placeCache = RemotePlaceCache.cache.get<RemotePlaceDatastore>(CACHE_KEY);
    if (!placeCache) {
      return;
    }
    if (!domain) {
      placeCache = {};
    } else if (!contactTypeName) {
      delete placeCache[domain];
    } else {
      delete placeCache[domain][contactTypeName];
    }
    RemotePlaceCache.cache.set<RemotePlaceDatastore>(CACHE_KEY, placeCache);
  }

  private static async getDomainStore(chtApi: ChtApi, placeType: string)
    : Promise<RemotePlace[]> {
    const { domain } = chtApi.chtSession.authInfo;
    let domainCache = RemotePlaceCache.cache.get<RemotePlaceDatastore>(CACHE_KEY);
    if (!domainCache) {
      domainCache = {};
    }

    const places = domainCache[domain]?.[placeType];
    if (!places) {
      const fetchPlacesWithType = chtApi.getPlacesWithType(placeType);
      domainCache[domain] = {
        ...domainCache[domain],
        [placeType]: await fetchPlacesWithType,
      };
      RemotePlaceCache.cache.set<RemotePlaceDatastore>(CACHE_KEY, domainCache);
    }

    return domainCache[domain][placeType];
  }
}
