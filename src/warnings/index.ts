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

  if (!(duplicate instanceof Place)) {
    if (duplicate.type === 'remote') {
      return `Another "${contactType.friendly}" with same "${property.friendly_name}" already exists on the instance with id "${duplicate.id}"`;
    }
  } else {
    return `Another "${contactType.friendly}" with same "${property.friendly_name}" is staged to be created`;
  }
  
  throw 'nope';
}

function calcDuplicateGroups(property: ContactProperty, remotePlaces: RemotePlace[], localPlaces: Place[])
  : { [key: string]: (RemotePlace | Place)[] } 
{
  // todo: fuzzing
  // todo: parent scope
  
  const relevantPlaces = [...remotePlaces, ...localPlaces.map(place => place.asRemotePlace())];
  const groupedByProperty = _.groupBy(relevantPlaces, place => {
    return place.uniqueKeys[property.property_name]?.toLowerCase();
  });
  
  const result: { [key: string]: (RemotePlace | Place)[] } = {};
  const groupNamesWithDuplicates = Object.keys(groupedByProperty).filter(key => groupedByProperty[key].length > 1);
  for (const groupName of groupNamesWithDuplicates) {
    const groupWithLocalPlaces: (RemotePlace | Place)[] = groupedByProperty[groupName];
    for (let i = 0; i < groupWithLocalPlaces.length; ++i) {
      if (groupWithLocalPlaces[i].type === 'local') {
        const localPlace = localPlaces.find(place => place.id === groupWithLocalPlaces[i].id);
        if (!localPlace) {
          throw 'foo';
        }

        groupWithLocalPlaces[i] = localPlace;
      }
    }

    result[groupName] = groupWithLocalPlaces;
  }
  
  return result;
}

// place already exists
