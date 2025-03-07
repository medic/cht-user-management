import { parse } from 'csv';

import { ChtApi } from '../lib/cht-api';
import { Config, ContactProperty, ContactType } from '../config';
import Place, { FormattedPropertyCollection } from './place';
import SessionCache from './session-cache';
import RemotePlaceResolver from '../lib/remote-place-resolver';
import { HierarchyPropertyValue, ContactPropertyValue, IPropertyValue } from '../property-value';
import WarningSystem from '../warnings';

export default class PlaceFactory {
  public static async createFromCsv(csvBuffer: Buffer, contactType: ContactType, sessionCache: SessionCache, chtApi: ChtApi)
    : Promise<Place[]> {
    const places = await PlaceFactory.loadPlacesFromCsv(csvBuffer, contactType);
    await PlaceFactory.finalizePlaces(places, sessionCache, chtApi, contactType);
    return places;
  }

  public static createOne = async (formData: any, contactType: ContactType, sessionCache: SessionCache, chtApi: ChtApi)
    : Promise<Place> => {
    const place = new Place(contactType);
    place.setPropertiesFromFormData(formData, 'hierarchy_');
    await PlaceFactory.finalizePlaces([place], sessionCache, chtApi, contactType);
    return place;
  };

  public static editOne = async (placeId: string, formData: any, sessionCache: SessionCache, chtApi: ChtApi)
    : Promise<Place> => {
    const place = sessionCache.getPlace(placeId);
    if (!place || place.isCreated) {
      throw new Error('unknown place or place has already been created');
    }
    place.setPropertiesFromFormData(formData, 'hierarchy_');

    await PlaceFactory.finalizePlaces([place], sessionCache, chtApi, place.type);
    return place;
  };

  private static async finalizePlaces(places: Place[], sessionCache: SessionCache, chtApi: ChtApi, contactType: ContactType) {
    await RemotePlaceResolver.resolve(places, sessionCache, chtApi, { fuzz: true });
    places.forEach(place => place.validate());
    sessionCache.savePlaces(...places);
    await WarningSystem.setWarnings(contactType, chtApi, sessionCache);
  }

  private static async loadPlacesFromCsv(csvBuffer: Buffer, contactType: ContactType) : Promise<Place[]> {
    const csvColumns: string[] = [];
    const places: Place[] = [];
    const parser = parse(csvBuffer, { delimiter: ',', trim: true, skip_empty_lines: true });
    let count = 0;
    for await (const row of parser) {
      if (count === 0) {
        const missingColumns = Config.getRequiredColumns(contactType, true).map(p => p.friendly_name)
          .filter((csvName) => !row.includes(csvName));
        if (missingColumns.length > 0) {
          throw new Error(`Missing columns: ${missingColumns.join(', ')}`);
        }
        csvColumns.push(...row);
      } else {
        const place = new Place(contactType);
        const lookupPropertyAndCreateValue = (
          writeTo: FormattedPropertyCollection,
          contactProperty: ContactProperty,
          createFromValue: (value: string) => IPropertyValue
        ) => {
          const value = row[csvColumns.indexOf(contactProperty.friendly_name)] || '';
          const validatedProperty = createFromValue(value);
          writeTo[contactProperty.property_name] = validatedProperty;
        };

        for (const hierarchyConstraint of Config.getHierarchyWithReplacement(contactType)) {
          const createFromValue = (value: string) => new HierarchyPropertyValue(place, hierarchyConstraint, 'hierarchy_', value);
          lookupPropertyAndCreateValue(place.hierarchyProperties, hierarchyConstraint, createFromValue);
        }

        // place properties must be read after hierarchy constraints since validation logic is dependent on isReplacement
        for (const placeProperty of contactType.place_properties) {
          const createFromValue = (value: string) => new ContactPropertyValue(place, placeProperty, 'place_', value);
          lookupPropertyAndCreateValue(place.properties, placeProperty, createFromValue);
        }

        for (const contactProperty of contactType.contact_properties) {
          const createFromValue = (value: string) => new ContactPropertyValue(place, contactProperty, 'contact_', value);
          lookupPropertyAndCreateValue(place.contact.properties, contactProperty, createFromValue);
        }

        if (Config.hasMultipleRoles(contactType)) {
          const userRoleProperty = Config.getUserRoleConfig(contactType);
          const createFromValue = (value: string) => new ContactPropertyValue(place, userRoleProperty, 'user_', value);
          lookupPropertyAndCreateValue(place.userRoleProperties, userRoleProperty, createFromValue);
        }

        if (contactType.superset) {
          const supersetProperty = contactType.superset;
          const createFromValue = (value: string) => new ContactPropertyValue(place, supersetProperty, 'superset_', value);
          lookupPropertyAndCreateValue(place.supersetProperties, supersetProperty, createFromValue);
        }

        places.push(place);
      }
      count++;
    }
    return places;
  }
}
