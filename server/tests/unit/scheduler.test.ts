// tests/unit/scheduler.test.ts
// Sanity check: le scheduler interne (node-schedule) s'enregistre sans erreur
// et ne s'enregistre qu'une seule fois même si startScheduler() est appelé
// plusieurs fois (garde `started`, utile en dev avec hot-reload).
import schedule from 'node-schedule';
import { startScheduler } from '../../src/scheduler';

describe('startScheduler', () => {
    afterEach(() => {
        // Nettoie les jobs enregistrés par node-schedule entre les tests
        for (const name of Object.keys(schedule.scheduledJobs)) {
            schedule.scheduledJobs[name].cancel();
        }
    });

    it('registers the auto-close and SLA jobs', () => {
        startScheduler();
        expect(schedule.scheduledJobs['auctions-auto-close']).toBeDefined();
        expect(schedule.scheduledJobs['incidents-sla-check']).toBeDefined();
    });

    it('does not throw when called a second time (idempotent guard)', () => {
        startScheduler();
        expect(() => startScheduler()).not.toThrow();
    });
});
