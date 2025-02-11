import * as crypto from 'crypto';
import Place from './place';
import { SupersetUserPayload } from './supertset-payload';

export class UserPayload {
  public password: string;
  public username: string;
  public place: string;
  public contact: string;
  public fullname: string;
  public phone: string;
  public email: string;
  public roles: string[];

  constructor(place: Place, placeId: string, contactId: string) {
    this.username = place.generateUsername();
    this.password = this.generatePassword();
    this.roles = place.userRoles;
    this.place = placeId;
    this.contact = contactId;
    this.fullname = place.contact.name;
    this.email = place.contact.properties.email?.formatted;
    this.phone = place.contact.properties.phone?.formatted; // best guess
  }

  public regeneratePassword(): void {
    this.password = this.generatePassword();
  }

  public makeUsernameMoreComplex(): void {
    const randomNumber = crypto.randomInt(0, 100);
    this.username =  `${this.username}${randomNumber.toString()}`;
  }

  private generatePassword(): string {
    const LENGTH = 9; // CHT requires 8 minimum + special characters
    const ELIGIBLE_CHARACTERS =
      'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789.,';

    const pickRandomCharacter = () => ELIGIBLE_CHARACTERS.charAt(
      Math.floor(Math.random() * ELIGIBLE_CHARACTERS.length)
    );
    const characters = Array(LENGTH).fill('').map(pickRandomCharacter);
    return characters.join('');
  }

  // Method to convert UserPayload to SupersetUserPayload
  public toSupersetUserPayload(rolesId: string[]): SupersetUserPayload {
    // The name order be inverted (last name first) for some config
    // For now, can we assume the first part is the first name, acknowledging this as acceptable technical debt ?
    const [firstName, ...lastNameParts] = this.fullname.split(' ');
    const lastName = lastNameParts.join(' ') || firstName;
    return {
      active: true,
      first_name: firstName,
      last_name: lastName,
      email: this.email,
      username: this.username,
      password: this.password,
      roles: rolesId
    };
  }
}
