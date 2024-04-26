import _ from 'lodash';

import { ContactProperty, ContactType } from '../config';
import { ChtApi } from '../lib/cht-api';
import Place from '../services/place';
import RemotePlaceCache, { RemotePlace } from '../lib/remote-place-cache';
import SessionCache from '../services/session-cache';

export default class WarningSystem {
  public static async assertWarnings(contactType: ContactType, chtApi: ChtApi, sessionCache: SessionCache): Promise<void> {
    const remotePlaces = await RemotePlaceCache.getPlacesWithType(chtApi, contactType.name);
    const localPlaces = sessionCache.getPlaces({ type: contactType.name });
    const propertiesWithUniqueness = contactType.place_properties.filter(prop => prop.unique);

    localPlaces.forEach(place => place.warnings = []);
    for (const property of propertiesWithUniqueness) {
      const duplicateGroups = calcDuplicateGroups(property, remotePlaces, localPlaces);
      Object.entries(duplicateGroups).forEach(([duplicateString, duplicateGroup]) => {
        const duplicatePlaces: Place[] = duplicateGroup.filter((entry: any) => entry instanceof Place) as Place[];
        duplicatePlaces.forEach(duplicatePlace => {
          const warningString = getWarningString(contactType, property, duplicateGroup, duplicatePlace);
          duplicatePlace.warnings.push(warningString);
        });
      });
    }
  }
}

function getWarningString(contactType: ContactType, property: ContactProperty, duplicateGroup: (RemotePlace | Place)[], duplicatePlace: Place): string {
  const [duplicate, multipleDuplicates] = duplicateGroup.filter(dupe => dupe.id !== duplicatePlace.id);
  if (multipleDuplicates) {
    return 'Multiple duplicates found';
  }

  const parentClause = property.unique === 'parent' ? ' and parent' : '';
  if (!(duplicate instanceof Place)) {
    if (duplicate.type === 'remote') {
      return `Another "${contactType.friendly}" with same "${property.friendly_name}"${parentClause} already exists on the instance with id "${duplicate.id}"`;
    }
  } else {
    return `Another "${contactType.friendly}" with same "${property.friendly_name}"${parentClause} is staged to be created`;
  }
  
  throw 'nope';
}

function calcDuplicateGroups(property: ContactProperty, remotePlaces: RemotePlace[], localPlaces: Place[])
  : { [key: string]: (RemotePlace | Place)[] } 
{
  // todo: fuzzing
  const propertyHasParentScope = property.unique === 'parent';
  const localPlacesAsRemotePlace = localPlaces.map(place => place.asRemotePlace()); // lol. sorry
  const relevantPlaces = [...remotePlaces, ...localPlacesAsRemotePlace]
    .filter(remotePlace => !propertyHasParentScope || remotePlace.lineage[0]);

  const placeGroupings = _.groupBy(relevantPlaces, place => {
    const parent = propertyHasParentScope ? `|${place.lineage[0]}|` : '';
    const propValue = place.uniqueKeys[property.property_name]?.toLowerCase();
    return `${parent}${propValue}`; 
  });
  
  const result: { [key: string]: (RemotePlace | Place)[] } = {};
  const groupNamesWithDuplicates = Object.keys(placeGroupings).filter(key => placeGroupings[key].length > 1);
  for (const groupName of groupNamesWithDuplicates) {
    const typedGroupValue: (RemotePlace | Place)[] = placeGroupings[groupName];
    for (let i = 0; i < typedGroupValue.length; ++i) {
      if (typedGroupValue[i].type === 'local') {
        const localPlace = localPlaces.find(place => place.id === typedGroupValue[i].id);
        if (!localPlace) {
          throw Error('invalid program searching for local place');
        }

        typedGroupValue[i] = localPlace;
      }
    }

    result[groupName] = typedGroupValue;
  }
  
  return result;
}

// place already exists
