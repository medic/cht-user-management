import _ from "lodash";
import axios, { AxiosHeaders } from "axios";
import { UserPayload } from "../services/user-payload";
import { AuthenticationInfo, ContactType } from "./config";

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
  name: string;
  ambiguities?: ParentDetails[];
};

export class ChtApi {
  session: ChtSession;

  constructor(session: ChtSession) {
    this.session = session;
  }

  public static async createSession(authInfo: AuthenticationInfo, username : string, password: string): Promise<ChtSession> {
    const COUCH_AUTH_COOKIE_NAME = 'AuthSession=';
    const protocol = authInfo.useHttp ? 'http' : 'https';
    const sessionUrl = `${protocol}://${username}:${password}@${authInfo.domain}/_session`;
    
    console.log('axios.post', sessionUrl);
    const resp = await axios.post(sessionUrl, {
      name: username,
      password,
    });
    const setCookieHeader = (resp.headers as AxiosHeaders).get('set-cookie') as AxiosHeaders;
    const sessionToken = setCookieHeader?.[0].split(';')
      .find((header : string) => header.startsWith(COUCH_AUTH_COOKIE_NAME));
    
    return {
      domain: `${protocol}://${authInfo.domain}`,
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
    const url = `${this.session.domain}/medic/${contactId}`;
    console.log('axios.put', url);
    const resp = await axios.put(url, doc, this.authorizationOptions());
    if (resp.status !== 201) {
      throw new Error(resp.data);
    }
  };

  createPlace = async (payload: PlacePayload): Promise<string> => {
    const url = `${this.session.domain}/api/v1/places`;
    console.log('axios.post', url);
    const resp = await axios.post(url, payload, this.authorizationOptions());
    return resp.data.id;
  };

  // because there is no PUT for /api/v1/places
  createContact = async (payload: PlacePayload): Promise<string> => {
    const url = `${this.session.domain}/api/v1/people`;
    console.log('axios.post', url);
    const resp = await axios.post(url, payload.contact, this.authorizationOptions());
    return resp.data.id;
  };

  updatePlace = async (payload: PlacePayload, contactId: string): Promise<string> => {
    const doc: any = await this.getDoc(payload._id);
    
    const payloadClone:any = _.cloneDeep(payload);
    delete payloadClone.contact;
    delete payloadClone.parent;
    Object.assign(doc, payloadClone, { contact: { _id: contactId }});

    const url = `${this.session.domain}/medic/${payload._id}`;
    console.log('axios.put', url);
    const resp = await axios.put(url, doc, this.authorizationOptions());
    return resp.data.id;
  };

  disableUsersWithPlace = async (placeId: string): Promise<string[]> => {
    const url = `${this.session.domain}/_users/_find`;
    const payload = {
      selector: {
        facility_id: placeId,
      },
    };

    console.log('axios.post', url);
    const resp = await axios.post(url, payload, this.authorizationOptions());
    const usersToDisable: string[] = resp.data?.docs?.map((d: any) => d._id);
    for (const userDocId of usersToDisable) {
      await this.disableUser(userDocId);
    }
    return usersToDisable;
  };

  disableUser = async (docId: string): Promise<void> => {
    const username = docId.substring('org.couchdb.user:'.length);
    const url = `${this.session.domain}/api/v1/users/${username}`;
    console.log('axios.delete', url);
    return axios.delete(url, this.authorizationOptions());
  };

  createUser = async (user: UserPayload): Promise<void> => {
    const url = `${this.session.domain}/api/v1/users`;
    console.log('axios.post', url);
    await axios.post(url, user, this.authorizationOptions());
  };
  
  getParentAndSibling = async (parentId: string, contactType: ContactType): Promise<{ parent: any, sibling: any }> => {
    const url = `${this.session.domain}/medic/_design/medic/_view/contacts_by_depth?keys=[[%22${parentId}%22,0],[%22${parentId}%22,1]]&include_docs=true`;
    console.log('axios.get', url);
    const resp = await axios.get(url, this.authorizationOptions());
    const docs = resp.data?.rows?.map((row: any) => row.doc) || [];
    const parent = docs.find((d: any) => d.contact_type === contactType.parent_type);
    const sibling = docs.find((d: any) => d.contact_type === contactType.name);
    return { parent, sibling };
  }

  getPlacesWithType = async (placeType: string, acceptedParentIds: string[] | undefined): Promise<ParentDetails[]> => {
    const constrainParents = !!acceptedParentIds?.length;
    const url = `${this.session.domain}/medic/_design/medic-client/_view/contacts_by_type_freetext`;
    console.log('axios.post', url);
    const resp = await axios.get(url, {
      params: {
        startkey: JSON.stringify([ placeType, 'name:']),
        endkey: JSON.stringify([ placeType, 'name:\ufff0']),
        include_docs: !!constrainParents
      },
      ...this.authorizationOptions(),
    });
    
    return resp.data.rows
      .filter((r: any) => !constrainParents || acceptedParentIds?.includes(r.doc.parent?._id))
      .map((row: any): ParentDetails => {
        const nameData = row.key[1];
        return {
          id: row.id,
          name: nameData.substring('name:'.length),
        };
      });
  };
    
  getDoc = async (id: string): Promise<any> => {
    const url = `${this.session.domain}/medic/${id}`;
    console.log('axios.get', url);
    const resp = await axios.get(url, this.authorizationOptions());
    return resp.data;
  };

  private authorizationOptions(): any {
    return {
      headers: { Cookie: this.session.sessionToken }, 
    };
  }
}
