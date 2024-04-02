import { ChtApi_4_6 } from './cht-api-4-6';
import ChtSession from './cht-session';

export class ChtApi_4_7 extends ChtApi_4_6 {
  public constructor(session: ChtSession) {
    super(session);
  }

  // #8877: Look up a single user from their username
  // #8877: Look up users from their facility_id or contact_id
  protected override async getUsersAtPlace(placeId: string): Promise<string[]> {
    const url = `api/v2/users?facility_id=${placeId}`;
    console.log('axios.get', url);
    const resp = await this.axiosInstance.get(url);
    return resp.data
      ?.filter((d : any) => !d.inactive) 
      ?.map((d: any) => d.id);
  }
}
