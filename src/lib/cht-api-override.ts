import { ChtApi } from './cht-api';
import ChtSession from './cht-session';

export class ChtApi_4_6 extends ChtApi {
  public constructor(session: ChtSession) {
    super(session);
  }

  // #8674: assign parent place to new contacts
  public override updateContactParent = async (): Promise<string> => {
    throw Error(`program should never update contact's parent after cht-core 4.6`);
  };
}

export class ChtApi_4_7 extends ChtApi_4_6 {
  public constructor(session: ChtSession) {
    super(session);
  }

  // #8986: Look up a single user from their username
  // #8877: Look up users from their facility_id or contact_id
  protected override async getUsersAtPlace(placeId: string): Promise<string[]> {
    const url = `api/v2/users?facility_id=${placeId}`;
    console.log('axios.get', url);
    const resp = await this.axiosInstance.get(url);
    return resp.data
      ?.filter((d : any) => !d.inactive) // TODO: needed?
      ?.map((d: any) => d.id);
  }
}
