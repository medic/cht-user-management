import _ from 'lodash';

import { ContactProperty, ContactType } from '../config';
import { ChtApi } from '../lib/cht-api';
import Place from '../services/place';
import RedundantReplaceClassifier from './redundant-replace-classifier';
import RemotePlaceCache, { RemotePlace } from '../lib/remote-place-cache';
import SessionCache from '../services/session-cache';
import UniquePropertyClassifier from './unique-property-classifier';

type Warning = {
  place: Place;
  uniqueKey: string;
  warningString: string;
};

export interface IWarningClassifier {
  triggerWarningForPlaces(basePlace: RemotePlace, placesToCompare: RemotePlace[]): RemotePlace[] | undefined;
  uniqueKey(place: Place): string;
  getWarningString(remotePlaces: RemotePlace[]): string;
}

export default class WarningSystem {
  public static async setWarnings(contactType: ContactType, chtApi: ChtApi, sessionCache: SessionCache): Promise<void> {
    const allRemotePlaces = await RemotePlaceCache.getRemotePlaces(chtApi, contactType);
    const remotePlacesWithType = allRemotePlaces.filter(remotePlace => remotePlace.placeType === contactType.name);
    const localPlacesWithType = sessionCache.getPlaces({ type: contactType.name });

    localPlacesWithType.forEach(place => place.warnings = []);

    const warningClassifiers = WarningSystem.createClassifiers(contactType);
    const warnings = WarningSystem.runClassifiers(warningClassifiers, remotePlacesWithType, localPlacesWithType);
    warnings.forEach(warning => {
      warning.place.warnings.push(warning.warningString);
    });
  }

  private static createClassifiers(contactType: ContactType): IWarningClassifier[] {
    const createUniquePropertyClassifiers = (properties: ContactProperty[], propertyType: 'place' | 'contact') => properties
      .filter(prop => prop.unique)
      .map(prop => new UniquePropertyClassifier(propertyType, prop));

    const classifiers = [
      ...createUniquePropertyClassifiers(contactType.place_properties, 'place'),
      ...createUniquePropertyClassifiers(contactType.contact_properties, 'contact'),
      new RedundantReplaceClassifier(contactType),
    ];

    return classifiers;
  }

  private static runClassifiers(warningClassifiers: IWarningClassifier[], remotePlaces: RemotePlace[], localPlaces: Place[]): Warning[] {
    const warnings: Warning[] = [];
    const knownWarnings = new Set<string>();
    
    // uniq is needed in rare refresh scenarios wherein a place is both local (in the list) and remote (fetched from CHT instance)
    const placesToCompare = _.uniqBy([
      ...localPlaces.map(place => place.asRemotePlace()),
      ...remotePlaces,
    ], 'id');

    while (placesToCompare.length) {
      const basePlace = placesToCompare.shift();
      if (!basePlace?.stagedPlace) {
        continue;
      }
  
      for (const classifier of warningClassifiers) {
        const classifierKey = classifier.uniqueKey(basePlace.stagedPlace);
        if (knownWarnings.has(classifierKey)) {
          continue;
        }
  
        const classified = WarningSystem.runClassifier(classifier, basePlace, placesToCompare);
        if (classified?.length) {
          warnings.push(...classified);
          classified.forEach(warning => knownWarnings.add(warning.uniqueKey));
        }
      }
    }
  
    return warnings;
  }

  private static runClassifier(classifier: IWarningClassifier, basePlace: RemotePlace, placesToCompare: RemotePlace[]): Warning[] | undefined {
    if (!basePlace.stagedPlace) {
      return;
    }
    const implicatedPlaces = classifier.triggerWarningForPlaces(basePlace, placesToCompare);
    if (!implicatedPlaces?.length) {
      return;
    }

    const implicatedLocalPlacesWithoutBase = implicatedPlaces
      .map(remotePlace => remotePlace.stagedPlace)
      .filter(Boolean) as Place[];
    const implicatedLocalPlaces = [basePlace.stagedPlace, ...implicatedLocalPlacesWithoutBase];

    const implicatedRemotePlaces = implicatedPlaces.filter(remotePlace => !remotePlace.stagedPlace);
    return implicatedLocalPlaces.map(place => ({
      place,
      warningString: classifier.getWarningString(implicatedRemotePlaces),
      uniqueKey: classifier.uniqueKey(place),
    }));
  }
}
