import { PersonPayload, PlacePayload, UserPayload } from "../lib/cht";
import { Config } from "../lib/config";
import { person, place } from "./models";

export class Payloads {
  public static buildUserPayload(
    placeId: string,
    contactId: string,
    contactName: string,
    role: string
  ): UserPayload {
    const data: UserPayload = {
      username: contactName.toLowerCase().split(" ").join("_"),
      password: this.generatePassword(),
      type: role,
      place: placeId,
      contact: contactId,
    };
    return data;
  }

  public static buildContactPayload = (
    person: person,
    contactType: string
  ): PersonPayload => {
    const { properties } = person;
    return {
      name: properties.name,
      type: "contact",
      contact_type: contactType,
      ...properties,
    };
  };

  public static buildPlacePayload = (
    place: place,
    person: PersonPayload,
    parentRemoteId?: string
  ): PlacePayload => {
    const { properties } = place;
    const data: PlacePayload = {
      name: properties.name,
      type: "contact",
      contact_type: place.type,
      contact: person,
      ...properties,
    };
    // note
    // properties might have a parent key, but it will be overwritten below
    if (place.parent) {
      data.parent = parentRemoteId;
    }
    return data;
  };

  public static generatePassword(): string {
    const LENGTH = 9; // CHT requires 8 minimum + special characters
    const ELIGIBLE_CHARACTERS =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789.,";

    const pickRandomCharacter = () =>
      ELIGIBLE_CHARACTERS.charAt(
        Math.floor(Math.random() * ELIGIBLE_CHARACTERS.length)
      );
    const characters = Array(LENGTH).fill("").map(pickRandomCharacter);
    return characters.join("");
  }

  public static makeUsernameMoreComplex(username: string): string {
    const randomNumber = Math.floor(Math.random() * 100);
    return username.concat(randomNumber.toString());
  }
}
