export class SQLocal {
  constructor() {
    throw new Error('SQLocal is disabled in the desktop renderer. Use native desktop SQLite instead.');
  }
}
