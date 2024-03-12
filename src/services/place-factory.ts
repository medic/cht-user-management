import { parse } from 'csv';

import { ChtApi } from '../lib/cht-api';
import { Config, ContactType } from '../config';
import Place from './place';
import SessionCache from './session-cache';
import RemotePlaceResolver from '../lib/remote-place-resolver';

export default class PlaceFactory {
  public static async createBulk(csvBuffer: Buffer, contactType: ContactType, sessionCache: SessionCache, chtApi: ChtApi)
    : Promise<Place[]> {
    const places = await PlaceFactory.loadPlacesFromCsv(csvBuffer, contactType);
    const validateAll = () => places.forEach(p => p.validate());

    await RemotePlaceResolver.resolve(places, sessionCache, chtApi, { fuzz: true });
    validateAll();
    sessionCache.savePlaces(...places);
    return places;
  }

  public static createOne = async (formData: any, contactType: ContactType, sessionCache: SessionCache, chtApi: ChtApi)
    : Promise<Place> => {
    const place = new Place(contactType);
    place.setPropertiesFromFormData(formData, 'hierarchy_');

    await RemotePlaceResolver.resolveOne(place, sessionCache, chtApi, { fuzz: true });
    place.validate();
    sessionCache.savePlaces(place);
    return place;
  };

  public static editOne = async (placeId: string, formData: any, sessionCache: SessionCache, chtApi: ChtApi)
    : Promise<Place> => {
    const place = sessionCache.getPlace(placeId);
    if (!place || place.isCreated) {
      throw new Error('unknown place or place has already been created');
    }

    place.setPropertiesFromFormData(formData, 'hierarchy_');
    await RemotePlaceResolver.resolveOne(place, sessionCache, chtApi, { fuzz: true });
    place.validate();

    return place;
  };

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
        for (const placeProperty of contactType.place_properties) {
          place.properties[placeProperty.property_name] = row[csvColumns.indexOf(placeProperty.friendly_name)];
        }

        for (const contactProperty of contactType.contact_properties) {
          place.contact.properties[contactProperty.property_name] = row[csvColumns.indexOf(contactProperty.friendly_name)];
        }

        for (const hierarchyConstraint of Config.getHierarchyWithReplacement(contactType)) {
          const columnIndex = csvColumns.indexOf(hierarchyConstraint.friendly_name);
          place.hierarchyProperties[hierarchyConstraint.property_name] = row[columnIndex];
        }

        if (typeof contactType.user_role !== 'string') {
          const userRoleProperty = contactType.user_role;
          place.userRoleProperty[userRoleProperty.property_name] = row[
            csvColumns.indexOf(userRoleProperty.friendly_name)
          ];
        }
        
        places.push(place);
      }
      count++;
    }
    return places;
  }
}
