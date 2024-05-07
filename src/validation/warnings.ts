import { ContactProperty, ContactType } from '../config';
import { ChtApi } from '../lib/cht-api';
import Place from '../services/place';
import RemotePlaceCache, { RemotePlace } from '../lib/remote-place-cache';
import SessionCache from '../services/session-cache';
import { PropertyValues } from '../property-value';

type WarningGroup = {
  property: ContactProperty;
  remotePlaces: RemotePlace[];
  localPlaces: Place[];
};

export default class WarningSystem {
  public static async setWarnings(contactType: ContactType, chtApi: ChtApi, sessionCache: SessionCache): Promise<void> {
    const allRemotePlaces = await RemotePlaceCache.getRemotePlaces(chtApi, contactType);
    const remotePlacesWithType = allRemotePlaces.filter(remotePlace => remotePlace.placeType === contactType.name);
    const localPlacesWithType = sessionCache.getPlaces({ type: contactType.name });

    localPlacesWithType.forEach(place => place.warnings = []);

    const warningGroups = calcWarningGroups(contactType, remotePlacesWithType, localPlacesWithType);
    warningGroups.forEach((duplicateGroup) => {
      setWarningsOnGroup(duplicateGroup, contactType);
    });
  }
}

function calcWarningGroups(contactType: ContactType, remotePlaces: RemotePlace[], localPlaces: Place[]): WarningGroup[] {
  const result: WarningGroup[] = [];
  const allPlaces = [...localPlaces.map(place => place.asRemotePlace()), ...remotePlaces];
  const propertiesWithUniqueness = contactType.place_properties.filter(prop => prop.unique);

  const memory = new WarningGroupMemory();

  allPlaces.forEach((localPlace, i) => {
    if (localPlace.type !== 'local' || !localPlace.stagedPlace) {
      return;
    }

    for (const uniqueProperty of propertiesWithUniqueness) {
      const localValue = localPlace.uniqueKeys[uniqueProperty.property_name];

      if (
        // properties with errors do not also have warnings
        localValue.validationError ||

        // OR there is already a group tracking this place/property combo
        memory.isKnown(localPlace.stagedPlace, uniqueProperty)
      ) {
        continue;
      }

      const propertyHasParentScope = uniqueProperty.unique === 'parent';
      const confirmedDuplicates = allPlaces.slice(i + 1).filter(potential => {
        const potentialDupeValue = potential.uniqueKeys[uniqueProperty.property_name];
        return (!propertyHasParentScope || potential.lineage[0] === localPlace.lineage[0]) &&
          PropertyValues.isMatch(localValue, potentialDupeValue);
      });

      if (confirmedDuplicates.length) {
        const localDuplicates = confirmedDuplicates
          .filter(remotePlace => remotePlace.type === 'local' && remotePlace.stagedPlace)
          .map(remotePlace => remotePlace.stagedPlace) as Place[];

        const warningGroup: WarningGroup = {
          property: uniqueProperty,
          remotePlaces: confirmedDuplicates.filter(remotePlace => remotePlace.type === 'remote'),
          localPlaces: [localPlace.stagedPlace, ...localDuplicates],
        };

        result.push(warningGroup);
        memory.remember(uniqueProperty, ...warningGroup.localPlaces);
      }
    }
  });

  return result;
}

function setWarningsOnGroup(warningGroup: WarningGroup, contactType: ContactType): void {
  const warningString = getWarningString(warningGroup.remotePlaces, contactType, warningGroup.property);
  for (const localPlace of warningGroup.localPlaces) {
    localPlace.warnings.push(warningString);
  }
}

function getWarningString(remotePlaces: RemotePlace[], contactType: ContactType, property: ContactProperty): string {
  const parentClause = property.unique === 'parent' ? ' and same parent' : '';
  const remoteDuplicateIds = remotePlaces.map(remotePlace => remotePlace.id);
  if (remoteDuplicateIds.length) {
    const idString = JSON.stringify(remoteDuplicateIds);
    return `"${contactType.friendly}" with same "${property.friendly_name}"${parentClause} exists on the instance. ID "${idString}"`;
  }

  return `"${contactType.friendly}" with same "${property.friendly_name}"${parentClause} is staged to be created`;
}

class WarningGroupMemory {
  private readonly memory: Set<string> = new Set<string>();

  public remember(prop: ContactProperty, ...places: Place[]): void {
    for (const place of places) {
      const key = this.getKey(place, prop);
      this.memory.add(key);
    }
  }

  public isKnown(place: Place, prop: ContactProperty): boolean {
    const key = this.getKey(place, prop);
    return this.memory.has(key);
  }

  private getKey(place: Place, prop: ContactProperty): string {
    return `${prop.property_name}~${place.id}`;
  }
}
