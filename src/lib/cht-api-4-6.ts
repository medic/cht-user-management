import { ChtApi } from './cht-api';
import ChtSession from './cht-session';

export class ChtApi_4_6 extends ChtApi {
  public constructor(session: ChtSession) {
    super(session);
  }

  // #8674: assign parent place to new contacts
  public override updateContactParent = async (parentId: string): Promise<string> => {
    throw Error(`invalid program. should never update contact's parent after cht-core 4.6`);
  };
}
