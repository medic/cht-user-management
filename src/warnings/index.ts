import { ContactType } from '../config';
import { ChtApi } from '../lib/cht-api';
import Place from '../services/place';
import RedundantReplaceClassifier from './redundant-replace-classifier';
import RemotePlaceCache, { RemotePlace } from '../lib/remote-place-cache';
import SessionCache from '../services/session-cache';
import UniquePropertyClassifier from './unique-property-classifier';

type Warning = {
  triggeredPlace: Place;
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

    const uniquePropertyClassifiers = contactType.place_properties
      .filter(prop => prop.unique)
      .map(prop => new UniquePropertyClassifier(contactType, prop));
    const classifiers = [
      ...uniquePropertyClassifiers,
      new RedundantReplaceClassifier(contactType)
    ];
    const warnings = WarningSystem.runClassifiers(classifiers, remotePlacesWithType, localPlacesWithType);
    warnings.forEach(warning => {
      warning.triggeredPlace.warnings.push(warning.warningString);
    });
  }

  private static runClassifiers(classifiers: IWarningClassifier[], remotePlaces: RemotePlace[], localPlaces: Place[]): Warning[] {
    const result: Warning[] = [];
    const allPlaces = [...localPlaces.map(place => place.asRemotePlace()), ...remotePlaces];
    const memory = new Set<string>();
  
    allPlaces.forEach((localPlace, i) => {
      if (localPlace.type !== 'local' || !localPlace.stagedPlace) {
        return;
      }
  
      const remainingPlaces = allPlaces.slice(i + 1);
      for (const classifier of classifiers) {
        const classifierKey = classifier.uniqueKey(localPlace.stagedPlace);
  
        if (memory.has(classifierKey)) {
          return;
        }
  
        const implicatedPlaces = classifier.triggerWarningForPlaces(localPlace, remainingPlaces);
        if (implicatedPlaces?.length) {
          const affectedLocalPlaces = implicatedPlaces
            .filter(remotePlace => remotePlace.type === 'local' && remotePlace.stagedPlace)
            .map(remotePlace => remotePlace.stagedPlace) as Place[];

          const implicatedRemotePlaces = implicatedPlaces.filter(remotePlace => remotePlace.type === 'remote');
          const triggeredPlaces = [localPlace.stagedPlace, ...affectedLocalPlaces];
          const warnings = triggeredPlaces.map(triggeredPlace => ({
            triggeredPlace,
            warningString: classifier.getWarningString(implicatedRemotePlaces),
            uniqueKey: classifier.uniqueKey(triggeredPlace),
          }));

          result.push(...warnings);
          warnings.forEach(warning => memory.add(warning.uniqueKey));
        }
      }
    });
  
    return result;
  }
}
