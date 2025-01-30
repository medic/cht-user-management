import Place from '../../src/services/place';
import { CreatedUser } from './create-user';

type UsernameDictionaryX = {
  [key: string]: {
    [key: string]: string;
  };
};

const TEMP: UsernameDictionaryX = {
  'Kamukunji': {
    'Daniel Kavita Musyoka': 'daniel_kavita_musyoka',
    'Alvine Cheptoo': 'alvine_cheptoo15',
  },
  'Makadara': {
    'Mary Kamande': 'mary_kamande'
  },
  'Digital Payment': {
    'Hierarchy Cha': 'hierarchy'
  }
};

export default class UsernameDictionary {
  public needsNewUser(place: Place): boolean {
    return !this.getUsername(place);
  }

  public getUsername(place: Place): string | undefined {
    const subcounty = place.resolvedHierarchy[1]?.name.formatted || '';
    const chaName = place.contact.name;
    return TEMP[subcounty]?.[chaName];
  }
}
