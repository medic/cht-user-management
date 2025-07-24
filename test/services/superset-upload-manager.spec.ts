import { expect } from 'chai';
import sinon from 'sinon';
import { SupersetUploadManager } from '../../src/services/superset-upload-manager';
import { UploadState } from '../../src/services/place';
import { ISupersetIntegration } from '../../src/services/superset-integration';
import { mockPlace, mockValidContactType } from '../mocks';

describe('services/superset-upload-manager.ts', () => {
  let supersetIntegrationStub: ISupersetIntegration;
  let eventedUploadStateChange: sinon.SinonSpy;
  let eventedPlaceStateChange: sinon.SinonSpy;
  let manager: SupersetUploadManager;
  let contactType: any;

  beforeEach(() => {
    supersetIntegrationStub = {
      handlePlace: sinon.stub().resolves(),
      handleGroup: sinon.stub().resolves(),
    };
    eventedUploadStateChange = sinon.spy();
    eventedPlaceStateChange = sinon.spy();
    contactType = mockValidContactType('string', undefined);
    manager = new SupersetUploadManager(
      supersetIntegrationStub,
      eventedUploadStateChange,
      eventedPlaceStateChange
    );
  });

  describe('uploadSingle', () => {
    it('should call handlePlace and set SUCCESS on success', async () => {
      const place = mockPlace(contactType);
      await manager.uploadSingle(place);
      expect((supersetIntegrationStub.handlePlace as sinon.SinonStub).calledWith(place)).to.be.true;
      expect(eventedUploadStateChange.calledWith(place, 'superset', UploadState.SUCCESS)).to.be.true;
    });

    it('should set FAILURE and error on handlePlace error', async () => {
      const place = mockPlace(contactType);
      const error = new Error('fail');
      (supersetIntegrationStub.handlePlace as sinon.SinonStub).rejects(error);
      await manager.uploadSingle(place);
      expect(place.uploadError).to.exist;
      expect(eventedUploadStateChange.calledWith(place, 'superset', UploadState.FAILURE)).to.be.true;
    });
  });

  describe('uploadInBatches', () => {
    it('should only upload places with SUCCESS CHT state and shouldUploadToSuperset', async () => {
      const eligible = mockPlace(contactType);
      eligible.chtUploadState = UploadState.SUCCESS;
      eligible.shouldUploadToSuperset = () => true;
      const ineligible = mockPlace(contactType);
      ineligible.chtUploadState = UploadState.FAILURE;
      ineligible.shouldUploadToSuperset = () => true;
      const notForSuperset = mockPlace(contactType);
      notForSuperset.chtUploadState = UploadState.SUCCESS;
      notForSuperset.shouldUploadToSuperset = () => false;
      await manager.uploadInBatches([eligible, ineligible, notForSuperset]);
      expect((supersetIntegrationStub.handlePlace as sinon.SinonStub).calledOnceWith(eligible)).to.be.true;
    });
  });

  describe('uploadGrouped', () => {
    it('should call handleGroup for groups where all are eligible', async () => {
      const place1 = mockPlace(contactType);
      place1.contact.id = 'A';
      place1.chtUploadState = UploadState.SUCCESS;
      place1.shouldUploadToSuperset = () => true;
      const place2 = mockPlace(contactType);
      place2.contact.id = 'A';
      place2.chtUploadState = UploadState.SUCCESS;
      place2.shouldUploadToSuperset = () => true;
      await manager.uploadGrouped([place1, place2]);
      expect((supersetIntegrationStub.handleGroup as sinon.SinonStub).calledWith([place1, place2])).to.be.true;
      expect(eventedUploadStateChange.calledWith(place1, 'superset', UploadState.SUCCESS)).to.be.true;
      expect(eventedUploadStateChange.calledWith(place2, 'superset', UploadState.SUCCESS)).to.be.true;
    });

    it('should set FAILURE and error for all in group if handleGroup fails', async () => {
      const place1 = mockPlace(contactType);
      place1.contact.id = 'A';
      place1.chtUploadState = UploadState.SUCCESS;
      place1.shouldUploadToSuperset = () => true;
      const place2 = mockPlace(contactType);
      place2.contact.id = 'A';
      place2.chtUploadState = UploadState.SUCCESS;
      place2.shouldUploadToSuperset = () => true;
      (supersetIntegrationStub.handleGroup as sinon.SinonStub).rejects(new Error('group fail'));
      await manager.uploadGrouped([place1, place2]);
      expect(place1.uploadError).to.exist;
      expect(place2.uploadError).to.exist;
      expect(eventedUploadStateChange.calledWith(place1, 'superset', UploadState.FAILURE)).to.be.true;
      expect(eventedUploadStateChange.calledWith(place2, 'superset', UploadState.FAILURE)).to.be.true;
    });

    it('should skip group if any place is not eligible', async () => {
      const eligible = mockPlace(contactType);
      eligible.contact.id = 'A';
      eligible.chtUploadState = UploadState.SUCCESS;
      eligible.shouldUploadToSuperset = () => true;
      const ineligible = mockPlace(contactType);
      ineligible.contact.id = 'A';
      ineligible.chtUploadState = UploadState.FAILURE;
      ineligible.shouldUploadToSuperset = () => true;
      await manager.uploadGrouped([eligible, ineligible]);
      expect((supersetIntegrationStub.handleGroup as sinon.SinonStub).notCalled).to.be.true;
      expect(eventedUploadStateChange.neverCalledWith(eligible, 'superset', UploadState.SUCCESS)).to.be.true;
    });
  });
});
