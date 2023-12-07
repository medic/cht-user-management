import * as crypto from "crypto";
import Place from "./place";

export class UserPayload {
  public password: string;
  public username: string;
  public type: string;
  public place: string;
  public contact: string;
  public fullname: string;
  public phone: string;

  constructor(place: Place, placeId: string, contactId: string) {
    this.username = this.generateUsername(place.contact.name);
    this.password = this.generatePassword();
    this.type = place.type.contact_role;
    this.place = placeId;
    this.contact = contactId;
    this.fullname = place.contact.name;
    this.phone = place.contact.properties.phone; // best guess
  }

  public regeneratePassword(): void {
    this.password = this.generatePassword();
  }

  public makeUsernameMoreComplex(): void {
    const randomNumber = crypto.randomInt(0, 100);
    this.username =  `${this.username}${randomNumber.toString()}`;
  }

  private generateUsername(contactName: string) {
    return contactName.toLowerCase().split(" ").join("_")
  }

  private generatePassword(): string {
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
}
