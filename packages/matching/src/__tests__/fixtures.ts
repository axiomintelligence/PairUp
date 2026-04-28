import type { Days, Profile, Visibility } from '../types.js';

export const NOW = new Date('2026-04-28T12:00:00Z');
const DAY = 86_400_000;

export const fullWeek: Days = {
  Mon: 'full',
  Tue: 'full',
  Wed: 'full',
  Thu: 'full',
  Fri: 'full',
};

export const monTueWed: Days = {
  Mon: 'full',
  Tue: 'full',
  Wed: 'part',
  Thu: 'non',
  Fri: 'non',
};

export const thuFri: Days = {
  Mon: 'non',
  Tue: 'non',
  Wed: 'part',
  Thu: 'full',
  Fri: 'full',
};

export const allFlexible: Days = {
  Mon: 'flexible',
  Tue: 'flexible',
  Wed: 'flexible',
  Thu: 'flexible',
  Fri: 'flexible',
};

export const openVisibility: Visibility = {
  grade: 'open',
  directorates: 'open',
  location: 'open',
  days: 'open',
};

export const strictVisibility: Visibility = {
  grade: 'must',
  directorates: 'must',
  location: 'must',
  days: 'must',
};

export function makeProfile(overrides: Partial<Profile> = {}): Profile {
  return {
    grade: 'G7',
    directorates: ['Economic & Trade'],
    location: 'London – KCS',
    days: monTueWed,
    visibility: openVisibility,
    daysNegotiable: 'no',
    lastActiveAt: new Date(NOW.getTime() - 1 * DAY),
    ...overrides,
  };
}
