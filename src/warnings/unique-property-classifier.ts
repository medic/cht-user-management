import { ContactProperty, ContactType } from '../config';
import { IWarningClassifier } from '.';
import Place from '../services/place';
import { IPropertyValue, PropertyValues } from '../property-value';
import { RemotePlace } from '../lib/remote-place-cache';

type PropertyType = 'place' | 'contact';

export default class UniquePropertyClassifier implements IWarningClassifier {
  private readonly friendlyContactName: string;
  private readonly propertyType: PropertyType;
  private readonly property: ContactProperty;

  constructor(friendlyContactName: string, propertyType: PropertyType, property: ContactProperty) {
    this.friendlyContactName = friendlyContactName;
    this.propertyType = propertyType;
    this.property = property;
  }

  triggerWarningForPlaces(basePlace: RemotePlace, remainingPlaces: RemotePlace[]): RemotePlace[] | undefined {
    const getPropertyValue = (remotePlace: RemotePlace): IPropertyValue | undefined => {
      const source = this.propertyType === 'place' ? remotePlace.uniquePlaceValues : remotePlace.uniqueContactValues;
      return source?.[this.property.property_name];
    };

    const baseValue = getPropertyValue(basePlace);
    const isSkipable = (remotePlace: RemotePlace, value?: IPropertyValue): boolean => {
      if (remotePlace.type === 'local') {
        return !!(
          value?.validationError?.length || // warnings are not shown when there are errors
          (remotePlace?.stagedPlace?.isReplacement && !value?.formatted) // falsy properties should be skipped during replacement
        );
      }

      // the remote places are of the type of the place, not of the type of the contact
      if (remotePlace.type === 'remote') {
        return this.propertyType === 'contact';
      }

      // do not look at invalid remote place types
      return true;
    };

    if (
      !baseValue || // base must have a value
      !basePlace.stagedPlace || // base must be a local staged place
      isSkipable(basePlace, baseValue)
    ) {
      return;
    }
    
    const propertyHasParentScope = this.property.unique === 'parent';
    return remainingPlaces
      .filter(place => {
        const placeValue = getPropertyValue(place);
        return !isSkipable(place, placeValue) && 
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
      return `"${this.friendlyContactName}" with same "${this.property.friendly_name}"${parentClause} exist on the instance. ID "${idString}"`;
    }
  
    return `Multiple "${this.friendlyContactName}" with same "${this.property.friendly_name}"${parentClause} are staged to be created`;
  }
}
