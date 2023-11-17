import axios from "axios";

export type contactType = {
  id: string;
  parents?: string[];
  person: boolean;
};

export type AppSettings = {
  roles: string[];
  hierarchy: contactType[];
};

export type Credentials = {
  User: string;
  Pass: string;
  Domain: string;
};

export type PersonPayload = {
  name: string;
  phone: string;
  sex: string;
  type: string;
  contact_type: string;
  place?: string;
};

export type PlacePayload = {
  name: string;
  type: string;
  contact_type: string;
  contact: PersonPayload;
  parent?: string;
};

export type UserPayload = {
  password: string;
  username: string;
  type: string;
  place: string;
  contact: string;
};

export type PlaceSearchResult = {
  id: string;
  name: string;
};

export class ChtApi {
  creds: Credentials;

  constructor(creds: Credentials) {
    this.creds = creds;
  }

  getAppSettings = async (): Promise<AppSettings> => {
    const url = `https://${this.creds.User}:${this.creds.Pass}@${this.creds.Domain}/medic/_design/medic/_rewrite/app_settings/medic`;
    const resp = await axios.get(url);
    const { settings: respBody } = resp.data;
    return {
      roles: Object.keys(respBody["roles"]),
      hierarchy: respBody["contact_types"],
    };
  };

  getDoc = async (id: string): Promise<any> => {
    const url = `https://${this.creds.User}:${this.creds.Pass}@${this.creds.Domain}/medic/\_find`;
    const resp = await axios.post(url, {
      selector: {
        _id: id,
      },
    });
    return resp.data.docs[0];
  };

  getPlaceContactId = async (id: string): Promise<string> => {
    const doc: any = await this.getDoc(id);
    return doc.contact._id;
  };

  updateContactParent = async (id: string, place: string): Promise<void> => {
    const doc: any = await this.getDoc(id);
    doc.parent = {
      _id: place,
    };
    delete doc["_id"];
    const url = `https://${this.creds.User}:${this.creds.Pass}@${this.creds.Domain}/medic/${id}`;
    const resp = await axios.put(url, doc);
    if (resp.status !== 201) {
      throw new Error(resp.data);
    }
  };

  updatePlaceContact = async (
    place: string,
    contact: string
  ): Promise<void> => {
    const doc: any = await this.getDoc(place);
    doc.contact = {
      _id: contact,
    };
    delete doc["_id"];
    const url = `https://${this.creds.User}:${this.creds.Pass}@${this.creds.Domain}/medic/${place}`;
    const resp = await axios.put(url, doc);
    if (resp.status !== 201) {
      throw new Error(resp.data);
    }
  };

  // we only get the place id back
  createPlace = async (place: PlacePayload): Promise<string> => {
    const url = `https://${this.creds.User}:${this.creds.Pass}@${this.creds.Domain}/api/v1/places`;
    const resp = await axios.post(url, place);
    return resp.data.id;
  };

  createContact = async (person: PersonPayload): Promise<string> => {
    const url = `https://${this.creds.User}:${this.creds.Pass}@${this.creds.Domain}/api/v1/people`;
    const resp = await axios.post(url, person);
    return resp.data.id;
  };

  createUser = async (user: UserPayload): Promise<void> => {
    const url = `https://${this.creds.User}:${this.creds.Pass}@${this.creds.Domain}/api/v1/users`;
    await axios.post(url, user);
  };

  searchPlace = async (
    placeType: string,
    searchStr: string
  ): Promise<PlaceSearchResult[]> => {
    const url = `https://${this.creds.User}:${this.creds.Pass}@${this.creds.Domain}/medic/\_find`;
    const resp = await axios.post(url, {
      selector: {
        contact_type: placeType,
        name: {
          $regex: `^(?i)${searchStr}`,
        },
      },
    });
    const { docs } = resp.data;
    return docs.map((doc: any) => {
      return { id: doc._id, name: doc.name };
    });
  };
}
