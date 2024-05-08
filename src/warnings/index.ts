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
  triggerWarningForPlaces(localPlace: RemotePlace, remainingPlaces: RemotePlace[]): RemotePlace[] | undefined;
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

  private static runClassifiers(warningClassifiers: IWarningClassifier[], remotePlaces: RemotePlace[], localPlaces: Place[]): Warning[] {
    const result: Warning[] = [];
    const knownWarnings = new Set<string>();
    
    const remainingPlaces = [...localPlaces.map(place => place.asRemotePlace()), ...remotePlaces];
    while (remainingPlaces.length) {
      const localPlace = remainingPlaces.shift();
      if (localPlace?.type !== 'local' || !localPlace.stagedPlace) {
        continue;
      }
  
      for (const classifier of warningClassifiers) {
        const classifierKey = classifier.uniqueKey(localPlace.stagedPlace);
        if (knownWarnings.has(classifierKey)) {
          continue;
        }
  
        const warnings = WarningSystem.runClassifer(classifier, localPlace, remainingPlaces);
        if (warnings?.length) {
          result.push(...warnings);
          warnings.forEach(warning => knownWarnings.add(warning.uniqueKey));
        }
      }
    }
  
    return result;
  }

  private static runClassifer(classifier: IWarningClassifier, basePlace: RemotePlace, otherPlaces: RemotePlace[]): Warning[] | undefined {
    const implicatedPlaces = classifier.triggerWarningForPlaces(basePlace, otherPlaces);
    if (!basePlace.stagedPlace || !implicatedPlaces?.length) {
      return;
    }

    const implicatedLocalPlacesWithoutBase = implicatedPlaces
      .filter(remotePlace => remotePlace.type === 'local' && remotePlace.stagedPlace)
      .map(remotePlace => remotePlace.stagedPlace) as Place[];
    const implicatedLocalPlaces = [basePlace.stagedPlace, ...implicatedLocalPlacesWithoutBase];

    const implicatedRemotePlaces = implicatedPlaces.filter(remotePlace => remotePlace.type === 'remote');
    return implicatedLocalPlaces.map(place => ({
      place,
      warningString: classifier.getWarningString(implicatedRemotePlaces),
      uniqueKey: classifier.uniqueKey(place),
    }));
  }

  private static createClassifiers(contactType: ContactType): IWarningClassifier[] {
    const createUniquePropertyClassifiers = (properties: ContactProperty[], propertyType: 'place' | 'contact') => properties
      .filter(prop => prop.unique)
      .map(prop => new UniquePropertyClassifier(contactType.friendly, propertyType, prop));

    const classifiers = [
      ...createUniquePropertyClassifiers(contactType.place_properties, 'place'),
      ...createUniquePropertyClassifiers(contactType.contact_properties, 'contact'),
      new RedundantReplaceClassifier(contactType),
    ];

    return classifiers;
  }
}
