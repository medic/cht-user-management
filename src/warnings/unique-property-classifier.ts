import { ContactProperty } from '../config';
import { IWarningClassifier } from '.';
import Place from '../services/place';
import { IPropertyValue, PropertyValues } from '../property-value';
import { RemotePlace } from '../lib/remote-place-cache';

type PropertyType = 'place' | 'contact';

export default class UniquePropertyClassifier implements IWarningClassifier {
  private readonly propertyType: PropertyType;
  private readonly property: ContactProperty;

  constructor(propertyType: PropertyType, property: ContactProperty) {
    this.propertyType = propertyType;
    this.property = property;
  }

  triggerWarningForPlaces(basePlace: RemotePlace, placesToCompare: RemotePlace[]): RemotePlace[] | undefined {
    const baseValue = this.getPropertyValue(basePlace);
    if (
      !baseValue ||
      !basePlace.stagedPlace ||
      this.shouldSkip(basePlace, baseValue)
    ) {
      return;
    }
    
    const propertyHasParentScope = this.property.unique === 'parent';
    return placesToCompare
      .filter(place => {
        const placeValue = this.getPropertyValue(place);
        return !this.shouldSkip(place, placeValue) && 
          (!propertyHasParentScope || place.lineage[0] === basePlace.lineage[0]) &&
          PropertyValues.isMatch(baseValue, placeValue);
      });
  }

  uniqueKey(place: Place): string {
    return `unique-property~${this.propertyType}~${this.property.property_name}~${place.id}`;
  }

  getWarningString(remotePlaces: RemotePlace[]): string {
    const parentClause = this.property.unique === 'parent' ? ' and same parent' : '';
    const remoteDuplicateIds = remotePlaces.map(remotePlace => remotePlace.id);
    if (remoteDuplicateIds.length) {
      const idString = JSON.stringify(remoteDuplicateIds);
      return `A place with the same "${this.property.friendly_name}"${parentClause} exists on the instance. ID "${idString}"`;
    }
  
    return `Multiple staged entries have the same "${this.property.friendly_name}"${parentClause}`;
  }

  private shouldSkip(remotePlace: RemotePlace, value?: IPropertyValue): boolean {
    if (remotePlace.stagedPlace) {
      return !!(
        value?.validationError?.length || // warnings are not shown when there are errors
        (remotePlace?.stagedPlace?.isReplacement && !value?.formatted) // falsy properties should be skipped during replacement
      );
    }
  
    // remote places are of the type of the place, not of the type of the contact
    // therefore, they can be discarded when doing contact-based comparisons
    return this.propertyType === 'contact';
  }
  
  private getPropertyValue(remotePlace: RemotePlace): IPropertyValue | undefined {
    const source = this.propertyType === 'place' ? remotePlace.uniquePlaceValues : remotePlace.uniqueContactValues;
    return source?.[this.property.property_name];
  }
}
