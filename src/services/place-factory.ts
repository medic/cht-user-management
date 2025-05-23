import { parse } from 'csv';

import { ChtApi, CouchDoc, UserInfo } from '../lib/cht-api';
import { Config, ContactProperty, ContactType } from '../config';
import Place, { FormattedPropertyCollection } from './place';
import SessionCache from './session-cache';
import RemotePlaceResolver from '../lib/remote-place-resolver';
import { HierarchyPropertyValue, ContactPropertyValue, IPropertyValue } from '../property-value';
import WarningSystem from '../warnings';
import Contact from './contact';

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

  public static createManyWithSingleUser = async (
    formData: { [key: string]: string },
    contactType: ContactType,
    sessionCache: SessionCache,
    chtApi: ChtApi,
    contact?: string
  ): Promise<Place[]> => {
    const list: string[] = [];
    Object.keys(formData).forEach(k => {
      if (k.startsWith('list_')) {
        list.push(formData[k]);
        delete formData[k];
      }
    });
    let existingContact: Contact | undefined;
    if (contact) {
      const p = sessionCache.getPlaces({type: contactType.name}).find(p => p.contact.id === contact);
      existingContact = p?.contact;
      formData = p?.asFormData('hierarchy_');
    }
    const places: Place[] = [];
    list.forEach((data, idx) => {
      const parsed = JSON.parse(Buffer.from(data, 'base64').toString('utf8'));
      const placeData = { ...formData, ...parsed };
      const place = new Place(contactType);
      place.setPropertiesFromFormData(placeData, 'hierarchy_');
      if (contact && existingContact) {
        place.contact = existingContact;
      } else {
        if (idx > 0) {
          place.contact = places[0].contact;
        }
      }
      place.hasSharedUser = true;  
      places.push(place);
    });
    await PlaceFactory.finalizePlaces(places, sessionCache, chtApi, contactType);
    return places;
  };

  public static reassign = async (newContactId: string, placeId: string, api: ChtApi) => {
    const user = await api.getUser(newContactId) as UserInfo & { place: CouchDoc[] };
    if (!user) {
      throw new Error('We did not find a user from the link provided. ' + 
        'Please make sure the link is correct and the contact can login to the instance');
    }
    const updatedPlaces = [...user.place.map(d => d._id), placeId];
    await api.updateUser({ username: user.username, place: updatedPlaces });
    const place = await api.getDoc(placeId);
    if (place.contact) {
      const contactId = place.contact._id ?? place.contact;
      const prevUser = await api.getUser(contactId) as UserInfo & {place: CouchDoc[]};
      const prevUserPlaces = prevUser.place.map(p => p._id).filter(id => id !== placeId); 
      if (prevUserPlaces.length > 0) {
        await api.updateUser({ 
          username: prevUser.username, 
          place: prevUserPlaces
        });
      } else {
        await api.disableUser(prevUser.username);
        await api.deleteDoc(contactId);
      }
    }
    place.contact = newContactId;
    await api.setDoc(placeId, place);
  };

  public static editOne = async (placeId: string, formData: any, sessionCache: SessionCache, chtApi: ChtApi)
    : Promise<Place> => {
    const place = sessionCache.getPlace(placeId);
    if (!place || place.isCreated) {
      throw new Error('unknown place or place has already been created');
    }
    place.setPropertiesFromFormData(formData, 'hierarchy_');
    let places = [];
    if (place.hasSharedUser) {
      places = sessionCache.getPlaces({ type: place.type.name }).filter(p => p.contact.id === place.contact.id);
    } else {
      places = [place];
    }

    await PlaceFactory.finalizePlaces(places, sessionCache, chtApi, place.type);
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

        places.push(place);
      }
      count++;
    }
    return places;
  }
}
