import axios, { AxiosHeaders } from "axios";
import { UserPayload } from "../services/user-payload";

export type ChtSession = {
  domain: string;
  sessionToken: string;
};

export type PlacePayload = {
  name: string;
  type: string;
  contact_type: string;
  contact: {
    name: string;
    type: string;
    contact_type: string;
    [key: string]: any;
  };
  parent?: string;
  [key: string]: any;
};

export type ParentDetails = {
  id: string;
  type: string;
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

  getPlaceContactId = async (placeId: string): Promise<string> => {
    const doc: any = await this.getDoc(placeId);
    return doc.contact._id;
  };

  updateContactParent = async (contactId: string, placeId: string): Promise<void> => {
    const doc: any = await this.getDoc(contactId);
    doc.parent = {
      _id: placeId,
    };
    delete doc["_id"];
    const url = `https://${this.session.domain}/medic/${contactId}`;
    const resp = await axios.put(url, doc, this.authorizationOptions());
    if (resp.status !== 201) {
      throw new Error(resp.data);
    }
  };

  createPlace = async (place: PlacePayload): Promise<string> => {
    const url = `https://${this.session.domain}/api/v1/places`;
    const resp = await axios.post(url, place, this.authorizationOptions());
    return resp.data.id;
  };

  createUser = async (user: UserPayload): Promise<void> => {
    const url = `https://${this.session.domain}/api/v1/users`;
    await axios.post(url, user, this.authorizationOptions());
  };

  searchPlace = async (placeType: string, searchStr: string | string[])
    : Promise<ParentDetails[]> => 
  {
    const url = `https://${this.session.domain}/medic/\_find`;
    const nameSelector: any = {};
    if (typeof searchStr === "string") {
      nameSelector["$regex"] = `^(?i)${searchStr}`;
    } else {
      nameSelector["$in"] = searchStr;
    }
    const payload = {
      selector: {
        contact_type: placeType,
        name: nameSelector,
      },
    };
    const resp = await axios.post(url, payload, this.authorizationOptions());
    const { docs } = resp.data;
    return docs.map((doc: any) => {
      return { id: doc._id, type: placeType, name: doc.name };
    });
  };

  private getDoc = async (id: string): Promise<any> => {
    const url = `https://${this.session.domain}/medic/${id}`;
    const resp = await axios.get(url, this.authorizationOptions());
    return resp.data;
  };

  private authorizationOptions(): any {
    return {
      headers: { Cookie: this.session.sessionToken }, 
    };
  }
}
