import _ from "lodash";
import { once } from "events";
import { parse } from "csv";

import { ChtApi } from "../lib/cht-api";
import { ContactType } from "../lib/config";
import Place from "./place";
import SessionCache from "./session-cache";
import PlaceResolver from "../lib/place-resolver";

export default class PlaceFactory {
  public static async createBulk(csvBuffer: Buffer, contactType: ContactType, sessionCache: SessionCache, chtApi: ChtApi)
    : Promise<Place[]>
  {
    const places = await PlaceFactory.loadPlacesFromCsv(csvBuffer, contactType);
    const validateAll = () => places.forEach(p => p.validate());
    
    await PlaceResolver.resolve(places, contactType, sessionCache, chtApi, { fuzz: true });
    validateAll();
    sessionCache.savePlaces(...places);
    return places;
  };

  public static createOne = async (formData: any, contactType: ContactType, sessionCache: SessionCache, chtApi: ChtApi)
    : Promise<Place> => 
  {
    const place = new Place(contactType);
    place.setPropertiesFromFormData(formData);

    await PlaceResolver.resolve([place], contactType, sessionCache, chtApi, { fuzz: true });
    place.validate();
    sessionCache.savePlaces(place);
    return place;
  };

  public static editOne = async (placeId: string, formData: any, sessionCache: SessionCache, chtApi: ChtApi)
    : Promise<Place> => 
  {
    const place = sessionCache.getPlace(placeId);
    if (!place || place.isCreated) {
      throw new Error("unknown place or place has already been created");
    }

    place.setPropertiesFromFormData(formData);
    await PlaceResolver.resolve([place], place.type, sessionCache, chtApi, { fuzz: true });
    place.validate();
    
    return place;
  };

  private static async loadPlacesFromCsv(csvBuffer: Buffer, contactType: ContactType) : Promise<Place[]> {
    const csvColumns: string[] = [];
    const places: Place[] = [];

    const parser = parse(csvBuffer, { delimiter: ",", from_line: 1 });
    let isReplacementCsv: boolean = false;
    parser.on('data', function (row: string[]) {
      if (csvColumns.length === 0) {
        isReplacementCsv = row.includes('replacement');
        const missingColumns = [
          ...isReplacementCsv ? ['replacement'] : [],
          ...contactType.place_properties.filter(p => p.required).map(p => p.csv_name),
          ...contactType.contact_properties.filter(p => p.required).map(p => p.csv_name),
        ]
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
        
        if (isReplacementCsv) {
          place.properties.replacement = row[csvColumns.indexOf('replacement')]
        }

        places.push(place);
      }
    });

    // wait till dones
    await once(parser, "finish");
    return places;
  }
}