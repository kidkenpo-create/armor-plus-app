import masterIndex from '@/knowledge/armor-gpt/master_index.json';
import partLookup from '@/knowledge/armor-gpt/part_lookup.json';
import type { SourceRequest } from './practice-issue-rules';

interface RegistryRecord {
  id?: string;
  title?: string;
  url?: string;
  rung_name?: string;
  far_part?: number | string | null;
  type?: string;
  text_path?: string;
}

type PartLookup = Record<string, RegistryRecord[]>;

const lookup = partLookup as PartLookup;
const registry = masterIndex as RegistryRecord[];

export const APPROVED_KNOWLEDGE_ROOT = 'knowledge/armor-gpt';

export function registryStats() {
  return {
    masterIndexRecords: registry.length,
    partLookupKeys: Object.keys(lookup).length,
  };
}

export function registryRequestsForParts(parts: string[]): SourceRequest[] {
  const requests: SourceRequest[] = [];

  for (const part of parts) {
    const farPart = normalizeFarPart(part);
    const records = lookup[farPart] || [];

    const rfoFarRecord = records.find(isRfoFarGuide);
    if (rfoFarRecord) {
      requests.push(sourceRequestFromRecord('rfo_far', farPart, rfoFarRecord, 'Approved part_lookup.json RFO FAR route'));
    }

    const classDeviationRecord = records.find(isClassDeviationRecord);
    if (classDeviationRecord) {
      requests.push(sourceRequestFromRecord('class_deviation', farPart, classDeviationRecord, 'Approved part_lookup.json class-deviation route'));
    }

    const dfarsPart = toDfarsPart(farPart);
    const dfarsRfoRecord = records.find(isDfarsRfoRecord) || lookup[dfarsPart]?.find(isDfarsRfoRecord);
    if (dfarsRfoRecord) {
      requests.push(sourceRequestFromRecord('dfars_rfo', dfarsPart, dfarsRfoRecord, 'Approved part_lookup.json DFARS RFO route'));
    }

    const dfarsPgiRecord = records.find(isDfarsPgiRecord) || lookup[dfarsPart]?.find(isDfarsPgiRecord);
    if (dfarsPgiRecord) {
      requests.push(sourceRequestFromRecord('dfars_pgi', dfarsPart, dfarsPgiRecord, 'Approved part_lookup.json DFARS PGI route'));
    }
  }

  return requests;
}

export function isApprovedControllingSource(label: string, url: string) {
  const lowerLabel = label.toLowerCase();
  const lowerUrl = url.toLowerCase();

  if (lowerUrl.includes('acquisition.gov/far-overhaul/far-part-deviation-guide/far-overhaul-part-')) {
    return true;
  }

  if (
    lowerUrl.includes('raw.githubusercontent.com/kidkenpo-create/armor-plus/main/dfars-rfo-part-')
    || lowerUrl.includes('raw.githubusercontent.com/kidkenpo-create/armor-plus/main/dfars-rfo-pgi-part-')
    || lowerUrl.includes('raw.githubusercontent.com/kidkenpo-create/armor-plus/main/dfars-pgi-rfo-part-')
  ) {
    return true;
  }

  if (lowerLabel.includes('class deviation') && lowerUrl.includes('acquisition.gov/sites/default/files/page_file_uploads/')) {
    return true;
  }

  if (
    lowerLabel.includes('class deviation 2021-o0008')
    && lowerUrl.includes('knowledge/armor-gpt/dod_class_deviations_fy26v04_dated_2feb2026.pdf#cd-2021-o0008-revision-1')
  ) {
    return true;
  }

  return false;
}

export function isBaselineFallbackSource(label: string, url: string) {
  const value = `${label} ${url}`.toLowerCase();
  return (
    value.includes('gsa/gsa-acquisition-far')
    || value.includes('gsa/gsa-acquisition-dfars')
    || value.includes('armor github data')
    || value.includes('/data/far')
    || value.includes('/data/dfars')
  );
}

export function sourceAuthorityInstruction(routePlan: Array<{ label: string; url: string; status: string }>) {
  const retrieved = routePlan.filter(item => item.status === 'R');
  const approvedRetrieved = retrieved.filter(item => isApprovedControllingSource(item.label, item.url));
  const backgroundRetrieved = retrieved.filter(item => isBaselineFallbackSource(item.label, item.url));
  const classDeviationItems = routePlan.filter(isClassDeviationRouteItem);
  const classDeviationRetrieved = classDeviationItems.some(item => item.status === 'R' && isApprovedControllingSource(item.label, item.url));

  return [
    'SOURCE AUTHORITY LOCK:',
    `Approved knowledge root: ${APPROVED_KNOWLEDGE_ROOT}. Registry loaded: ${registry.length} master_index records; ${Object.keys(lookup).length} part_lookup keys.`,
    'Only retrieved RFO FAR, DFARS RFO, DFARS RFO PGI, or approved active class-deviation source text may support a controlling citation.',
    'Baseline FAR/DFARS fallback from data/far or data/dfars is disabled for controlling authority. If referenced at all, it is crosswalk/background only.',
    approvedRetrieved.length
      ? `Approved controlling source text retrieved: ${approvedRetrieved.map(item => item.label).join('; ')}.`
      : 'No approved controlling source text was retrieved. Do not issue a Definitive controlling citation; mark the source status UTR/Non-Definitive as applicable.',
    backgroundRetrieved.length
      ? `Background-only source detected and barred from controlling use: ${backgroundRetrieved.map(item => item.label).join('; ')}.`
      : 'No baseline FAR/DFARS background fallback source was admitted into controlling context.',
    classDeviationRetrieved
      ? 'Approved class-deviation source text was retrieved; use it only if it directly applies.'
      : classDeviationItems.length
        ? 'A specific class-deviation source was selected but approved source text was not retrieved. Mark that selected source UTR; do not certify no deviation found; downgrade only if the missing selected source could affect the answer.'
        : 'No specific active class-deviation source was selected by the route. Mark class-deviation rungs Checked or N/A, not UTR, and do not downgrade solely because no optional class-deviation source was selected.',
  ].join('\n');
}

function isClassDeviationRouteItem(item: { label: string; url: string }) {
  const value = `${item.label} ${item.url}`.toLowerCase();
  return (
    value.includes('class deviation')
    || value.includes('rfo deviation')
    || value.includes('dod_class_deviations_fy26')
    || value.includes('page_file_uploads/dod_rfo_deviation')
  );
}

function normalizeFarPart(part: string) {
  if (part.startsWith('2') && part.length === 3) return String(Number(part.slice(1)));
  return String(Number(part));
}

function toDfarsPart(part: string) {
  return part.startsWith('2') && part.length === 3 ? part : `2${part.padStart(2, '0')}`;
}

function sourceRequestFromRecord(
  kind: SourceRequest['kind'],
  part: string,
  record: RegistryRecord,
  reason: string,
): SourceRequest {
  return {
    kind,
    part,
    reason,
    title: record.title,
    url: record.url,
    sourceType: record.type,
    textPath: record.text_path,
  };
}

function isRfoFarGuide(record: RegistryRecord) {
  return `${record.title || ''} ${record.url || ''}`.toLowerCase().includes('rfo far part');
}

function isDfarsRfoRecord(record: RegistryRecord) {
  const value = `${record.title || ''} ${record.rung_name || ''}`.toLowerCase();
  return value.includes('dfars rfo cd') || value.includes('dfars rfo');
}

function isDfarsPgiRecord(record: RegistryRecord) {
  return `${record.title || ''} ${record.rung_name || ''}`.toLowerCase().includes('pgi');
}

function isClassDeviationRecord(record: RegistryRecord) {
  const value = `${record.title || ''} ${record.rung_name || ''}`.toLowerCase();
  return value.includes('class deviation') || value.includes('dod rfo deviation');
}
