import { expect } from 'chai';
import sinon from 'sinon';

import { ChtApi, UserInfo } from '../../src/lib/cht-api';
import { SetUserFacilities } from '../../src/services/set-user-facilities';

const DISABLED_ROLE = 'disabled';

type FakeChtApi = ChtApi & {
  getUsersAtPlace: sinon.SinonStub;
  updateUser: sinon.SinonStub;
};

function fakeChtApi(usersByFacility: Record<string, UserInfo[]>): FakeChtApi {
  return {
    getUsersAtPlace: sinon.stub().callsFake(async (placeId: string) => usersByFacility[placeId] ?? []),
    updateUser: sinon.stub().resolves(),
  } as unknown as FakeChtApi;
}

describe('SetUserFacilities', () => {
  afterEach(() => sinon.restore());

  it('assigns the requested facilities to the target user (replacing their list)', async () => {
    const chtApi = fakeChtApi({ 'fac-a': [], 'fac-b': [] });

    const result = await SetUserFacilities.setFacilities('target', ['fac-a', 'fac-b'], chtApi);

    expect(chtApi.updateUser.calledOnceWithExactly({ username: 'target', place: ['fac-a', 'fac-b'] })).to.be.true;
    expect(result).to.deep.equal({ username: 'target', facilityIds: ['fac-a', 'fac-b'], unassigned: [] });
  });

  it('re-applies the role to re-enable a previously disabled target when facilities are assigned', async () => {
    const chtApi = fakeChtApi({ 'fac-a': [] });

    await SetUserFacilities.setFacilities('target', ['fac-a'], chtApi, ['community_health_assistant']);

    // The role is written alongside the facility, restoring access for a disabled user.
    expect(chtApi.updateUser.firstCall.args[0]).to.deep.equal({
      username: 'target',
      place: ['fac-a'],
      roles: ['community_health_assistant'],
    });
  });

  it('does not set roles when an empty roles list is supplied', async () => {
    const chtApi = fakeChtApi({ 'fac-a': [] });

    await SetUserFacilities.setFacilities('target', ['fac-a'], chtApi, []);

    expect(chtApi.updateUser.firstCall.args[0]).to.deep.equal({ username: 'target', place: ['fac-a'] });
  });

  it('removes the reassigned facility from another user that held it', async () => {
    const chtApi = fakeChtApi({
      'fac-a': [{ username: 'other', place: [{ _id: 'fac-a' }, { _id: 'fac-z' }] }],
    });

    const result = await SetUserFacilities.setFacilities('target', ['fac-a'], chtApi);

    expect(chtApi.updateUser.firstCall.args[0]).to.deep.equal({ username: 'target', place: ['fac-a'] });
    expect(chtApi.updateUser.secondCall.args[0]).to.deep.equal({ username: 'other', place: ['fac-z'] });
    expect(result.unassigned).to.deep.equal([{ username: 'other', remaining: ['fac-z'] }]);
  });

  it('disables a displaced user left with no facilities (role disabled, reduced to one facility)', async () => {
    const chtApi = fakeChtApi({
      'fac-a': [{ username: 'other', place: ['fac-a'] }],
    });

    const result = await SetUserFacilities.setFacilities('target', ['fac-a'], chtApi);

    // No empty list is ever written; the user is disabled and kept on a single facility.
    expect(chtApi.updateUser.secondCall.args[0]).to.deep.equal({
      username: 'other',
      roles: [DISABLED_ROLE],
      place: ['fac-a'],
    });
    expect(result.unassigned).to.deep.equal([{ username: 'other', remaining: [], disabled: true }]);
  });

  it('reduces a disabled user to a single facility (their first) when several are reassigned', async () => {
    const shared: UserInfo = { username: 'other', place: ['fac-a', 'fac-b'] };
    const chtApi = fakeChtApi({ 'fac-a': [shared], 'fac-b': [shared] });

    const result = await SetUserFacilities.setFacilities('target', ['fac-a', 'fac-b'], chtApi);

    const otherWrites = chtApi.updateUser.getCalls().filter(c => c.args[0].username === 'other');
    expect(otherWrites).to.have.length(1);
    expect(otherWrites[0].args[0]).to.deep.equal({ username: 'other', roles: [DISABLED_ROLE], place: ['fac-a'] });
    expect(result.unassigned).to.deep.equal([{ username: 'other', remaining: [], disabled: true }]);
  });

  it('does not unassign the target user even if it already held the facility', async () => {
    const chtApi = fakeChtApi({
      'fac-a': [{ username: 'target', place: ['fac-a'] }],
    });

    const result = await SetUserFacilities.setFacilities('target', ['fac-a'], chtApi);

    expect(chtApi.updateUser.calledOnce).to.be.true; // only the assignment write
    expect(result.unassigned).to.deep.equal([]);
  });

  it('rewrites a shared user once when they held several reassigned facilities but keep some', async () => {
    const shared: UserInfo = { username: 'other', place: ['fac-a', 'fac-b', 'fac-keep'] };
    const chtApi = fakeChtApi({ 'fac-a': [shared], 'fac-b': [shared] });

    const result = await SetUserFacilities.setFacilities('target', ['fac-a', 'fac-b'], chtApi);

    const otherWrites = chtApi.updateUser.getCalls().filter(c => c.args[0].username === 'other');
    expect(otherWrites).to.have.length(1);
    expect(otherWrites[0].args[0]).to.deep.equal({ username: 'other', place: ['fac-keep'] });
    expect(result.unassigned).to.deep.equal([{ username: 'other', remaining: ['fac-keep'] }]);
  });

  it('normalizes the various place shapes returned by the CHT API', async () => {
    // string-array place, single-string place, and CouchDoc-array place
    const chtApi = fakeChtApi({
      'fac-a': [
        { username: 'str-arr', place: ['fac-a', 'fac-x'] },
        { username: 'str', place: 'fac-a' as any },
        { username: 'doc-arr', place: [{ _id: 'fac-a' }, { _id: 'fac-y' }] },
      ],
    });

    const result = await SetUserFacilities.setFacilities('target', ['fac-a'], chtApi);

    // 'str' is left with nothing and is disabled; the others keep their remaining facility.
    expect(result.unassigned).to.deep.equal([
      { username: 'str-arr', remaining: ['fac-x'] },
      { username: 'str', remaining: [], disabled: true },
      { username: 'doc-arr', remaining: ['fac-y'] },
    ]);
  });

  describe('unassignFacilitiesFromOthers', () => {
    it('strips the facilities from other users without assigning them to anyone', async () => {
      const chtApi = fakeChtApi({
        'fac-a': [{ username: 'other', place: [{ _id: 'fac-a' }, { _id: 'fac-z' }] }],
      });

      const unassigned = await SetUserFacilities.unassignFacilitiesFromOthers(['fac-a'], 'target', chtApi);

      expect(chtApi.updateUser.calledOnceWithExactly({ username: 'other', place: ['fac-z'] })).to.be.true;
      expect(unassigned).to.deep.equal([{ username: 'other', remaining: ['fac-z'] }]);
    });

    it('does not touch the excluded (target) user even if it holds the facility', async () => {
      const chtApi = fakeChtApi({
        'fac-a': [{ username: 'target', place: ['fac-a'] }],
      });

      const unassigned = await SetUserFacilities.unassignFacilitiesFromOthers(['fac-a'], 'target', chtApi);

      expect(chtApi.updateUser.called).to.be.false;
      expect(unassigned).to.deep.equal([]);
    });

    it('disables a displaced user with no remaining facilities', async () => {
      const chtApi = fakeChtApi({
        'fac-a': [{ username: 'other', place: ['fac-a'] }],
      });

      const unassigned = await SetUserFacilities.unassignFacilitiesFromOthers(['fac-a'], 'target', chtApi);

      expect(chtApi.updateUser.calledOnceWithExactly({
        username: 'other',
        roles: [DISABLED_ROLE],
        place: ['fac-a'],
      })).to.be.true;
      expect(unassigned).to.deep.equal([{ username: 'other', remaining: [], disabled: true }]);
    });

    it('still attempts the other users when one update fails, recording the error', async () => {
      const chtApi = fakeChtApi({
        'fac-a': [
          { username: 'bad', place: ['fac-a'] },
          { username: 'good', place: [{ _id: 'fac-a' }, { _id: 'fac-keep' }] },
        ],
      });
      chtApi.updateUser.withArgs(sinon.match({ username: 'bad' })).rejects(new Error('boom'));

      const unassigned = await SetUserFacilities.unassignFacilitiesFromOthers(['fac-a'], 'target', chtApi);

      expect(chtApi.updateUser.calledWithExactly({ username: 'good', place: ['fac-keep'] })).to.be.true;
      expect(unassigned).to.deep.equal([
        { username: 'bad', remaining: [], error: 'boom' },
        { username: 'good', remaining: ['fac-keep'] },
      ]);
    });
  });
});
