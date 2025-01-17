import _ from 'lodash';
import Place from '../services/place';
import { IPropertyValue } from '../property-value';
import SessionCache from '../services/session-cache';
import { ChtApi } from './cht-api';
import { Config, HierarchyConstraint } from '../config';
import RemotePlaceCache, { RemotePlace } from './remote-place-cache';
import { UnvalidatedPropertyValue } from '../property-value';

type RemotePlaceMap = { [key: string]: RemotePlace };

export type PlaceResolverOptions = {
  fuzz?: boolean;
};

export default class RemotePlaceResolver {
  public static readonly NoResult: RemotePlace = {
    id: 'na',
    name: new UnvalidatedPropertyValue('Place Not Found'),
    placeType: 'invalid',
    type: 'invalid',
    uniquePlaceValues: {},
    lineage: [],
    contactId: '',
  };
  
  public static readonly Multiple: RemotePlace = {
    id: 'multiple',
    name: new UnvalidatedPropertyValue('multiple places'),
    placeType: 'invalid',
    type: 'invalid',
    uniquePlaceValues: {},
    lineage: [],
    contactId: '',
  };

  public static resolve = async (
    places: Place[],
    sessionCache: SessionCache,
    chtApi: ChtApi,
    options?: PlaceResolverOptions
  ) : Promise<void> => {
    for (const place of places) {
      await this.resolveOne(place, sessionCache, chtApi, options);
    }
  };

  public static resolveOne = async (
    place: Place,
    sessionCache: SessionCache,
    chtApi: ChtApi,
    options?: PlaceResolverOptions
  ) : Promise<void> => {
    const topDownHierarchy = Config.getHierarchyWithReplacement(place.type, 'desc');
    const allRemotePlaces = await RemotePlaceCache.getRemotePlaces(chtApi, place.type);
    for (const hierarchyLevel of topDownHierarchy) {
      // #91 - for editing: forget previous resolution
      delete place.resolvedHierarchy[hierarchyLevel.level];

      if (!place.hierarchyProperties[hierarchyLevel.property_name]?.original) {
        continue;
      }
      
      const mapIdToDetails = {};
      if (hierarchyLevel.level > 0) { // no replacing local places
        const searchKeys = getSearchKeys(place, hierarchyLevel.property_name);
        for (const key of searchKeys) {
          const localResult = findLocalPlaces(key, hierarchyLevel.contact_type, sessionCache, options);
          if (localResult) {
            addKeyToMap(mapIdToDetails, key.original, localResult);
          }
        }
      }

      const placesFoundRemote = await findRemotePlacesInHierarchy(place, allRemotePlaces, hierarchyLevel, chtApi);
      placesFoundRemote.forEach(remotePlace => {
        addKeyToMap(mapIdToDetails, remotePlace.name.original, remotePlace);

        if (options?.fuzz) {
          if (remotePlace.name.original !== remotePlace.name.formatted) {
            addKeyToMap(mapIdToDetails, remotePlace.name.formatted, remotePlace);
          }
        }
      });

      const placeName = place.hierarchyProperties[hierarchyLevel.property_name];
      place.resolvedHierarchy[hierarchyLevel.level] = pickFromMapOptimistic(mapIdToDetails, placeName, !!options?.fuzz);
    }
    
    await RemotePlaceResolver.resolveAmbiguousParent(place);
  };

  private static resolveAmbiguousParent = async (place: Place)
    : Promise<void> => {
    const topDownHierarchy = Config.getHierarchyWithReplacement(place.type, 'desc');
    const ambiguousHierarchies = place.resolvedHierarchy
      .map((remotePlace, index) => ({
        index,
        hasAmbiguity: !!remotePlace?.ambiguities?.length,
        remotePlace,
      }))
      .filter(level => level.hasAmbiguity)
      .reverse();

    for (const ambiguousHierarchy of ambiguousHierarchies) {
      for (const disambiguatingLevel of topDownHierarchy) {
        if (disambiguatingLevel.level >= ambiguousHierarchy.index) {
          continue;
        }

        const disambiguatingPlace = place.resolvedHierarchy[disambiguatingLevel.level];
        if (!disambiguatingPlace || disambiguatingPlace.type === 'invalid') {
          continue;
        }

        const disambiguated = ambiguousHierarchy.remotePlace?.ambiguities?.filter(ambiguity => {
          const placeInLineage = ambiguousHierarchy.index - disambiguatingLevel.level - 1;
          return ambiguity.id === disambiguatingPlace.lineage[placeInLineage];
        });

        if (disambiguated?.length === 1) {
          place.resolvedHierarchy[ambiguousHierarchy.index] = disambiguated[0];
        }
      }
    }
  };
}

async function findRemotePlacesInHierarchy(
  place: Place,
  remotePlaces: RemotePlace[],
  hierarchyLevel: HierarchyConstraint,
  chtApi: ChtApi
) : Promise<RemotePlace[]> {
  let searchPool = remotePlaces
    .filter(remotePlace => remotePlace.placeType === hierarchyLevel.contact_type)
    .filter(remotePlace => chtApi.chtSession.isPlaceAuthorized(remotePlace));

  const topDownHierarchy = Config.getHierarchyWithReplacement(place.type, 'desc');
  for (const { level } of topDownHierarchy) {
    if (level <= hierarchyLevel.level) {
      break;
    }

    const hierarchyAtLevel = place.resolvedHierarchy[level];
    if (!hierarchyAtLevel) {
      continue;
    }

    const idsAtLevel = [
      hierarchyAtLevel?.id,
      ...(hierarchyAtLevel?.ambiguities?.map(a => a.id) || [])
    ];

    searchPool = searchPool.filter(candidate => {
      const lineageIndex = level - hierarchyLevel.level - 1;
      const nthParent = candidate.lineage?.[lineageIndex];
      return !nthParent || idsAtLevel.includes(nthParent);
    });
  }
  
  return searchPool;
}

function getSearchKeys(place: Place, searchPropertyName: string)
  : IPropertyValue[] {
  const keys = [];
  const key = place.hierarchyProperties[searchPropertyName];
  if (key) {
    keys.push(key);
  }
  
  return _.uniqBy(keys, 'formatted');
}

function pickFromMapOptimistic(map: RemotePlaceMap, placeName: IPropertyValue, fuzz: boolean)
  : RemotePlace | undefined {
  if (!placeName) {
    return;
  }

  const result = map[placeName.original.toLowerCase()];
  if (!fuzz) {
    return result;
  }

  const fuzzyResult = map[placeName.formatted.toLowerCase()];
  const [optimisticResult] = [result, fuzzyResult].filter(r => r && r.type !== 'invalid');
  return optimisticResult || result || fuzzyResult || RemotePlaceResolver.NoResult;
}

function findLocalPlaces(
  name: IPropertyValue,
  type: string,
  sessionCache: SessionCache,
  options: PlaceResolverOptions | undefined
): RemotePlace | undefined {
  let places = sessionCache.getPlaces({ type, nameExact: name.original });

  if (options?.fuzz && !places.length) {
    places = sessionCache.getPlaces({ type, nameExact: name.formatted });
  }

  if (places.length > 1) {
    return {
      ...RemotePlaceResolver.Multiple,
      ambiguities: places.map(p => p.asRemotePlace()),
    };
  }

  return places?.[0]?.asRemotePlace();
}

function addKeyToMap(map: RemotePlaceMap, key: string, value: RemotePlace) {
  const lowercaseKey = key.toLowerCase();
  const existing = map[lowercaseKey];
  if (existing && existing.id !== value.id) {
    if (existing.id !== RemotePlaceResolver.Multiple.id) {
      map[lowercaseKey] = {
        ...RemotePlaceResolver.Multiple,
        ambiguities: [existing],
      };
    }

    const { ambiguities } = map[lowercaseKey];
    const existingAmbiguity = ambiguities?.find(ambiguity => ambiguity.id === value.id);
    if (!existingAmbiguity) {
      ambiguities?.push(value);
    }

    return;
  }

  map[lowercaseKey] = value;
}
