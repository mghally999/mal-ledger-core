/** `npm run replay`: replay the brief's event stream and print the per-day report. */
import { runReplay } from './replay.ts';
import { ACCOUNTS, EVENTS } from './scenario.ts';
import { report } from './report.ts';

console.log(report(runReplay(ACCOUNTS, EVENTS)));
