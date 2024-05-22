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
    const replacementDetails = basePlace.stagedPlace?.resolvedHierarchy[0];
    if (!replacementDetails || replacementDetails.type === 'invalid') {
      return;
    }
    
    const confirmedDuplicates = placesToCompare
      .filter(place => place.type !== 'invalid' && 
        place.stagedPlace && 
        place.stagedPlace?.resolvedHierarchy[0]?.id === replacementDetails.id);

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
