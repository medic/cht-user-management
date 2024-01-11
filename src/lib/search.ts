import _ from "lodash";
import SessionCache from "../services/session-cache";
import { ChtApi, RemotePlace } from "./cht-api";
import RemotePlaceCache from "./remote-place-cache";
import RemotePlaceResolver from "./remote-place-resolver";
import { Config, ContactType, HierarchyConstraint } from "../config";
import Place from "../services/place";

export default class SearchLib {
  public static search = async (contactType: ContactType, formData: any, dataPrefix: string, hierarchyLevel: HierarchyConstraint, chtApi: ChtApi, sessionCache: SessionCache | undefined)
    : Promise<RemotePlace[]> => {
    const searchString: string = formData[`${dataPrefix}${hierarchyLevel?.property_name}`]?.toLowerCase();
    
    const localResults: Place[] = sessionCache ? await getLocalResults(hierarchyLevel, sessionCache, searchString) : [];
    const remoteResults: RemotePlace[] = await getRemoteResults(searchString, hierarchyLevel, contactType, formData, chtApi, dataPrefix);
    
    const searchResults: RemotePlace[] = _.uniqWith([
      ...localResults.map(r => r.asRemotePlace()),
      ...remoteResults,
    ], (placeA: RemotePlace, placeB: RemotePlace) => placeA.name === placeB.name && placeA.type === placeB.type);

    if (searchResults.length === 0) {
      searchResults.push(RemotePlaceResolver.NoResult);
    }

    return searchResults;
  }
};

async function getLocalResults(hierarchyLevel: HierarchyConstraint, sessionCache: SessionCache, searchString: string)
  : Promise<Place[]> {
  if (hierarchyLevel.level == 0) {
    return [];
  }

  const result = sessionCache.getPlaces({
    type: hierarchyLevel.contact_type,
    nameIncludes: searchString,
    created: false,
  });

  return _.sortBy(result, 'name');
}

async function getRemoteResults(searchString: string, hierarchyLevel: HierarchyConstraint, contactType: ContactType, formData: any, chtApi: ChtApi, dataPrefix: string)
  : Promise<RemotePlace[]> {
  const topDownHierarchy = Config.getHierarchyWithReplacement(contactType, 'desc');
  const allResults = await RemotePlaceCache.getPlacesWithType(chtApi, hierarchyLevel.contact_type);
  let remoteResults = allResults.filter(place => place.name.includes(searchString));
  for (const constrainingHierarchy of topDownHierarchy) {
    if (hierarchyLevel.level >= constrainingHierarchy.level) {
      break;
    }

    const searchStringAtLevel = formData[`${dataPrefix}${constrainingHierarchy.property_name}`]?.toLowerCase();
    if (!searchStringAtLevel) {
      continue;
    }

    const placesAtLevel = await RemotePlaceCache.getPlacesWithType(chtApi, constrainingHierarchy.contact_type);
    const relevantPlaceIds = placesAtLevel
      .filter(remotePlace => remotePlace.name.includes(searchStringAtLevel))
      .map(remotePlace => remotePlace.id);
    const hierarchyIndex = constrainingHierarchy.level - hierarchyLevel.level - 1;
    remoteResults = remoteResults.filter(result => relevantPlaceIds.includes(result.lineage[hierarchyIndex]));
  }

  return remoteResults;
}

