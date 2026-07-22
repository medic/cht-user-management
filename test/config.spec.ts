import { expect } from 'chai';
import sinon from 'sinon';

import { Config, ContactType, ExternalSource, PartnerConfig } from '../src/config';
import getConfigByKey, { CONFIG_MAP } from '../src/config/config-factory';
import { mockSimpleContactType } from './mocks';

const mockPartnerConfig = (): PartnerConfig => ({
  config: {
    domains: [],
    contact_types: [mockSimpleContactType('string')],
    logoBase64: '',
  }
});

describe('config', () => {
  it('mock partner config is valid', () => {
    const mockConfig = mockPartnerConfig();
    Config.assertValid(mockConfig);
  });

  it('assert on unknown property type', () => {
    const mockConfig = mockPartnerConfig();
    mockConfig.config.contact_types[0].hierarchy[0].type = 'unknown';
    const assertion = () => Config.assertValid(mockConfig);
    expect(assertion).to.throw('type "unknown"');
  });
  
  it('place name is always required', () => {
    const mockConfig = mockPartnerConfig();
    mockConfig.config.contact_types[0].place_properties.shift();
    const assertion = () => Config.assertValid(mockConfig);
    expect(assertion).to.throw('"name"');
  });

  it('contact name is always required', () => {
    const mockConfig = mockPartnerConfig();
    mockConfig.config.contact_types[0].contact_properties.shift();
    const assertion = () => Config.assertValid(mockConfig);
    expect(assertion).to.throw('"name"');
  });

  it('contact_properties can have unique attributes', () => {
    const mockConfig = mockPartnerConfig();
    mockConfig.config.contact_types[0].contact_properties[0].unique = 'parent';
    Config.assertValid(mockConfig);
  });

  it('hierarchy properties cannot have unique attributes', () => {
    const mockConfig = mockPartnerConfig();
    mockConfig.config.contact_types[0].hierarchy[0].unique = 'parent';
    const assertion = () => Config.assertValid(mockConfig);
    expect(assertion).to.throw('with "unique" values');
  });

  it('parent hierarchy level is required', () => {
    const mockConfig = mockPartnerConfig();
    mockConfig.config.contact_types[0].hierarchy[0].level = 2;
    const assertion = () => Config.assertValid(mockConfig);
    expect(assertion).to.throw('with parent level');
  });
  
  it('#124 - cannot have generated property in hierarchy', () => {
    const mockConfig = mockPartnerConfig();
    mockConfig.config.contact_types[0].hierarchy[0].type = 'generated';
    const assertion = () => Config.assertValid(mockConfig);
    expect(assertion).to.throw('cannot be of type "generated"');
  });

  it('#124 - cannot have generated property as replacement_property', () => {
    const mockConfig = mockPartnerConfig();
    mockConfig.config.contact_types[0].replacement_property.type = 'generated';
    const assertion = () => Config.assertValid(mockConfig);
    expect(assertion).to.throw('cannot be of type "generated"');
  });

  const configs = Object.entries(CONFIG_MAP);
  for (const [configName, partnerConfig] of configs) {
    it(`config ${configName} is valid`, () => {
      Config.assertValid(partnerConfig);
    });
  }
});

describe('config external sources', () => {
  // the Config class reads from the singleton loaded via CONFIG_NAME (CHIS-KE by default in tests)
  const loadedConfig = getConfigByKey(process.env.CONFIG_NAME).config;

  const SOURCE_A: ExternalSource = {
    id: 'source-a',
    friendly_name: 'Source A',
    url: 'https://a.example.com',
    api_endpoint: '/api/search',
    auth: { type: 'token', client_id_key: 'email', client_secret_key: 'password' },
    resultKey: 'results',
  };
  const SOURCE_B: ExternalSource = { ...SOURCE_A, id: 'source-b', friendly_name: 'Source B' };

  // builds a contact type whose `sex` place_property carries the given external_mapping
  const contactTypeWithMapping = (external_mapping?: any): ContactType => {
    const contactType = mockSimpleContactType('string');
    contactType.place_properties[1].external_mapping = external_mapping;
    return contactType;
  };

  let originalSources: ExternalSource[] | undefined;

  beforeEach(() => {
    originalSources = loadedConfig.external_sources;
    loadedConfig.external_sources = [SOURCE_A, SOURCE_B];
  });

  afterEach(() => {
    loadedConfig.external_sources = originalSources;
    sinon.restore();
  });

  describe('getExternalSources', () => {
    it('returns all configured sources when no id is provided', () => {
      expect(Config.getExternalSources()).to.deep.equal([SOURCE_A, SOURCE_B]);
    });

    it('returns a single source in an array for a known id', () => {
      expect(Config.getExternalSources('source-b')).to.deep.equal([SOURCE_B]);
    });

    it('throws for an unknown id', () => {
      expect(() => Config.getExternalSources('missing')).to.throw('external source missing not found');
    });

    it('returns an empty array when no sources are configured', () => {
      loadedConfig.external_sources = undefined;
      expect(Config.getExternalSources()).to.deep.equal([]);
    });

    it('throws for any id when no sources are configured', () => {
      loadedConfig.external_sources = undefined;
      expect(() => Config.getExternalSources('source-a')).to.throw('external source source-a not found');
    });
  });

  describe('getSanitizedExternalSources', () => {
    it('returns a source when the contact type has a filter mapping for it', () => {
      sinon.stub(Config, 'getContactType').returns(
        contactTypeWithMapping({ 'source-a': { name: 'amount', is_filter: true } })
      );

      expect(Config.getSanitizedExternalSources('contacttype-name'))
        .to.deep.equal([{ id: 'source-a', friendly_name: 'Source A' }]);
    });

    it('excludes a source that only has a non-filter mapping', () => {
      sinon.stub(Config, 'getContactType').returns(
        contactTypeWithMapping({ 'source-a': { name: 'x', is_filter: false } })
      );

      expect(Config.getSanitizedExternalSources('contacttype-name')).to.deep.equal([]);
    });

    it('excludes a source when is_filter is omitted', () => {
      sinon.stub(Config, 'getContactType').returns(
        contactTypeWithMapping({ 'source-a': { name: 'x' } })
      );

      expect(Config.getSanitizedExternalSources('contacttype-name')).to.deep.equal([]);
    });

    it('excludes all sources when the contact type has no external mapping', () => {
      sinon.stub(Config, 'getContactType').returns(contactTypeWithMapping(undefined));

      expect(Config.getSanitizedExternalSources('contacttype-name')).to.deep.equal([]);
    });

    it('detects a filter mapping declared on a hierarchy property', () => {
      const contactType = mockSimpleContactType('string');
      contactType.hierarchy[0].external_mapping = { 'source-b': { name: 'district', is_filter: true } };
      sinon.stub(Config, 'getContactType').returns(contactType);

      expect(Config.getSanitizedExternalSources('contacttype-name'))
        .to.deep.equal([{ id: 'source-b', friendly_name: 'Source B' }]);
    });

    it('detects a filter mapping declared on a contact property', () => {
      const contactType = mockSimpleContactType('string');
      contactType.contact_properties[0].external_mapping = { 'source-a': { name: 'phone', is_filter: true } };
      sinon.stub(Config, 'getContactType').returns(contactType);

      expect(Config.getSanitizedExternalSources('contacttype-name'))
        .to.deep.equal([{ id: 'source-a', friendly_name: 'Source A' }]);
    });

    it('filters to the requested sourceId when it has a filter mapping', () => {
      sinon.stub(Config, 'getContactType').returns(
        contactTypeWithMapping({
          'source-a': { name: 'x', is_filter: true },
          'source-b': { name: 'y', is_filter: true },
        })
      );

      expect(Config.getSanitizedExternalSources('contacttype-name', 'source-b'))
        .to.deep.equal([{ id: 'source-b', friendly_name: 'Source B' }]);
    });

    it('returns an empty array when the requested sourceId has no filter mapping', () => {
      sinon.stub(Config, 'getContactType').returns(
        contactTypeWithMapping({ 'source-a': { name: 'x', is_filter: true } })
      );

      expect(Config.getSanitizedExternalSources('contacttype-name', 'source-b')).to.deep.equal([]);
    });

    it('returns an empty array when no sources are configured', () => {
      loadedConfig.external_sources = undefined;
      sinon.stub(Config, 'getContactType').returns(
        contactTypeWithMapping({ 'source-a': { name: 'x', is_filter: true } })
      );

      expect(Config.getSanitizedExternalSources('contacttype-name')).to.deep.equal([]);
    });
  });
});
