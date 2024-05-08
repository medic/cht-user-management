import { ContactType } from '../config';
import { RemotePlace } from '../lib/remote-place-cache';
import Place from '../services/place';
import { IWarningClassifier } from '.';

export default class RedundantReplaceClassifier implements IWarningClassifier {
  private readonly contactType: ContactType;

  constructor(contactType: ContactType) {
    this.contactType = contactType;
  }

  triggerWarningForPlaces(localPlace: RemotePlace, remainingPlaces: RemotePlace[]): RemotePlace[] | undefined {
    const replacementId = localPlace.stagedPlace?.resolvedHierarchy[0]?.id;
    if (!localPlace.stagedPlace || !replacementId) {
      return;
    }
    
    const confirmedDuplicates = remainingPlaces
      .filter(remaining => remaining.stagedPlace && remaining.stagedPlace?.resolvedHierarchy[0]?.id === replacementId);
    
    if (confirmedDuplicates.length) {
      return confirmedDuplicates;
    }
  }
  
  uniqueKey(place: Place): string {
    return `redundant-replacement~${place.id}`;
  }

  getWarningString(): string {
    return `Multiple entries are replacing the same "${this.contactType.friendly}"`;
  }
}
