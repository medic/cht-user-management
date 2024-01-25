import Place from '../services/place';
import { ChtApi, RemotePlace } from './cht-api';

type RemotePlacesByType = {
  [key: string]: RemotePlace[];
};

type RemotePlaceDatastore = {
  [key: string]: RemotePlacesByType;
};

export default class RemotePlaceCache {
  private static cache: RemotePlaceDatastore = {};

  public static async getPlacesWithType(chtApi: ChtApi, placeType: string)
    : Promise<RemotePlace[]> {
    const domainStore = await RemotePlaceCache.getDomainStore(chtApi, placeType);
    return domainStore;
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
      const fetchPlacesWithType = chtApi.getPlacesWithType(placeType);
      domainCache[domain] = {
        ...domainCache[domain],
        [placeType]: await fetchPlacesWithType,
      };
    }

    return domainCache[domain][placeType];
  }
}
