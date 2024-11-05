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
      const fetchPlacesWithType = await chtApi.getPlacesWithType(placeType);

      const fetchPlacesImmediateParentName = 
        await RemotePlaceCache.getPlaceParentName(chtApi, fetchPlacesWithType);
    
      domainCache[domain] = {
        ...domainCache[domain],
        [placeType]: fetchPlacesImmediateParentName,
      };
    }
    return domainCache[domain][placeType];
  }

  private static async getPlaceParentName(chtApi: ChtApi, places: RemotePlace[])
    : Promise<RemotePlace[]> {
    const immediateLineages = [...new Set(places.map(place => place.lineage[0]))];

    const lineageDetails = await Promise.all(
      immediateLineages.map(lineage => chtApi.getDoc(lineage))
    );

    const lineageMap = new Map(lineageDetails.map(doc => [doc._id, doc]));

    places.forEach(place => {
      const immediateLineage = place.lineage[0];
      const foundLineage = lineageMap.get(immediateLineage);
      place.immediateParentName = foundLineage ? foundLineage.name : '';
    });

    return places;
  }
}
