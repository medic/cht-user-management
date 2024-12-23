import { expect } from 'chai';
import Sinon from 'sinon';

import { DisableUsers } from '../../src/lib/disable-users';

const PLACE_ID = 'abc';

const mockChtApi = (usersAtPlace) => ({
  getUsersAtPlace: Sinon.stub().resolves(usersAtPlace),
  disableUser: Sinon.stub().resolves(),
  updateUser: Sinon.stub().resolves(),
});

describe('lib/disable-users.ts', () => {
  it('disable a user with single facility (4.7)', async () => {
    const cht = mockChtApi([{
      username: 'user',
      place: { _id: PLACE_ID }
    }]);
    const actual = await DisableUsers.disableUsersAt(PLACE_ID, cht);
    expect(cht.disableUser.callCount).to.eq(1);
    expect(cht.disableUser.args[0]).to.deep.eq(['user']);
    expect(cht.updateUser.called).to.be.false;
    expect(actual).to.deep.eq(['user']);
  });

  it('disable a user with single facility (4.11)', async () => {
    const cht = mockChtApi([{
      username: 'user',
      place: [{ _id: PLACE_ID }]
    }]);
    const actual = await DisableUsers.disableUsersAt(PLACE_ID, cht);
    expect(cht.disableUser.callCount).to.eq(1);
    expect(cht.updateUser.called).to.be.false;
    expect(actual).to.deep.eq(['user']);
  });

  it('deactivate a user with single facility (4.11)', async () => {
    const cht = mockChtApi([{
      username: 'user',
      place: [{ _id: PLACE_ID }]
    }]);
    const actual = await DisableUsers.deactivateUsersAt(PLACE_ID, cht);
    expect(cht.disableUser.called).to.be.false;
    expect(cht.updateUser.callCount).to.eq(1);
    expect(cht.updateUser.args[0]).to.deep.eq([{
      username: 'user',
      roles: ['deactivated'],
    }]);
    expect(actual).to.deep.eq(['user']);
  });

  it('user is updated when one of two facilities are removed (disable)', async () => {
    const cht = mockChtApi([{
      username: 'user',
      place: [{ _id: PLACE_ID }, { _id: 'efg' }]
    }]);
    const actual = await DisableUsers.disableUsersAt(PLACE_ID, cht);
    expect(cht.disableUser.called).to.be.false;
    expect(cht.updateUser.called).to.be.true;
    expect(cht.updateUser.args[0]).to.deep.eq([{
      username: 'user',
      place: ['efg'],
    }]);
    expect(actual).to.deep.eq(['user']);
  });

  it('user is updated when one of two facilities are removed (deactivate)', async () => {
    const cht = mockChtApi([{
      username: 'user',
      place: [{ _id: PLACE_ID }, { _id: 'efg' }]
    }]);
    const actual = await DisableUsers.deactivateUsersAt(PLACE_ID, cht);
    expect(cht.disableUser.called).to.be.false;
    expect(cht.updateUser.called).to.be.true;
    expect(cht.updateUser.args[0]).to.deep.eq([{
      username: 'user',
      place: ['efg'],
    }]);
    expect(actual).to.deep.eq(['user']);
  });

  it('two users are disabled when they share a facility', async () => {
    const cht = mockChtApi([
      {
        username: 'user',
        place: [{ _id: PLACE_ID }],
      },
      {
        username: 'other',
        place: [{ _id: PLACE_ID }],
      },
    ]);
    
    const actual = await DisableUsers.disableUsersAt(PLACE_ID, cht);
    expect(cht.disableUser.callCount).to.eq(2);
    expect(cht.disableUser.args).to.deep.eq([['user'], ['other']]);
    expect(cht.updateUser.called).to.be.false;
    expect(actual).to.deep.eq(['user', 'other']);
  });

  it('some user facility_ids do not exist', async () => {
    const cht = mockChtApi([{
      username: 'user',
      place: [null, { _id: PLACE_ID }, null, { _id: 'efg' }]
    }]);
    await DisableUsers.disableUsersAt(PLACE_ID, cht);
    expect(cht.disableUser.called).to.be.false;
    expect(cht.updateUser.callCount).to.eq(1);
  });
});
