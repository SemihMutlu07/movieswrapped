export {
  PERSON_STREAM_POSTER_CAP,
  PERSON_STREAM_MIN_FILL,
  PERSON_PHASE_ORDER,
  PERSON_PHASE_MS,
  personPhaseAt,
  showPersonRewatch,
  type PersonPhase,
} from '../person/personPhases';

import {
  PERSON_STREAM_POSTER_CAP,
  PERSON_PHASE_ORDER,
  PERSON_PHASE_MS,
  personPhaseAt,
  showPersonRewatch,
  type PersonPhase,
} from '../person/personPhases';

export const DIRECTOR_STREAM_POSTER_CAP = PERSON_STREAM_POSTER_CAP;
export type DirectorPhase = PersonPhase;
export const DIRECTOR_PHASE_ORDER = PERSON_PHASE_ORDER;
export const DIRECTOR_PHASE_MS = PERSON_PHASE_MS;

export function directorPhaseAt(elapsedMs: number): PersonPhase {
  return personPhaseAt(elapsedMs);
}

export function showDirectorRewatch(phase: PersonPhase, reduce: boolean): boolean {
  return showPersonRewatch(phase, reduce);
}
