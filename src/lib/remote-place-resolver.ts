import _ from 'lodash';
import Place from '../services/place';
import SessionCache from '../services/session-cache';
import { ChtApi } from './cht-api';
import { Config, ContactType, HierarchyConstraint } from '../config';
import Validation from '../validation';
import RemotePlaceCache, { RemotePlace } from './remote-place-cache';

type RemotePlaceMap = { [key: string]: RemotePlace };

export type PlaceResolverOptions = {
  fuzz?: boolean;
};

export default class RemotePlaceResolver {
  public static readonly NoResult: RemotePlace = { id: 'na', name: 'Place Not Found', type: 'invalid', uniqueKeys: {}, lineage: [] };
  public static readonly Multiple: RemotePlace = { id: 'multiple', name: 'multiple places', type: 'invalid', uniqueKeys: {}, lineage: [] };

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
    for (const hierarchyLevel of topDownHierarchy) {
      // #91 - for editing: forget previous resolution
      delete place.resolvedHierarchy[hierarchyLevel.level];

      if (!place.hierarchyProperties[hierarchyLevel.property_name]) {
        continue;
      }
      
      const fuzzFunction = getFuzzFunction(place, hierarchyLevel, place.type);
      const mapIdToDetails = {};
      if (hierarchyLevel.level > 0) { // no replacing local places
        const searchKeys = getSearchKeys(place, hierarchyLevel.property_name, fuzzFunction, false);
        for (const key of searchKeys) {
          const localResult = findLocalPlaces(key, hierarchyLevel.contact_type, sessionCache, options, fuzzFunction);
          if (localResult) {
            addKeyToMap(mapIdToDetails, key, localResult);
          }
        }
      }

      const placesFoundRemote = await findRemotePlacesInHierarchy(place, hierarchyLevel, chtApi);
      placesFoundRemote.forEach(remotePlace => {
        addKeyToMap(mapIdToDetails, remotePlace.name, remotePlace);

        if (options?.fuzz) {
          const alteredName = fuzzFunction(remotePlace.name);
          if (remotePlace.name !== alteredName) {
            addKeyToMap(mapIdToDetails, alteredName, remotePlace);
          }
        }
      });

      const placeName = place.hierarchyProperties[hierarchyLevel.property_name];
      place.resolvedHierarchy[hierarchyLevel.level] = pickFromMapOptimistic(mapIdToDetails, placeName, fuzzFunction, !!options?.fuzz);
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

function getFuzzFunction(place: Place, hierarchyLevel: HierarchyConstraint, contactType: ContactType) {
  const fuzzingProperty = hierarchyLevel.level === 0 ? contactType.replacement_property : hierarchyLevel;
  if (fuzzingProperty.type === 'generated') {
    throw Error(`Invalid configuration: hierarchy properties cannot be of type "generated".`);
  }

  return (val: string) => Validation.formatSingle(place, fuzzingProperty, val);
}

async function findRemotePlacesInHierarchy(
  place: Place,
  hierarchyLevel: HierarchyConstraint,
  chtApi: ChtApi
) : Promise<RemotePlace[]> {
  let searchPool = await RemotePlaceCache.getPlacesWithType(chtApi, hierarchyLevel.contact_type);
  searchPool = searchPool.filter(remotePlace => chtApi.chtSession.isPlaceAuthorized(remotePlace));

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

function getSearchKeys(place: Place, searchPropertyName: string, fuzzFunction: (key: string) => string, fuzz: boolean)
  : string[] {
  const keys = [];
  const key = place.hierarchyProperties[searchPropertyName];
  if (key) {
    keys.push(key);
  }

  if (fuzz) {
    keys.push(fuzzFunction(key));
  }

  return _.uniq(keys);
}

function pickFromMapOptimistic(map: RemotePlaceMap, placeName: string, fuzzFunction: (key: string) => string, fuzz: boolean)
  : RemotePlace | undefined {
  if (!placeName) {
    return;
  }

  const result = map[placeName.toLowerCase()];
  if (!fuzz) {
    return result;
  }

  const fuzzyName = fuzzFunction(placeName);
  const fuzzyResult = map[fuzzyName.toLowerCase()];
  const [optimisticResult] = [result, fuzzyResult].filter(r => r && r.type !== 'invalid');
  return optimisticResult || result || fuzzyResult || RemotePlaceResolver.NoResult;
}

function findLocalPlaces(
  name: string,
  type: string,
  sessionCache: SessionCache,
  options: PlaceResolverOptions | undefined,
  fuzzFunction: (key: string) => string
): RemotePlace | undefined {
  let places = sessionCache.getPlaces({ type, nameExact: name });

  if (options?.fuzz && !places.length) {
    places = sessionCache.getPlaces({ type, nameExact: fuzzFunction(name) });
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
