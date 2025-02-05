import * as crypto from 'crypto';

import { ChtApi } from '../lib/cht-api';
import Place from './place';
import { createUserWithRetries } from '../lib/retry-logic';

export class UserPayload {
  public password: string;
  public username: string;
  public place: string[];
  public contact: string;
  public fullname: string;
  public phone: string;
  public roles: string[];

  constructor(place: Place, placeIds: string | string[], contactId: string) {
    this.username = place.generateUsername();
    this.password = this.generatePassword();
    this.roles = place.userRoles;
    this.place = Array.isArray(placeIds) ? placeIds : [placeIds];
    this.contact = contactId;
    this.fullname = place.contact.name;
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

  public create(chtApi: ChtApi) {
    return createUserWithRetries(this, chtApi);
  }
}
