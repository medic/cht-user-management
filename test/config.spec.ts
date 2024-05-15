import { expect } from 'chai';

import { Config, PartnerConfig } from '../src/config';
import { CONFIG_MAP } from '../src/config/config-factory';
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
