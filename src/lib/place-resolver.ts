import _ from "lodash";
import Place from "../services/place";
import SessionCache from "../services/session-cache";
import { ChtApi, ParentDetails } from "./cht-api";
import { ContactType } from "./config";
import { Validation } from "./validation";

type ParentDetailsMap = { [key: string]: ParentDetails };
type SearchablePlaceAttributeName = 'replacementName' | 'parentName';

export type PlaceResolverOptions = {
  fuzz?: boolean;
};

export default class PlaceResolver {
  public static readonly NoResult: ParentDetails = { id: "na", name: "Place Not Found" };
  public static readonly Multiple: ParentDetails = { id: 'multiple', name: 'multiple places' };

  public static isParentIdValid(parentId: string | undefined): boolean {
    if (!parentId) {
      return false;
    }

    return ![PlaceResolver.Multiple.id, PlaceResolver.NoResult.id].includes(parentId);
  }

  public static resolve = async (
    places: Place[],
    contactType: ContactType,
    sessionCache: SessionCache,
    chtApi: ChtApi,
    options?: PlaceResolverOptions
  ) : Promise<void> => 
  {
    const parentFuzzFunction = (key: string) => Validation.formatSingle('PARENT', key, contactType);
    const parentMap = await PlaceResolver.doResolve(
      places,
      'parentName',
      false,
      parentFuzzFunction,
      true,
      contactType.parent_type,
      sessionCache,
      chtApi,
      options
    );
    places.forEach(place => {
      place.parentDetails = pickFromMapOptimistic(parentMap, place.parentName, parentFuzzFunction, !!options?.fuzz);
    });

    const replacementPlaces = places.filter(p => p.replacementName);
    const replacementFuzzFunction = (key: string) => Validation.formatSingle('name', key, contactType);
    const replacementMap = await PlaceResolver.doResolve(
      replacementPlaces,
      'replacementName',
      true,
      replacementFuzzFunction,
      false,
      contactType.name,
      sessionCache,
      chtApi,
      options
    );
    replacementPlaces.forEach(place => {
      place.replacement = pickFromMapOptimistic(replacementMap, place.replacementName, replacementFuzzFunction, !!options?.fuzz);
    });

    await PlaceResolver.resolveAmbiguousParent(places, chtApi);
  }

  private static resolveAmbiguousParent = async (places: Place[], chtApi: ChtApi)
    : Promise<void> =>
  {
    for (const place of places) {
      if (!place.replacement || !place.parentDetails?.ambiguities?.length) {
        continue;
      }

      const replacing = await chtApi.getDoc(place.replacement.id);
      const replacementParentId = replacing?.parent?._id;
      const disambiguatedParents = place.parentDetails.ambiguities.filter(a => a.id === replacementParentId);
      if (disambiguatedParents.length === 1) {
        place.parentDetails = disambiguatedParents[0];
      }
    }
  }

  private static doResolve = async (
    places: Place[],
    searchPlaceAttributeName: SearchablePlaceAttributeName,
    searchOnlyUnderParent: boolean,
    fuzzFunc: (key: string) => string,
    includeLocalPlaces: boolean,
    searchPlaceType: string,
    sessionCache: SessionCache,
    chtApi: ChtApi,
    options?: PlaceResolverOptions
  ) : Promise<ParentDetailsMap> => 
  {
    const searchKeys = getSearchKeys(places, searchPlaceAttributeName, fuzzFunc, false);
    const mapIdToDetails: ParentDetailsMap = {};
    if (includeLocalPlaces) {
      for (const key of searchKeys) {
        const localResult = getLocalResult(key, searchPlaceType, sessionCache, options, fuzzFunc);
        if (localResult) {
          addKeyToMap(mapIdToDetails, key, localResult);
        }
      }
    }
    
    const fuzzableSeachKeys = getSearchKeys(places, searchPlaceAttributeName, fuzzFunc, !!options?.fuzz);
    const placesFoundRemote = await findPlaces(places, searchPlaceType, searchOnlyUnderParent, fuzzableSeachKeys, chtApi, fuzzFunc);
    placesFoundRemote.forEach(remotePlace => {
      addKeyToMap(mapIdToDetails, remotePlace.name, remotePlace);

      if (options?.fuzz) {
        const alteredName = fuzzFunc(remotePlace.name);
        if (remotePlace.name !== alteredName) {
          addKeyToMap(mapIdToDetails, alteredName, remotePlace);
        }
      }
    });

    return mapIdToDetails;
  };
}

async function findPlaces(
  places: Place[],
  withPlaceType: string,
  searchOnlyUnderParent: boolean,
  withName: string[],
  chtApi: ChtApi,
  fuzzFunc: (key: string) => string
) : Promise<ParentDetails[]> 
{
  const parentIds: string[] = _.flatten(places.map(place => [
    place.parentDetails?.id, 
    ...(place.parentDetails?.ambiguities?.map(a => a.id) || [])
  ])).filter((p: string | undefined): p is string => !!p);
  const searchPool = await chtApi.getPlacesWithType(withPlaceType, searchOnlyUnderParent ? parentIds : undefined);

  const lowercaseNames = withName.map((name: string) => name.toLowerCase());
  return searchPool.filter(parentDetails => {
    const exactMatch = lowercaseNames.includes(parentDetails.name);
    if (exactMatch || !fuzzFunc) {
      return exactMatch;
    }

    const fuzzyMatch = lowercaseNames.includes(fuzzFunc(parentDetails.name).toLowerCase());
    return fuzzyMatch;
  });
};

function getSearchKeys(
  places: Place[],
  searchPlaceAttributeName: SearchablePlaceAttributeName,
  fuzzFunction: (key: string) => string,
  fuzz: boolean
): string[] {
  const keys = places.map(p => p[searchPlaceAttributeName]).filter((p: string | undefined): p is string => !!p);

  if (fuzz) {
    keys.push(...keys.map(fuzzFunction));
  }

  return _.uniq(keys);
}

function pickFromMapOptimistic(
  map: ParentDetailsMap,
  placeName: string | undefined,
  fuzzFunction: (key: string) => string,
  fuzz: boolean
): ParentDetails | undefined {
  if (!placeName) {
    return;
  }

  const result = map[placeName.toLowerCase()];
  if (!fuzz) {
    return result;
  }

  const fuzzyName = fuzzFunction(placeName);
  const fuzzyResult = map[fuzzyName.toLowerCase()];
  if (!fuzzyResult) {
    return result;
  }

  const [validResult] = [result, fuzzyResult].filter(r => PlaceResolver.isParentIdValid(r?.id));
  return validResult || result;
}

function getLocalResult(name: string, type: string, sessionCache: SessionCache, options: PlaceResolverOptions | undefined, fuzzFunction: (key: string) => string): ParentDetails | undefined {
  let places = sessionCache.getPlaces({ type, nameExact: name });

  if (options?.fuzz && !places.length) {
    places = sessionCache.getPlaces({ type, nameExact: fuzzFunction(name) });
  }

  if (places.length > 1) {
    console.warn(`Found multiple known places for name "${name}"`);
    return {
      ...PlaceResolver.Multiple,
      ambiguities: places,
    };
  }

  return places?.[0]?.asParentDetails();
}

function addKeyToMap (map: ParentDetailsMap, key: string, value: ParentDetails) {
  const lowercaseKey = key.toLowerCase();
  const existing = map[lowercaseKey];
  if (existing && existing.id !== value.id) {
    console.warn(`Found multiple known places for name "${value.name}"`);
    if (PlaceResolver.isParentIdValid(existing.id)) {
      map[lowercaseKey] = {
        ...PlaceResolver.Multiple,
        ambiguities: [existing],
      };
    }

    map[lowercaseKey].ambiguities?.push(value);
    return;
  }

  map[lowercaseKey] = value;
};