import { expect } from 'chai';
import Sinon from 'sinon';

import { MultiplaceUsers, PlaceReassignment } from '../../src/lib/multiplace-users';

const PLACE_ID = 'abc';
const GAINER_USERNAME = 'gainer';

const mockChtApi = (usersAtPlace) => ({
  getUser: Sinon.stub().resolves({
    username: GAINER_USERNAME,
    place: [{ _id: 'existing' }]
  }),
  getUsersAtPlace: Sinon.stub().resolves(usersAtPlace),
  disableUser: Sinon.stub().resolves(),
  updateUser: Sinon.stub().resolves(),
});

describe('lib/multiplace-users.ts', () => {
  describe('disable', () => {
    it('disable a user with single facility (4.7)', async () => {
      const cht = mockChtApi([{
        username: 'user',
        place: { _id: PLACE_ID }
      }]);
      const actual = await MultiplaceUsers.disableUsersAt(PLACE_ID, cht);
      expect(cht.disableUser.callCount).to.eq(1);
      expect(cht.disableUser.args[0]).to.deep.eq(['user']);
      expect(cht.updateUser.called).to.be.false;
      expect(cht.getUser.called).to.be.false;
      expect(actual).to.deep.eq(['user']);
    });

    it('disable a user with single facility (4.11)', async () => {
      const cht = mockChtApi([{
        username: 'user',
        place: [{ _id: PLACE_ID }]
      }]);
      const actual = await MultiplaceUsers.disableUsersAt(PLACE_ID, cht);
      expect(cht.disableUser.callCount).to.eq(1);
      expect(cht.updateUser.called).to.be.false;
      expect(actual).to.deep.eq(['user']);
    });

    it('deactivate a user with single facility (4.11)', async () => {
      const cht = mockChtApi([{
        username: 'user',
        place: [{ _id: PLACE_ID }]
      }]);
      const actual = await MultiplaceUsers.deactivateUsersAt(PLACE_ID, cht);
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
      const actual = await MultiplaceUsers.disableUsersAt(PLACE_ID, cht);
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
      const actual = await MultiplaceUsers.deactivateUsersAt(PLACE_ID, cht);
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
      
      const actual = await MultiplaceUsers.disableUsersAt(PLACE_ID, cht);
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
      await MultiplaceUsers.disableUsersAt(PLACE_ID, cht);
      expect(cht.disableUser.called).to.be.false;
      expect(cht.updateUser.callCount).to.eq(1);
    });
  });

  describe('reassign', () => {
    it('reassign resulting in disable', async () => {
      const cht = mockChtApi([{
        username: 'user',
        place: { _id: PLACE_ID }
      }]);

      const reassignment: PlaceReassignment = {
        placeId: PLACE_ID,
        toUsername: GAINER_USERNAME,
        deactivate: false,
      };
      const actual = await MultiplaceUsers.reassignPlaces([reassignment], cht);
      expect(cht.disableUser.callCount).to.eq(1);
      expect(cht.disableUser.args[0]).to.deep.eq(['user']);
      expect(cht.updateUser.callCount).to.eq(1);
      expect(cht.updateUser.args[0]).to.deep.eq([{
        place: ['existing', PLACE_ID],
        username: GAINER_USERNAME,
      }]);
      expect(cht.getUser.callCount).to.eq(1);
      expect(cht.getUser.args[0]).to.deep.eq([GAINER_USERNAME]);
      expect(actual).to.deep.eq(['user', GAINER_USERNAME]);
    });

    it('reassign resulting in updates', async () => {
      const cht = mockChtApi([{
        username: 'user',
        place: [{ _id: PLACE_ID }, { _id: 'other' }]
      }]);

      const reassignment: PlaceReassignment = {
        placeId: PLACE_ID,
        toUsername: 'gainer',
        deactivate: false,
      };
      const actual = await MultiplaceUsers.reassignPlaces([reassignment], cht);
      expect(cht.disableUser.called).to.be.false;
      expect(cht.updateUser.callCount).to.eq(2);
      expect(cht.updateUser.args[0]).to.deep.eq([{
        place: ['other'],
        username: 'user',
      }]);
      expect(cht.updateUser.args[1]).to.deep.eq([{
        place: ['existing', PLACE_ID],
        username: 'gainer',
      }]);
      expect(cht.getUser.callCount).to.eq(1);
      expect(cht.getUser.args[0]).to.deep.eq(['gainer']);
      expect(actual).to.deep.eq(['user', 'gainer']);
    });

    it('reassign to non-existing user', async () => {
      const cht = mockChtApi([{
        username: 'user',
        place: { _id: PLACE_ID }
      }]);

      cht.getUser.throws('cannot find user');
      const reassignment: PlaceReassignment = {
        placeId: PLACE_ID,
        toUsername: 'gainer',
        deactivate: false,
      };
      const actual = MultiplaceUsers.reassignPlaces([reassignment], cht);
      await expect(actual).to.eventually.rejectedWith('find user');
      expect(cht.disableUser.called).to.be.false;
      expect(cht.updateUser.called).to.be.false;
    });

    it('no disable when reassigning to same place', async () => {
      const cht = mockChtApi([{
        username: 'user',
        place: { _id: PLACE_ID }
      }]);

      cht.getUser.resolves({
        username: 'user',
        place: [{ _id: PLACE_ID }]
      });

      const reassignment: PlaceReassignment = {
        placeId: PLACE_ID,
        toUsername: 'user',
        deactivate: false,
      };
      const actual = await MultiplaceUsers.reassignPlaces([reassignment], cht);
      expect(cht.disableUser.called).to.be.false;
      expect(cht.updateUser.callCount).to.eq(1);
      expect(cht.updateUser.args[0]).to.deep.eq([{
        place: [PLACE_ID],
        username: 'user',
      }]);
      expect(cht.getUser.callCount).to.eq(1);
      expect(cht.getUser.args[0]).to.deep.eq(['user']);
      expect(actual).to.deep.eq(['user']);
    });
  });
});
