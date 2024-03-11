import * as crypto from 'crypto';
import Place from './place';

export class UserPayload {
  public password: string;
  public username: string;
  public type: string;
  public place: string;
  public contact: string;
  public fullname: string;
  public phone: string;
  public roles: string[];

  constructor(place: Place, placeId: string, contactId: string) {
    this.username = place.generateUsername();
    this.password = this.generatePassword();
    this.roles = place.extractUserRoles();
    this.type = this.getUserType(place);
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

  /**
   * Retrieves the user type from the place. 
   * If roles are present, this method returns an empty string.
   * If roles are not present, it returns the user type defined.
   * 
   * When the type is sent alongside roles to CHT, roles are ignored.
   * In such cases, this method returns an empty string to prioritize roles.
   *
   * @param place - The place object containing creation details and type information.
   * @returns A string representing the user type.
   */
  public getUserType(place: Place): string {
    return place.extractUserRoles().length > 0 ? '' : place.type.user_role;
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
}
