import {
  DIGITAL_SOURCE_SCHEMA,
  type Actor,
  type DigitalSupportProfile,
} from './models';
import { comparisonText } from './normalize';

export function initialDigitalProfiles(
  actor: Actor,
  now = Date.now(),
): DigitalSupportProfile[] {
  return ['CHEDRAUI', 'LA COMER'].map((retailer) => ({
    id: `${retailer.toLowerCase().replace(/ /g, '-')}-copete-digital`,
    retailerCode: retailer.replace(/ /g, '_'),
    retailerLabel: retailer,
    retailerAliases: [retailer],
    supportCode: 'COPETE_DIGITAL',
    supportLabel: 'COPETE DIGITAL',
    articleAliases: ['COPETE DIGITAL'],
    sourceSchema: DIGITAL_SOURCE_SCHEMA,
    periodicity: 'fortnight',
    cmsName: null,
    trackingTemplate: 'external-cms-basic',
    fixationTypeMap: { FIJACION: 'fixation', REVISION: 'continuous' },
    active: true,
    createdAt: now,
    createdByUid: actor.uid,
    createdByEmail: actor.email,
    updatedAt: now,
    updatedByUid: actor.uid,
    updatedByEmail: actor.email,
  }));
}
export function matchProfile(
  profiles: readonly DigitalSupportProfile[],
  retailer: unknown,
  article: unknown,
): DigitalSupportProfile | null {
  const r = comparisonText(retailer),
    a = comparisonText(article);
  return (
    profiles.find(
      (p) =>
        p.active &&
        p.retailerAliases.some((x) => comparisonText(x) === r) &&
        p.articleAliases.some((x) => comparisonText(x) === a),
    ) ?? null
  );
}
export function placementMode(
  value: unknown,
): 'fixation' | 'continuous' | null {
  const normalized = comparisonText(value);
  if (normalized === 'FIJACION') return 'fixation';
  if (normalized === 'REVISION') return 'continuous';
  return null;
}
