import { PartnerConfig } from '.';
import ugandaConfig from './chis-ug';
import kenyaConfig from './chis-ke';
import togoConfig from './chis-tg';
import civConfig from './chis-civ';

export enum Feature {
  Create = 'create',
  ReplaceContact = 'replace-contact',
  Move = 'move',
}

const parseConfig = (c: any): PartnerConfig => {
  return {
    config: {
      ...c.config,
      contact_types: c.config.contact_types.map((t: any) => {
        return {
          ...t,
          feature_flags: t.feature_flags?.map((v: string) => {
            if ((Object.values(Feature) as string[]).indexOf(v) === -1) {
              throw new Error(
                'invalid feature flag: ' +
                  v +
                  '. Acceptable values are [' +
                  Object.values(Feature).join(' | ') +
                  ']'
              );
            }
            return v as Feature;
          }),
        };
      }),
    },
    mutate: c.mutate,
  };
};

const CONFIG_MAP: { [key: string]: PartnerConfig } = {
  'CHIS-KE': parseConfig(kenyaConfig),
  'CHIS-UG': parseConfig(ugandaConfig),
  'CHIS-TG': parseConfig(togoConfig),
  'CHIS-CIV': parseConfig(civConfig),
};

export default function getConfigByKey(key: string = 'CHIS-KE'): PartnerConfig {
  const usingKey = key.toUpperCase();
  console.log(`Using configuration: ${key}`);
  const result = CONFIG_MAP[usingKey];
  if (!result) {
    const available = JSON.stringify(Object.keys(CONFIG_MAP));
    throw Error(
      `Failed to start: Cannot find configuration '${usingKey}'. Configurations available are ${available}`
    );
  }

  return result;
}
