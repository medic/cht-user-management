import { once } from "events";
import { parse } from "csv";
import { v4 as uuidv4 } from "uuid";

import { person, place } from "../services/models";
import { Config, ContactType } from "./config";

export default class CsvReader {
  public static async fromBuffer(csvBuffer: Buffer, workbookId: string, contactType: ContactType)
    : Promise<{ place: place; contact: person }[]>
  {
    const userRole = contactType.contact_role;
    const mapPlaceCsvnameDocName = Config.getCSVNameDocNameMap(
      contactType.place_properties
    );
    const mapContactCsvnameDocName = Config.getCSVNameDocNameMap(
      contactType.contact_properties
    );
    const contactColumns = Object.keys(mapContactCsvnameDocName);
    const placeColumns = Object.keys(mapPlaceCsvnameDocName);

    const csvColumns: string[] = [];
    const places: { place: place; contact: person }[] = [];

    const parser = parse(csvBuffer, { delimiter: ",", from_line: 1 });
    parser.on("data", function (row: string[]) {
      if (csvColumns.length === 0) {
        const missingColumns = [
          ...Object.keys(mapPlaceCsvnameDocName),
          ...Object.keys(mapContactCsvnameDocName),
        ].filter((csvName) => !row.includes(csvName));
        if (missingColumns.length > 0) {
          throw new Error(`Missing columns: ${missingColumns.join(", ")}`);
        }
        csvColumns.push(...row);
      } else {
        const id = uuidv4();
        const contact: person = {
          id: "person::" + id,
          properties: {
            role: userRole,
          }
        };
        for (const contactColumn of contactColumns) {
          const docName = mapContactCsvnameDocName[contactColumn];
          contact.properties[docName] = row[csvColumns.indexOf(contactColumn)];
        }
        const placeData: place = {
          id: "place::" + id,
          type: contactType.name,
          contact: contact.id,
          workbookId: workbookId,
          properties: {},
        };
        for (const placeColumn of placeColumns) {
          const docName = mapPlaceCsvnameDocName[placeColumn];
          placeData.properties[docName] = row[csvColumns.indexOf(placeColumn)];
        }
        places.push({ place: placeData, contact: contact });
      }
    });
    
    // wait till dones
    await once(parser, "finish");
    return places;
  };
}