// tests/unit/calendarDaysLate.test.ts
// Le retard se compte en jours calendaires (comme DATEDIFF(CURDATE(), due_date) côté SQL),
// pas en tranches de 24 h depuis la fin de l'échéance.
import { calendarDaysLate } from '../../src/utils/dateHelpers';

describe('calendarDaysLate', () => {
    it('is 0 on the due day, whatever the time', () => {
        expect(calendarDaysLate('2026-10-05', new Date(2026, 9, 5, 0, 5))).toBe(0);
        expect(calendarDaysLate('2026-10-05', new Date(2026, 9, 5, 23, 59))).toBe(0);
    });

    it('is 1 the morning after the due day (a 24h slice from 23:59 would say 0)', () => {
        expect(calendarDaysLate('2026-10-05', new Date(2026, 9, 6, 9, 0))).toBe(1);
    });

    it('counts whole calendar days across a month end', () => {
        expect(calendarDaysLate('2026-10-30', new Date(2026, 10, 2, 8, 0))).toBe(3);
    });

    it('is 0 when returned early, and accepts a datetime string for the due date', () => {
        expect(calendarDaysLate('2026-10-05', new Date(2026, 9, 1))).toBe(0);
        expect(calendarDaysLate('2026-10-05T00:00:00.000Z', new Date(2026, 9, 7))).toBe(2);
    });

    it('is 0 for an unparseable due date rather than NaN', () => {
        expect(calendarDaysLate('', new Date())).toBe(0);
    });
});
