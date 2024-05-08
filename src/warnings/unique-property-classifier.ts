import { ContactProperty, ContactType } from '../config';
import { IWarningClassifier } from '.';
import Place from '../services/place';
import { PropertyValues } from '../property-value';
import { RemotePlace } from '../lib/remote-place-cache';

export default class UniquePropertyClassifier implements IWarningClassifier {
  private readonly contactType: ContactType;
  private readonly property: ContactProperty;

  constructor(contactType: ContactType, uniqueProperty: ContactProperty) {
    this.contactType = contactType;
    this.property = uniqueProperty;
  }

  triggerWarningForPlaces(localPlace: RemotePlace, remainingPlaces: RemotePlace[]): RemotePlace[] | undefined {
    const localValue = localPlace.uniqueKeys[this.property.property_name];
    if (
      !localPlace.stagedPlace || // must be a local staged place
      localValue.validationError || // warnings are not shown when there are errors
      (localPlace.stagedPlace.isReplacement && !localValue.original) // falsy properties are skipped during replacement 
    ) {
      return;
    }
    
    const propertyHasParentScope = this.property.unique === 'parent';
    return remainingPlaces.filter(place => {
      const placeValue = place.uniqueKeys[this.property.property_name];
      return (!propertyHasParentScope || place.lineage[0] === localPlace.lineage[0]) &&
        PropertyValues.isMatch(localValue, placeValue);
    });
  }

  uniqueKey(place: Place): string {
    return `unique-property~${this.property.property_name}~${place.id}`;
  }

  getWarningString(remotePlaces: RemotePlace[]): string {
    const parentClause = this.property.unique === 'parent' ? ' and same parent' : '';
    const remoteDuplicateIds = remotePlaces.map(remotePlace => remotePlace.id);
    if (remoteDuplicateIds.length) {
      const idString = JSON.stringify(remoteDuplicateIds);
      return `"${this.contactType.friendly}" with same "${this.property.friendly_name}"${parentClause} exist on the instance. ID "${idString}"`;
    }
  
    return `Multiple "${this.contactType.friendly}" with same "${this.property.friendly_name}"${parentClause} are staged to be created`;
  }
}
