import _ from 'lodash';

import { ContactProperty, ContactType } from '../config';
import { ChtApi, RemotePlace } from '../lib/cht-api';
import RemotePlaceCache from '../lib/remote-place-cache';
import Place from '../services/place';
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
          const warningString = getWarningString(property, duplicateGroup, duplicatePlace);
          duplicatePlace.warnings.push(warningString);
        });
      });
    }
  }
}

function getWarningString(property: ContactProperty, duplicateGroup: (RemotePlace | Place)[], duplicatePlace: Place): string {
  const [duplicate, multipleDuplicates] = duplicateGroup.filter(dupe => dupe.id !== duplicatePlace.id);
  if (multipleDuplicates) {
    return 'Multiple duplicates found';
  }

  if (!(duplicate instanceof Place)) {
    if (duplicate.type === 'remote') {
      return `"${property.type}" with same "${property.friendly_name}" already exists on the instance with id "${duplicate.id}"`;
    }
  } else {
    return `"${property.type}" with same "${property.friendly_name}" is staged to be created`;
  }
  
  throw 'nope';
}

function calcDuplicateGroups(property: ContactProperty, remotePlaces: RemotePlace[], localPlaces: Place[]) {
  // todo: fuzzing
  // todo: parent scope
  const allPlaces = [...remotePlaces, ...localPlaces];
  const groupedByName = _.groupBy(allPlaces, place => {
    const propertyValue = place.name?.toLowerCase();
    return propertyValue;
    // can ONLY do this on name... because other attributes aren't saved in the remoteplace object
  });
  const duplicates = _.pickBy(groupedByName, group => group.length > 1);
  return duplicates;
}

// place already exists