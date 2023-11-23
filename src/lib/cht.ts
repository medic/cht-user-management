import axios, { AxiosHeaders } from "axios";

export type ChtSession = {
  domain: string;
  sessionToken: string;
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
  session: ChtSession;

  constructor(session: ChtSession) {
    this.session = session;
  }

  public static async createSession(domain: string, username : string, password: string): Promise<ChtSession> {
    const COUCH_AUTH_COOKIE_NAME = 'AuthSession=';
    const SESSION_URL = `https://${username}:${password}@${domain}/_session`;
    
    const resp = await axios.post(SESSION_URL, {
      name: username,
      password,
    });
    const setCookieHeader = (resp.headers as AxiosHeaders).get('set-cookie') as AxiosHeaders;
    const sessionToken = setCookieHeader?.[0].split(';')
      .find((header : string) => header.startsWith(COUCH_AUTH_COOKIE_NAME));
    
    return {
      domain,
      sessionToken,
    };
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
    const url = `https://${this.session.domain}/medic/${id}`;
    const resp = await axios.put(url, doc, this.authorizationOptions());
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
    const url = `https://${this.session.domain}/medic/${place}`;
    const resp = await axios.put(url, doc, this.authorizationOptions());
    if (resp.status !== 201) {
      throw new Error(resp.data);
    }
  };

  // we only get the place id back
  createPlace = async (place: PlacePayload): Promise<string> => {
    const url = `https://${this.session.domain}/api/v1/places`;
    const resp = await axios.post(url, place, this.authorizationOptions());
    return resp.data.id;
  };

  createContact = async (person: PersonPayload): Promise<string> => {
    const url = `https://${this.session.domain}/api/v1/people`;
    const resp = await axios.post(url, person, this.authorizationOptions());
    return resp.data.id;
  };

  createUser = async (user: UserPayload): Promise<void> => {
    const url = `https://${this.session.domain}/api/v1/users`;
    await axios.post(url, user, this.authorizationOptions());
  };

  searchPlace = async (
    placeType: string,
    searchStr: string
  ): Promise<PlaceSearchResult[]> => {
    const url = `https://${this.session.domain}/medic/\_find`;
    const payload = {
      selector: {
        contact_type: placeType,
        name: {
          $regex: `^(?i)${searchStr}`,
        },
      }
    };
    const resp = await axios.post(url, payload, this.authorizationOptions());
    const { docs } = resp.data;
    return docs.map((doc: any) => {
      return { id: doc._id, name: doc.name };
    });
  };

  private getDoc = async (id: string): Promise<any> => {
    const url = `https://${this.session.domain}/medic/\_find`;
    const resp = await axios.post(url, {
      selector: {
        _id: id,
      },
    }, this.authorizationOptions());
    return resp.data.docs[0];
  };

  private authorizationOptions(): any {
    return {
      headers: { Cookie: this.session.sessionToken }, 
    };
  }
}
