import * as crypto from 'crypto';
import Place from './place';

export class UserPayload {
  public password: string;
  public username: string;
  public place: string;
  public contact: string;
  public fullname: string;
  public phone: string;
  public roles: string[];

  constructor(place: Place, placeId: string, contactId: string) {
    this.username = place.generateUsername();
    this.password = generatePassword();
    this.roles = place.userRoles;
    this.place = placeId;
    this.contact = contactId;
    this.fullname = place.contact.name;
    this.phone = place.contact.properties.phone; // best guess
  }

  public regeneratePassword(): void {
    this.password = generatePassword();
  }

  public makeUsernameMoreComplex(): void {
    this.username = makeUsernameMoreComplex(this.username);
  }
}

export function makeUsernameMoreComplex(username: string): string {
    const randomNumber = crypto.randomInt(0, 100);
    return `${username}${randomNumber.toString()}`;
};

export function generatePassword(): string {
    const LENGTH = 9; // CHT requires 8 minimum + special characters
    const ELIGIBLE_CHARACTERS =
      'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789.,';

    const pickRandomCharacter = () => ELIGIBLE_CHARACTERS.charAt(
      Math.floor(Math.random() * ELIGIBLE_CHARACTERS.length)
    );
    const characters = Array(LENGTH).fill('').map(pickRandomCharacter);
    return characters.join('');
};