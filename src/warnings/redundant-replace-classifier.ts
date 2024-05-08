import { ContactType } from '../config';
import { RemotePlace } from '../lib/remote-place-cache';
import Place from '../services/place';
import { IWarningClassifier } from '.';

export default class RedundantReplaceClassifier implements IWarningClassifier {
  private readonly contactType: ContactType;

  constructor(contactType: ContactType) {
    this.contactType = contactType;
  }

  triggerWarningForPlaces(basePlace: RemotePlace, placesToCompare: RemotePlace[]): RemotePlace[] | undefined {
    const replacementId = basePlace.stagedPlace?.resolvedHierarchy[0]?.id;
    if (!basePlace.stagedPlace || !replacementId) {
      return;
    }
    
    const confirmedDuplicates = placesToCompare
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
