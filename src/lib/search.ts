import _ from 'lodash';
import SessionCache from '../services/session-cache';
import { ChtApi } from './cht-api';
import { PropertyValues } from '../property-value';
import RemotePlaceCache, { RemotePlace } from './remote-place-cache';
import RemotePlaceResolver from './remote-place-resolver';
import { Config, ContactType, HierarchyConstraint } from '../config';
import Place from '../services/place';

export default class SearchLib {
  public static search = async (
    contactType: ContactType,
    formData: any,
    dataPrefix: string,
    hierarchyLevel: HierarchyConstraint,
    chtApi: ChtApi,
    sessionCache: SessionCache | undefined
  ) : Promise<RemotePlace[]> => {
    const searchString: string = formData[`${dataPrefix}${hierarchyLevel?.property_name}`]?.toLowerCase();
    
    const localResults: Place[] = sessionCache ? await getLocalResults(hierarchyLevel, sessionCache, searchString) : [];
    const remoteResults: RemotePlace[] = await getRemoteResults(searchString, hierarchyLevel, contactType, formData, chtApi, dataPrefix);
    
    const searchResults: RemotePlace[] = _.uniqWith([
      ...localResults.map(r => r.asRemotePlace()),
      ...remoteResults,
    ], (placeA: RemotePlace, placeB: RemotePlace) => placeA.name.formatted === placeB.name.formatted && placeA.type === placeB.type);

    if (searchResults.length === 0) {
      searchResults.push(RemotePlaceResolver.NoResult);
    }

    return searchResults;
  };
}

async function getLocalResults(hierarchyLevel: HierarchyConstraint, sessionCache: SessionCache, searchString: string)
  : Promise<Place[]> {
  if (hierarchyLevel.level === 0) {
    return [];
  }

  const result = sessionCache.getPlaces({
    type: hierarchyLevel.contact_type,
    nameIncludes: searchString,
    created: false,
  });

  return _.sortBy(result, 'name');
}

async function getRemoteResults(
  searchString: string,
  hierarchyLevel: HierarchyConstraint,
  contactType: ContactType,
  formData: any,
  chtApi: ChtApi,
  dataPrefix: string
) : Promise<RemotePlace[]> {
  let remoteResults = (await RemotePlaceCache.getRemotePlacesAtLevel(chtApi, contactType, hierarchyLevel))
    .filter(remotePlace => chtApi.chtSession.isPlaceAuthorized(remotePlace))
    .filter(place => PropertyValues.includes(place.name, searchString));

  const topDownHierarchy = Config.getHierarchyWithReplacement(contactType, 'desc');
  for (const constrainingHierarchy of topDownHierarchy) {
    if (hierarchyLevel.level >= constrainingHierarchy.level) {
      break;
    }

    const searchStringAtLevel = formData[`${dataPrefix}${constrainingHierarchy.property_name}`];
    if (!searchStringAtLevel) {
      continue;
    }

    const placesAtLevel = await RemotePlaceCache.getRemotePlacesAtLevel(chtApi, contactType, constrainingHierarchy);
    const relevantPlaceIds = placesAtLevel
      .filter(remotePlace => PropertyValues.includes(remotePlace.name, searchStringAtLevel))
      .map(remotePlace => remotePlace.id);
    const hierarchyIndex = constrainingHierarchy.level - hierarchyLevel.level - 1;
    remoteResults = remoteResults.filter(result => relevantPlaceIds.includes(result.lineage[hierarchyIndex]));
  }

  return remoteResults;
}
