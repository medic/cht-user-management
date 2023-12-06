import _ from "lodash";
import { once } from "events";
import { parse } from "csv";

import { ChtApi, ParentDetails } from "../lib/cht-api";
import { ContactProperty, ContactType } from "../lib/config";
import Place from "./place";
import SessionCache from "./session-cache";
import ParentComparator from "../lib/parent-comparator";

export default class PlaceFactory {
  public static async createBulk(csvBuffer: Buffer, contactType: ContactType, sessionCache: SessionCache, chtApi: ChtApi)
    : Promise<Place[]>
  {
    const places = await PlaceFactory.loadPlacesFromCsv(csvBuffer, contactType);
    const validateAll = () => places.forEach(p => p.validate());
    // for bulk, validate prior to parent resolution
    validateAll();
    await PlaceFactory.resolveParentDetails(places, contactType, sessionCache, chtApi);
    validateAll();
    sessionCache.savePlaces(...places);
    return places;
  };

  public static createOne = async (formData: any, contactType: ContactType, sessionCache: SessionCache, chtApi: ChtApi)
    : Promise<Place> => 
  {
    const place = new Place(contactType);
    place.setPropertiesFromFormData(formData);

    await PlaceFactory.resolveParentDetails([place], contactType, sessionCache, chtApi);
    place.validate();
    sessionCache.savePlaces(place);
    return place;
  };

  public static editOne = async (placeId: string, formData: any, sessionCache: SessionCache, chtApi: ChtApi)
    : Promise<Place> => 
  {
    const place = sessionCache.getPlace(placeId);
    if (!place || place.isCreated) {
      throw new Error("unknonwn place or place has already been created");
    }

    place.setPropertiesFromFormData(formData);
    await PlaceFactory.resolveParentDetails([place], place.type, sessionCache, chtApi);
    place.validate();
    
    return place;
  };

  private static async loadPlacesFromCsv(csvBuffer: Buffer, contactType: ContactType) : Promise<Place[]> {

    const placeColumns = contactType.place_properties.map(p => p.csv_name);
    const contactColumns = contactType.contact_properties.map(p => p.csv_name);

    const csvColumns: string[] = [];
    const places: Place[] = [];

    const parser = parse(csvBuffer, { delimiter: ",", from_line: 1 });
    parser.on('data', function (row: string[]) {
      if (csvColumns.length === 0) {
        const missingColumns = [...contactColumns, ...placeColumns]
          .filter((csvName) => !row.includes(csvName));
        if (missingColumns.length > 0) {
          throw new Error(`Missing columns: ${missingColumns.join(", ")}`);
        }
        csvColumns.push(...row);
      } else {
        const place = new Place(contactType);
        for (const placeProperty of contactType.place_properties) {
          place.properties[placeProperty.doc_name] = row[csvColumns.indexOf(placeProperty.csv_name)];
        }
        for (const contactProperty of contactType.contact_properties) {
          place.contact.properties[contactProperty.doc_name] = row[csvColumns.indexOf(contactProperty.csv_name)];
        }

        places.push(place);
      }
    });

    // wait till dones
    await once(parser, "finish");
    return places;
  }

  private static resolveParentDetails = async (places: Place[], contactType: ContactType, sessionCache: SessionCache, chtApi: ChtApi)
    : Promise<void> => 
  {
    const parentMap: { [key: string]: ParentDetails } = {};
    const parentNames = _.uniq(places.map(p => p.parentName));
    const parentsNotKnown = Array.from(parentNames)
      .filter(name => {
        const [localResult, multipleResults] = sessionCache.findKnownPlace(contactType.parent_type, name, { exact: true });
        
        if (multipleResults) {
          console.warn(`Found multiple known places for name "${name}"`);
          parentMap[name] = ParentComparator.Multiple;
          return false;
        }

        if (localResult) {
          parentMap[name] = localResult;
          return false;
        }

        return true;
      });
    
    if (parentsNotKnown.length) {
      const parentsFoundRemote = await chtApi.searchPlace(contactType.parent_type, parentsNotKnown);
      parentsFoundRemote.forEach(parentDetails => {
        if (parentMap[parentDetails.name]) {
          console.warn(`Found multiple known places for name "${parentDetails.name}"`);
          parentMap[parentDetails.name] = ParentComparator.Multiple;
        } else {
          parentMap[parentDetails.name] = parentDetails;
        }
      });
    }

    places.forEach(place => {
      place.parentDetails = parentMap[place.parentName];
    });
    sessionCache.saveKnownParents(...Object.values(parentMap));
  };
}